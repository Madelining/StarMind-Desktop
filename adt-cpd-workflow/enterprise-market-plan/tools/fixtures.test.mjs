import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { createFixtures, hash, PLUGIN, HELPER } from './create-fixtures.mjs'
import { createFixtureServer } from './serve-fixtures.mjs'

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'starmind-market-design-'))
  const output = join(parent, 'release')
  const result = createFixtures({ output, nodeVersion: '24.14.1' })
  const release = JSON.parse(readFileSync(join(output, 'release.json')))
  return { ...result, release }
}

function unpackFixture(bytes) {
  const tar = gunzipSync(bytes)
  const files = new Map()
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const string = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, '')
    const expectedChecksum = Number.parseInt(string(148, 8).trim(), 8)
    const checked = Buffer.from(header); checked.fill(0x20, 148, 156)
    assert.equal(checked.reduce((sum, byte) => sum + byte, 0), expectedChecksum)
    const size = Number.parseInt(string(124, 12), 8)
    assert.equal(string(156, 1), '0')
    files.set(string(0, 100), tar.subarray(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

async function withServer(t, value, options = {}) {
  const result = createFixtureServer({ releaseDirectory: value.root, ...options })
  await new Promise((resolve, reject) => { result.server.once('error', reject); result.server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => result.server.close(resolve)))
  const port = result.server.address().port
  const get = (path, { method = 'GET', host = '127.0.0.1:18765' } = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: { host } }, response => {
      const parts = []; response.on('data', part => parts.push(part)); response.on('end', () => {
        const body = Buffer.concat(parts)
        resolve({ status: response.statusCode, headers: response.headers, body, json: () => JSON.parse(body) })
      })
    })
    req.on('error', reject); req.end()
  })
  return { ...result, get }
}

test('generated tarballs contain real package identities, bundle, dependency versions and matching integrity', () => {
  const value = fixture()
  assert.equal(value.release.packages.length, 5)
  for (const item of value.release.packages) {
    const bytes = readFileSync(join(value.root, item.tarballPath))
    assert.equal(item.integrity, 'sha512-' + hash(bytes, 'sha512', 'base64'))
    const files = unpackFixture(bytes)
    const manifest = JSON.parse(files.get('package/package.json'))
    assert.equal(manifest.name, item.name); assert.equal(manifest.version, item.version)
    if (item.name === PLUGIN) {
      assert.equal(manifest.dependencies[HELPER], item.version === '1.0.0' ? '1.0.0' : '1.1.0')
      assert.ok(files.get('package/cordis.patch.yml'))
      assert.equal(files.get('package/index.js').toString().includes('INTENTIONAL_FIXTURE_ACTIVATION_FAILURE'), item.version === '1.2.0')
    }
  }
  assert.equal(JSON.parse(readFileSync(join(value.root, 'verification.json'))).status, 'not-run')
})

test('generation is deterministic and refuses overwriting existing files', () => {
  const first = fixture(); const second = fixture()
  assert.equal(first.snapshotId, second.snapshotId)
  assert.throws(() => createFixtures({ output: first.root }), /absent or empty/)
  assert.throws(() => createFixtures({ output: first.root, baselineId: 'synthetic-label' }), /export digest/)
  const output = join(mkdtempSync(join(tmpdir(), 'starmind-market-baseline-')), 'release')
  const baselineId = hash('synthetic baseline export for this unit test')
  createFixtures({ output, baselineId })
  assert.equal(JSON.parse(readFileSync(join(output, 'release.json'))).runtime.baselineId, baselineId)
})

test('channel and index bind one exact snapshot and internal registry', async t => {
  const value = fixture(); const { get } = await withServer(t, value)
  const descriptor = (await get('/channels/stable.json')).json()
  assert.equal(descriptor.snapshotId, value.snapshotId)
  const index = (await get(new URL(descriptor.indexUrl).pathname)).json()
  assert.equal(index.format, 1)
  assert.equal(index.plugins[0]['dist-tags'].latest, '1.1.0')
  for (const version of index.plugins[0].versions) assert.equal(version.source.registry, descriptor.registryUrl)
})

test('scoped packument, exact manifest, dependency lookup and tarball bytes work', async t => {
  const value = fixture(); const { get } = await withServer(t, value)
  const prefix = `/npm/snapshots/${value.snapshotId}/`
  for (const encoded of [encodeURIComponent(PLUGIN), PLUGIN, '@starmind%2fenterprise-market-smoke']) {
    const response = await get(prefix + encoded)
    assert.equal(response.status, 200)
    assert.deepEqual(Object.keys(response.json().versions), ['1.0.0', '1.1.0', '1.2.0'])
  }
  const manifest = (await get(prefix + encodeURIComponent(PLUGIN) + '/1.1.0')).json()
  assert.equal(manifest.dependencies[HELPER], '1.1.0')
  assert.equal((await get(prefix + encodeURIComponent(HELPER) + '/1.1.0')).status, 200)
  const tarball = await get(new URL(manifest.dist.tarball).pathname)
  assert.equal(tarball.status, 200)
  assert.equal('sha512-' + hash(tarball.body, 'sha512', 'base64'), manifest.dist.integrity)
})

test('missing packages never fallback, writes and unexpected Host are rejected', async t => {
  const value = fixture(); const { get } = await withServer(t, value)
  assert.equal((await get(`/npm/snapshots/${value.snapshotId}/not-present`)).status, 404)
  assert.equal((await get('/channels/stable.json', { method: 'POST' })).status, 405)
  assert.equal((await get('/channels/stable.json', { host: 'untrusted.example' })).status, 400)
  assert.equal((await get('/artifacts/not-present/package.tgz')).status, 404)
  assert.equal((await get('/healthz', { method: 'HEAD' })).body.length, 0)
})

test('download failure injection leaves metadata and previous artifact available', async t => {
  const value = fixture(); const { get } = await withServer(t, value, { failArtifactVersion: '1.2.0' })
  for (const version of ['1.1.0', '1.2.0']) {
    const response = await get(`/npm/snapshots/${value.snapshotId}/${encodeURIComponent(PLUGIN)}/${version}`)
    assert.equal(response.status, 200)
    const download = await get(new URL(response.json().dist.tarball).pathname)
    assert.equal(download.status, version === '1.2.0' ? 503 : 200)
  }
})

test('tampered fixture content is rejected before serving', () => {
  const value = fixture()
  const item = value.release.packages[0]
  writeFileSync(join(value.root, item.tarballPath), 'modified')
  assert.throws(() => createFixtureServer({ releaseDirectory: value.root }), /checksum mismatch/)
})
