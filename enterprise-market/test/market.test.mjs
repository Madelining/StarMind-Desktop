import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMarketServer } from '../src/server.mjs';
import { openMarket } from '../src/store.mjs';
import { inspectTarball, hash } from '../src/archive.mjs';
import { makeTarball, plugin } from './helpers.mjs';

async function setup(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'starmind-market-'));
  const store = await openMarket(dir);
  const admin = await store.createUser('admin', 'admin');
  const publisher = await store.createUser('publisher');
  const other = await store.createUser('other');
  let service = await startMarketServer({ dataDir: dir, port: 0, ...overrides });
  t.after(async () => { await service.close(); await rm(dir, { recursive: true, force: true }); });
  const api = async (path, options = {}) => {
    const response = await fetch(service.origin + path, options);
    const content = await response.json();
    return { response, content };
  };
  const auth = token => ({ Authorization: 'Bearer ' + token });
  const post = (path, data, token = publisher.token, headers = {}) => api(path, { method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  const upload = async (bytes, token = publisher.token) => api('/api/uploads?filename=plugin.tgz', { method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/octet-stream' }, body: bytes });
  const publish = async (manifest, extras = [], fields = {}) => {
    const rootUpload = await upload(makeTarball(manifest, { 'package/README.md': '# 离线插件\n原始包说明。' }));
    assert.equal(rootUpload.response.status, 201, JSON.stringify(rootUpload.content));
    const ids = [rootUpload.content.upload.id];
    for (const bytes of extras) { const added = await upload(bytes); assert.equal(added.response.status, 201); ids.push(added.content.upload.id); }
    return post('/api/releases', { plugin: { name: manifest.name, version: manifest.version }, uploadIds: ids, ...fields });
  };
  return { dir, store, admin, publisher, other, api, post, upload, publish, auth, get service() { return service; }, restart: async () => { await service.close(); service = await startMarketServer({ dataDir: dir, port: 0, ...overrides }); } };
}

test('real HTTP upload, ranged and alias dependencies, search, metadata and exact original download', async t => {
  const ctx = await setup(t);
  const a = makeTarball({ name: '@company/helper', version: '1.2.0' });
  const b = makeTarball({ name: '@company/helper', version: '2.0.0' });
  const published = await ctx.publish(plugin('1.0.0', { dependencies: { helperAlias: 'npm:@company/helper@^1.0.0' } }), [a, b], { title: '测试工具', category: '开发' });
  // npm dependency aliases themselves must be valid lowercase package names.
  assert.equal(published.response.status, 422);
  const success = await ctx.publish(plugin('1.0.0', { dependencies: { 'helper-alias': 'npm:@company/helper@^1.0.0' } }), [a, b], { title: '测试工具', category: '开发' });
  assert.equal(success.response.status, 201, JSON.stringify(success.content));
  const release = success.content.release;
  assert.equal(release.registryUrl, ctx.service.origin + '/npm/');
  assert.equal(release.packageCount, 3);
  assert.match(release.readme, /原始包说明/);
  const list = await ctx.api('/api/catalog?q=' + encodeURIComponent('测试') + '&sort=name');
  assert.equal(list.content.total, 1);
  assert.deepEqual(list.content.categories, ['开发']);
  const registry = await ctx.api('/npm/@company%2Fhelper');
  assert.deepEqual(Object.keys(registry.content.versions).sort(), ['1.2.0', '2.0.0']);
  assert.equal(registry.content['dist-tags'].latest, '2.0.0');
  const digest = hash(a);
  const binary = await fetch(ctx.service.origin + '/artifacts/' + digest + '.tgz');
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), a);
  const head = await fetch(ctx.service.origin + '/artifacts/' + digest + '.tgz', { method: 'HEAD' });
  assert.equal(Number(head.headers.get('content-length')), a.length);
  const cached = await fetch(ctx.service.origin + '/artifacts/' + digest + '.tgz', { headers: { 'If-None-Match': head.headers.get('etag') } });
  assert.equal(cached.status, 304);
  const index = (await ctx.api('/dsh-index.json')).content;
  assert.equal(index.plugins[0].versions[0].source.registry, release.registryUrl);
  const detail = await ctx.api('/api/plugins/' + encodeURIComponent(release.name) + '/versions/1.0.0');
  assert.equal(detail.content.snapshotId, release.id);
});

test('authentication, cross-origin protection, name ownership and audit permissions', async t => {
  const ctx = await setup(t);
  const missing = await ctx.post('/api/releases', {}, 'invalid');
  assert.equal(missing.response.status, 401);
  const cross = await ctx.post('/api/releases', {}, ctx.publisher.token, { Origin: 'https://attacker.invalid' });
  assert.equal(cross.response.status, 403);
  const pub = await ctx.publish(plugin());
  assert.equal(pub.response.status, 201);
  const otherUpload = await ctx.upload(makeTarball(plugin('1.1.0')), ctx.other.token);
  const takeover = await ctx.post('/api/releases', { plugin: { name: '@company/example', version: '1.1.0' }, uploadIds: [otherUpload.content.upload.id] }, ctx.other.token);
  assert.equal(takeover.response.status, 403);
  const audit = await ctx.api('/api/audit', { headers: ctx.auth(ctx.admin.token) });
  assert.equal(audit.response.status, 200);
  assert(audit.content.entries.some(entry => entry.action === 'release-published'));
  assert.equal((await ctx.api('/api/audit', { headers: ctx.auth(ctx.publisher.token) })).response.status, 403);
  const state = await readFile(join(ctx.dir, 'state.json'), 'utf8');
  assert(!state.includes(ctx.publisher.token));
});

test('missing dependencies, optional deps and external source refuse without publication', async t => {
  const ctx = await setup(t);
  for (const extra of [{ dependencies: { absent: '^1.0.0' } }, { optionalDependencies: { absent: '~1.2.0' } }, { peerDependencies: { absent: '^1' } }, { dependencies: { absent: 'git+https://example.invalid/a.git' } }]) {
    const result = await ctx.publish(plugin('1.0.0', extra));
    assert.equal(result.response.status, 422, JSON.stringify(result.content));
  }
  assert.equal((await ctx.api('/api/catalog')).content.total, 0);
  assert.equal((await ctx.store.readState()).releases.length, 0);
});

test('lifecycle/native-build blockers explicit; prepare alone is allowed; optional peer absent allowed', async t => {
  const ctx = await setup(t);
  const blocked = await ctx.publish(plugin('1.0.0', { scripts: { postinstall: 'curl https://outside.invalid/runtime' } }));
  assert.equal(blocked.content.error.code, 'OFFLINE_BUILD_UNSUPPORTED');
  const bundled = await ctx.publish(plugin('1.0.0', { bundleDependencies: ['x'] }));
  assert.equal(bundled.content.error.code, 'BUNDLED_DEPENDENCIES_UNSUPPORTED');
  const good = await ctx.publish(plugin('1.0.0', { scripts: { prepare: 'build only before npm publish' }, peerDependencies: { 'optional-peer': '^1' }, peerDependenciesMeta: { 'optional-peer': { optional: true } } }));
  assert.equal(good.response.status, 201);
});

test('immutable global dependency identity and withdrawn releases retain original bytes', async t => {
  const ctx = await setup(t);
  const helper = makeTarball({ name: 'helper', version: '1.0.0' }, { 'package/data.txt': 'original' });
  const first = await ctx.publish(plugin('1.0.0', { dependencies: { helper: '^1' } }), [helper]);
  assert.equal(first.response.status, 201);
  const changed = makeTarball({ name: 'helper', version: '1.0.0' }, { 'package/data.txt': 'replaced' });
  const conflict = await ctx.publish(plugin('1.1.0', { dependencies: { helper: '^1' } }), [changed]);
  assert.equal(conflict.content.error.code, 'PACKAGE_VERSION_CONFLICT');
  const duplicate = await ctx.publish(plugin('1.0.0', { dependencies: { helper: '^1' } }), [helper]);
  assert.equal(duplicate.content.error.code, 'VERSION_IMMUTABLE');
  const id = first.content.release.id;
  assert.equal((await ctx.post('/api/releases/' + id + '/withdraw', {}, ctx.other.token)).response.status, 403);
  assert.equal((await ctx.post('/api/releases/' + id + '/withdraw', {})).response.status, 200);
  assert.equal((await ctx.api('/api/catalog')).content.total, 0);
  assert.equal((await ctx.api('/api/plugins/' + encodeURIComponent('@company/example') + '/versions/1.0.0')).content.withdrawn, true);
  assert.equal((await ctx.api('/npm/releases/' + id + '/helper')).response.status, 200);
  assert.equal((await ctx.api('/npm/helper')).response.status, 200);
  assert.equal((await ctx.api('/snapshots/' + id + '/dsh-index.json')).content.plugins.length, 1);
  await ctx.restart();
  assert.equal((await ctx.api('/npm/helper')).response.status, 200);
  assert.equal((await ctx.api('/api/releases/mine', { headers: ctx.auth(ctx.publisher.token) })).content.releases[0].status, 'withdrawn');
});

test('complete bundle export imports into empty market, tampering fails atomically', async t => {
  const first = await setup(t);
  const pub = await first.publish(plugin('1.0.0', { dependencies: { helper: '^1' } }), [makeTarball({ name: 'helper', version: '1.4.0' })]);
  const exported = (await first.api('/api/releases/' + pub.content.release.id + '/download')).content;
  assert.equal(exported.schema, 'starmind.enterprise-market.bundle');
  assert.equal(exported.packages.length, 2);
  const second = await setup(t);
  const bad = structuredClone(exported);
  bad.packages[0].sha256 = '0'.repeat(64);
  assert.equal((await second.post('/api/import', bad)).response.status, 422);
  assert.equal((await second.api('/api/catalog')).content.total, 0);
  assert.equal((await readdir(join(second.dir, 'uploads'))).length, 0);
  const imported = await second.post('/api/import', exported);
  assert.equal(imported.response.status, 201, JSON.stringify(imported.content));
  assert.equal(imported.content.release.packageCount, 2);
  assert.equal((await second.api('/npm/helper/1.4.0')).response.status, 200);
});

test('invalid uploads, traversal and links reject; size cap rejects before state change', async t => {
  const ctx = await setup(t, { limits: { maxArtifactBytes: 512, maxPublicationBytes: 700 } });
  assert.equal((await ctx.upload(Buffer.from('not a tgz'))).response.status, 400);
  assert.throws(() => inspectTarball(makeTarball({ name: 'x', version: '1.0.0' }, { 'package/../../escape': 'bad' })), /归档/);
  assert.throws(() => inspectTarball(makeTarball({ name: 'x', version: '1.0.0' }, {}, '2')), /符号链接/);
  const response = await ctx.upload(Buffer.alloc(1024));
  assert(response.response.status === 413 || response.response.status === 400);
  assert.equal((await ctx.api('/api/catalog')).content.total, 0);
});
