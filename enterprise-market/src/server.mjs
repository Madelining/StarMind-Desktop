import http from 'node:http';
import { readFile, stat, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join, resolve, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { openMarket } from './store.mjs';
import { hash } from './archive.mjs';
import { semver } from './dependencies.mjs';
import { assert, MarketError } from './errors.mjs';

const defaultPublic = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const stamp = release => Date.parse(release.publishedAt);
function canonicalOrigin(value) {
  const url = new URL(value);
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === value, 'CONFIG_INVALID', 'publicOrigin 必须是没有路径或尾斜杠的规范 HTTP/HTTPS Origin。');
  return url.origin;
}
function sendJson(response, value, status = 200, immutable = false, request) {
  const body = Buffer.from(JSON.stringify(value));
  const etag = '"' + hash(body) + '"';
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-store');
  response.setHeader('ETag', etag);
  if (request?.headers['if-none-match'] === etag) { response.statusCode = 304; response.end(); return; }
  response.statusCode = status;
  response.setHeader('Content-Length', body.length);
  response.end(request?.method === 'HEAD' ? undefined : body);
}
async function readJson(request, limit) {
  const type = request.headers['content-type']?.split(';')[0].trim();
  assert(type === 'application/json', 'CONTENT_TYPE_INVALID', '此接口需要 application/json。', 415);
  const length = Number(request.headers['content-length'] ?? 0);
  assert(!length || length <= limit, 'REQUEST_TOO_LARGE', '请求体超过大小限制。', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    assert(size <= limit, 'REQUEST_TOO_LARGE', '请求体超过大小限制。', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new MarketError('JSON_INVALID', 'JSON 请求内容无法解析。'); }
}
const cleanUser = user => ({ id: user.id, name: user.name, role: user.role });
function decode(value) {
  let result;
  try { result = decodeURIComponent(value); } catch { throw new MarketError('REQUEST_INVALID', 'URL 编码非法。'); }
  assert(!/[%\\\0]/.test(result) && result !== '.' && result !== '..', 'REQUEST_INVALID', 'URL 路径非法。');
  return result;
}
export async function startMarketServer(options = {}) {
  assert(options.dataDir, 'CONFIG_INVALID', '必须显式指定市场数据目录。');
  const market = await openMarket(options.dataDir, { limits: options.limits });
  const listenHost = options.host ?? '127.0.0.1';
  let origin = options.publicOrigin ? canonicalOrigin(options.publicOrigin) : null;
  assert(origin || listenHost === '127.0.0.1' || listenHost === '::1', 'CONFIG_INVALID', '非回环监听必须配置 publicOrigin。');
  const marketId = options.marketId ?? 'starmind-enterprise';
  const marketName = options.name ?? 'StarMind 企业插件市场';
  const publicDir = resolve(options.publicDir ?? defaultPublic);
  const serverLock = join(market.root, 'server.lock');
  try { await mkdir(serverLock); await writeFile(join(serverLock, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() })); }
  catch (error) { if (error.code === 'EEXIST') throw new MarketError('SERVER_ALREADY_RUNNING', '数据目录已有服务锁。确认旧进程退出后再恢复残留锁。', 409); throw error; }
  const uploadsActive = new Map();
  const fileChecks = new Map();
  const registryUrl = () => origin + '/npm/';
  const snapshotRegistryUrl = release => origin + '/npm/releases/' + release.id + '/';
  const publicRelease = release => ({
    id: release.id, snapshotId: release.id, name: release.name, version: release.version,
    title: release.title, description: release.description, category: release.category, readme: release.readme,
    status: release.status, withdrawn: release.status === 'withdrawn', publishedAt: release.publishedAt, withdrawnAt: release.withdrawnAt,
    owner: cleanUser(release.owner), packageCount: release.packages.length, dependencyCount: Math.max(0, release.packages.length - 1),
    packages: release.packages.map(pkg => ({ name: pkg.name, version: pkg.version, sha256: pkg.sha256, size: pkg.size, integrity: pkg.integrity })),
    warnings: release.warnings, closureVerified: release.closureVerified,
    registryUrl: registryUrl(), snapshotRegistryUrl: snapshotRegistryUrl(release), indexUrl: origin + '/snapshots/' + release.id + '/dsh-index.json',
    downloadUrl: origin + '/api/releases/' + release.id + '/download',
  });
  function catalog(state, query) {
    const groups = new Map();
    const categories = [...new Set(state.releases.filter(item => item.status === 'published').map(item => item.category))].sort();
    for (const release of state.releases.filter(item => item.status === 'published')) {
      if (!groups.has(release.name)) groups.set(release.name, []);
      groups.get(release.name).push(release);
    }
    let plugins = [...groups.entries()].map(([name, releases]) => {
      releases.sort((a, b) => semver.rcompare(a.version, b.version));
      const latest = releases.find(item => !semver.prerelease(item.version)) ?? releases[0];
      return { id: name, name, title: latest.title, description: latest.description, category: latest.category, latestVersion: latest.version, publishedAt: latest.publishedAt, versions: releases.map(publicRelease) };
    });
    const q = (query.get('q') ?? '').trim().toLocaleLowerCase();
    const category = query.get('category');
    if (q) plugins = plugins.filter(item => [item.name, item.title, item.description].join(' ').toLocaleLowerCase().includes(q));
    if (category) plugins = plugins.filter(item => item.category === category);
    const sort = query.get('sort') ?? 'newest';
    assert(['newest', 'name'].includes(sort), 'REQUEST_INVALID', '不支持的排序方式。');
    plugins.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    return { market: { id: marketId, name: marketName, version: '1.0.0' }, categories, plugins, total: plugins.length };
  }
  function index(state, only) {
    const releases = state.releases.filter(item => item.status === 'published' && (!only || item.id === only));
    const names = [...new Set(releases.map(item => item.name))];
    return { format: 1, title: { en: 'StarMind enterprise market', zh: marketName }, plugins: names.map(name => {
      const versions = releases.filter(item => item.name === name).sort((a, b) => semver.rcompare(a.version, b.version));
      const current = versions.find(item => !semver.prerelease(item.version)) ?? versions[0];
      return { name, title: current.title, description: current.description, author: current.owner.name,
        'dist-tags': { latest: current.version },
        versions: versions.map(release => ({ version: release.version, publishTimestamp: Math.floor(stamp(release) / 1000), source: { type: 'npm', registry: registryUrl(release) }, engines: { dsh: release.packages.find(pkg => pkg.name === name && pkg.version === release.version).manifest.engines.dsh } })) };
    }) };
  }
  function manifest(pkg, release) {
    return { ...pkg.manifest, dist: { ...(pkg.manifest.dist ?? {}), integrity: pkg.integrity, tarball: origin + '/artifacts/' + pkg.sha256 + '.tgz' } };
  }
  async function serveFile(request, response, file, digest, contentType, attachment) {
    const info = await stat(file);
    assert(info.isFile(), 'ARTIFACT_NOT_FOUND', '文件不存在。', 404);
    if (digest) {
      const cached = fileChecks.get(file);
      if (!cached || cached.mtimeMs !== info.mtimeMs || cached.size !== info.size) {
        assert(hash(await readFile(file)) === digest, 'STORE_CORRUPT', '制品摘要错误，已停止下载。', 503);
        fileChecks.set(file, { mtimeMs: info.mtimeMs, size: info.size });
      }
    }
    const etag = '"' + (digest ?? String(info.mtimeMs) + '-' + String(info.size)) + '"';
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Length', info.size);
    response.setHeader('Cache-Control', digest ? 'public, max-age=31536000, immutable' : 'no-cache');
    response.setHeader('ETag', etag);
    response.setHeader('Accept-Ranges', 'none');
    if (attachment) response.setHeader('Content-Disposition', 'attachment; filename="' + attachment + '"');
    if (request.headers['if-none-match'] === etag) { response.statusCode = 304; response.removeHeader('Content-Length'); response.end(); return; }
    assert(!request.headers.range, 'RANGE_UNSUPPORTED', '请下载完整文件。', 416);
    if (request.method === 'HEAD') { response.end(); return; }
    await pipeline(createReadStream(file), response);
  }
  const server = http.createServer({ maxHeaderSize: 16384 }, async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'self' dsh-app://app http://127.0.0.1:* http://localhost:*; base-uri 'self'");
    try {
      assert(origin && request.headers.host?.toLowerCase() === new URL(origin).host.toLowerCase(), 'HOST_INVALID', '请求 Host 与市场配置不一致。', 421);
      assert(request.url?.startsWith('/') && !request.url.startsWith('//'), 'REQUEST_INVALID', '请求路径非法。');
      const url = new URL(request.url, origin), path = url.pathname;
      const isWrite = !['GET', 'HEAD'].includes(request.method);
      if (isWrite) {
        assert(request.method === 'POST', 'METHOD_NOT_ALLOWED', '不支持此 HTTP 方法。', 405);
        assert(!request.headers.origin || request.headers.origin === origin, 'ORIGIN_INVALID', '禁止跨站发布请求。', 403);
      }
      const auth = async () => market.authenticate(request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '');
      const state = await market.readState();
      const byId = id => { const found = state.releases.find(item => item.id === id); assert(found, 'RELEASE_NOT_FOUND', '发布版本不存在。', 404); return found; };
      if (!isWrite && path === '/api/config') return sendJson(response, { marketId, name: marketName, portalUrl: origin + '/', indexUrl: origin + '/dsh-index.json', registryUrl: registryUrl(), maxArtifactBytes: market.limits.maxArtifactBytes, maxImportBytes: options.maxImportBytes ?? 384 * 1024 * 1024 }, 200, false, request);
      if (!isWrite && path === '/healthz') return sendJson(response, { ok: true, marketId, releases: state.releases.length }, 200, false, request);
      if (!isWrite && path === '/api/auth/me') { const user = await auth(); return sendJson(response, { user, capabilities: { publish: true, admin: user.role === 'admin' } }, 200, false, request); }
      if (!isWrite && path === '/api/catalog') return sendJson(response, catalog(state, url.searchParams), 200, false, request);
      if (!isWrite && path === '/api/releases/mine') { const user = await auth(); return sendJson(response, { releases: state.releases.filter(item => item.owner.id === user.id || user.role === 'admin').map(publicRelease).reverse() }, 200, false, request); }
      if (!isWrite && path === '/api/audit') { const user = await auth(); assert(user.role === 'admin', 'FORBIDDEN', '仅管理员可查看审计记录。', 403); return sendJson(response, { entries: state.audit.slice(-1000).reverse() }, 200, false, request); }
      let match;
      if (!isWrite && (match = path.match(/^\/api\/plugins\/([^/]+)\/versions\/([^/]+)$/))) {
        const name = decode(match[1]), version = decode(match[2]);
        const release = state.releases.find(item => item.name === name && item.version === version);
        assert(release, 'RELEASE_NOT_FOUND', '插件版本不存在。', 404);
        return sendJson(response, { name, version, registryUrl: registryUrl(release), indexUrl: publicRelease(release).indexUrl, snapshotId: release.id, withdrawn: release.status === 'withdrawn', status: release.status, release: publicRelease(release) }, 200, false, request);
      }
      if (!isWrite && (match = path.match(/^\/api\/plugins\/([^/]+)$/))) {
        const name = decode(match[1]);
        const versions = state.releases.filter(item => item.name === name && item.status === 'published').sort((a, b) => semver.rcompare(a.version, b.version));
        assert(versions.length, 'PLUGIN_NOT_FOUND', '插件不存在或所有版本已撤回。', 404);
        const latest = versions.find(item => !semver.prerelease(item.version)) ?? versions[0];
        return sendJson(response, { plugin: { name, title: latest.title, description: latest.description, category: latest.category, readme: latest.readme, latestVersion: latest.version, versions: versions.map(publicRelease) } }, 200, false, request);
      }
      if (!isWrite && (match = path.match(/^\/api\/releases\/([a-f0-9]{64})\/download$/))) {
        const release = byId(match[1]);
        response.setHeader('Content-Disposition', 'attachment; filename="starmind-' + release.id.slice(0, 12) + '.bundle.json"');
        return sendJson(response, await market.exportBundle(release), 200, true, request);
      }
      if (isWrite && path === '/api/uploads') {
        const user = await auth();
        assert(request.headers['content-type']?.split(';')[0] === 'application/octet-stream', 'CONTENT_TYPE_INVALID', '原始包上传需要 application/octet-stream。', 415);
        assert((uploadsActive.get(user.id) ?? 0) < 1 && [...uploadsActive.values()].reduce((a, b) => a + b, 0) < 4, 'UPLOAD_BUSY', '同时上传数量过多，请稍后重试。', 429);
        uploadsActive.set(user.id, (uploadsActive.get(user.id) ?? 0) + 1);
        try { return sendJson(response, { upload: await market.stage(request, url.searchParams.get('filename'), user) }, 201); }
        finally { uploadsActive.set(user.id, uploadsActive.get(user.id) - 1); }
      }
      if (isWrite && path === '/api/releases') { const user = await auth(); return sendJson(response, { release: publicRelease(await market.publish(await readJson(request, 2 * 1024 * 1024), user)) }, 201); }
      if (isWrite && path === '/api/import') { const user = await auth(); return sendJson(response, { release: publicRelease(await market.importBundle(await readJson(request, options.maxImportBytes ?? 384 * 1024 * 1024), user)) }, 201); }
      if (isWrite && (match = path.match(/^\/api\/releases\/([a-f0-9]{64})\/withdraw$/))) { const user = await auth(); return sendJson(response, { release: publicRelease(await market.withdraw(match[1], user)) }); }
      if (!isWrite && path === '/dsh-index.json') return sendJson(response, index(state), 200, false, request);
      if (!isWrite && (match = path.match(/^\/snapshots\/([a-f0-9]{64})\/dsh-index.json$/))) {
        const release = byId(match[1]);
        const stable = { ...state, releases: [{ ...release, status: 'published' }] };
        return sendJson(response, index(stable, release.id), 200, true, request);
      }
      if (!isWrite && path.startsWith('/npm/')) {
        const scoped = path.match(/^\/npm\/releases\/([a-f0-9]{64})\/(.*)$/);
        const release = scoped ? byId(scoped[1]) : null;
        const suffix = scoped ? scoped[2] : path.slice('/npm/'.length);
        const source = release ? release.packages : [...new Map(state.releases.flatMap(item => item.packages).map(pkg => [pkg.name + '@' + pkg.version, pkg])).values()];
        if (suffix === '-/ping') return sendJson(response, { ok: true }, 200, !!release, request);
        const segments = suffix.split('/').map(decode);
        let name = segments.shift();
        if (name?.startsWith('@') && !name.includes('/')) name += '/' + segments.shift();
        const packages = source.filter(pkg => pkg.name === name);
        assert(packages.length, 'PACKAGE_NOT_FOUND', '市场不含该依赖包，请补齐离线包。', 404, { package: name, snapshotId: release?.id });
        assert(segments.length <= 1, 'REQUEST_INVALID', 'registry 路径非法。');
        if (segments.length) {
          const pkg = packages.find(item => item.version === segments[0]);
          assert(pkg, 'VERSION_NOT_FOUND', '快照不含该精确版本。', 404, { package: name, version: segments[0] });
          return sendJson(response, manifest(pkg, release), 200, true, request);
        }
        const versions = Object.fromEntries(packages.map(pkg => [pkg.version, manifest(pkg, release)]));
        const latest = semver.rsort(packages.map(pkg => pkg.version)).find(version => !semver.prerelease(version)) ?? packages[0].version;
        return sendJson(response, { name, versions, 'dist-tags': { latest }, time: Object.fromEntries(packages.map(pkg => [pkg.version, pkg.publishedAt])) }, 200, !!release, request);
      }
      if (!isWrite && (match = path.match(/^\/artifacts\/([a-f0-9]{64})\.tgz$/))) {
        assert(state.releases.some(release => release.packages.some(pkg => pkg.sha256 === match[1])), 'ARTIFACT_NOT_FOUND', '制品不存在。', 404);
        return await serveFile(request, response, market.artifactPath(match[1]), match[1], 'application/gzip', match[1] + '.tgz');
      }
      assert(!isWrite, 'NOT_FOUND', '接口不存在。', 404);
      assert(!path.startsWith('/api/') && !path.startsWith('/npm/'), 'NOT_FOUND', '接口不存在。', 404);
      const local = path === '/' ? 'index.html' : decode(path.slice(1));
      assert(!local.split('/').some(part => part === '..' || part === '.' || !part), 'NOT_FOUND', '页面不存在。', 404);
      const file = await realpath(join(publicDir, local)).catch(() => null);
      const difference = file ? relative(publicDir, file) : '..';
      assert(file && difference && !difference.startsWith('..') && !isAbsolute(difference), 'NOT_FOUND', '页面不存在。', 404);
      const contentType = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[extname(file)] ?? 'application/octet-stream';
      return await serveFile(request, response, file, null, contentType);
    } catch (error) {
      if (response.headersSent || response.destroyed) { response.destroy(); return; }
      response.removeHeader('Content-Disposition');
      response.removeHeader('Content-Length');
      const known = error instanceof MarketError;
      if (known && error.status === 405) response.setHeader('Allow', 'GET, HEAD, POST');
      sendJson(response, { error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '服务暂时无法完成请求。', details: { ...(known ? error.details : {}), requestId } } }, known ? error.status : 500);
      if (!known && options.onError) options.onError(error, { requestId });
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 10 * 60 * 1000;
  try { await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(options.port ?? 8787, listenHost, resolveListen); }); }
  catch (error) { await rm(serverLock, { recursive: true, force: true }); throw error; }
  if (!origin) origin = 'http://' + (listenHost === '::1' ? '[::1]' : listenHost) + ':' + server.address().port;
  return { server, market, origin, close: async () => {
    await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    await rm(serverLock, { recursive: true, force: true });
  } };
}
