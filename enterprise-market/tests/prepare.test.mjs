import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { downloadArchive, lockArtifacts, parseArgs, prepareOffline, validateRemote, verifyIntegrity } from '../tools/prepare-offline.mjs'
import { createFixtures } from '../../adt-cpd-workflow/enterprise-market-plan/tools/create-fixtures.mjs'
import { createFixtureServer } from '../../adt-cpd-workflow/enterprise-market-plan/tools/serve-fixtures.mjs'
import { inspectTarball } from '../src/archive.mjs'

test('preparation requires an explicit registry, fixed version and new output', () => {
  assert.throws(() => parseArgs(['--plugin', 'x@1.0.0', '--output', 'x.json']), /registry/u)
  assert.throws(() => parseArgs(['--plugin', 'x@1.0.0', '--tarball', 'x.tgz', '--registry', 'http://127.0.0.1', '--output', 'x']), /一项/u)
  assert.throws(() => parseArgs(['--registry', 'x', '--registry', 'y']), /重复/u)
  assert.equal(parseArgs(['--help']).help, true)
})

test('download origin and redirect controls do not forward credentials or follow external sources', async () => {
  const origins = new Set(['http://127.0.0.1:18765'])
  assert.throws(() => validateRemote('http://user:secret@127.0.0.1:18765/x', origins), /不允许/u)
  assert.throws(() => validateRemote('https://registry.npmjs.org/x', origins), /不允许/u)
  assert.throws(() => validateRemote('file:///tmp/a', origins), /不允许/u)
  let calls = 0
  await assert.rejects(downloadArchive('http://127.0.0.1:18765/x', origins, async () => { calls++; return new Response('', { status: 302, headers: { location: 'https://registry.npmjs.org/x' } }) }), /不允许/u)
  assert.equal(calls, 1)
})

test('integrity rejects corruption; lock rejects non-registry dependency protocols', () => {
  const bytes = Buffer.from('original bytes')
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  verifyIntegrity(bytes, integrity)
  assert.throws(() => verifyIntegrity(Buffer.from('tampered'), integrity), /不符/u)
  assert.throws(() => verifyIntegrity(bytes, 'sha1-aaaa'), /SHA-256/u)
  assert.throws(() => lockArtifacts({ lockfileVersion: 3, packages: { '': {}, 'node_modules/a': { resolved: 'git+https://github.com/x/y', integrity } } }), /非制品库/u)
  assert.equal(lockArtifacts({ lockfileVersion: 3, packages: { '': {}, 'node_modules/a': { inBundle: true } } }).length, 0)
})

test('real npm resolves a scoped plugin and its dependency from only the loopback registry', { timeout: 120_000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'starmind-prepare-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const fixture = join(temporary, 'fixture')
  createFixtures({ output: fixture, origin })
  const { server, descriptor, release } = createFixtureServer({ releaseDirectory: fixture })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const output = join(temporary, 'plugin.dshbundle.json')
  const result = await prepareOffline({ plugin: '@starmind/enterprise-market-smoke@1.0.0', registry: descriptor.registryUrl, output })
  assert.equal(result.packageCount, 2)
  const bundle = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(bundle.schema, 'starmind.enterprise-market.bundle')
  assert.equal(bundle.prepared.scriptsExecuted, false)
  const packages = bundle.packages.map(item => inspectTarball(Buffer.from(item.contentsBase64, 'base64')))
  assert.deepEqual(packages.map(item => item.manifest.name).sort(), ['@starmind/enterprise-market-smoke', '@starmind/enterprise-market-smoke-helper'])
  const original = release.packages.find(item => item.name === '@starmind/enterprise-market-smoke' && item.version === '1.0.0')
  const exported = packages.find(item => item.manifest.name === original.name)
  assert.equal(exported.integrity, original.integrity)
  await assert.rejects(prepareOffline({ plugin: '@starmind/enterprise-market-smoke@1.0.0', registry: descriptor.registryUrl, output }), /已存在/u)
  const local = join(fixture, original.tarballPath)
  const localOutput = join(temporary, 'local.dshbundle.json')
  const localResult = await prepareOffline({ tarball: local, registry: descriptor.registryUrl, output: localOutput })
  assert.equal(localResult.packageCount, 2)
})
