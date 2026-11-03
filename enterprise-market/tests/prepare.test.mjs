import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { downloadArchive, lockArtifacts, npmEnvironment, parseArgs, prepareOffline, validateRemote, verifyIntegrity } from '../tools/prepare-offline.mjs'
import { inspectTarball } from '../src/archive.mjs'
import { makeTarball, plugin } from '../test/helpers.mjs'

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
  assert.throws(() => lockArtifacts({ lockfileVersion: 3, packages: { '': {}, 'node_modules/a': { inBundle: true } } }), /内嵌/u)
})

test('preparation isolates npm configuration while keeping the chosen network CA and proxy environment', () => {
  assert.deepEqual(npmEnvironment({ PATH: '/runtime', NODE_EXTRA_CA_CERTS: '/company-ca.pem', HTTPS_PROXY: 'http://proxy.internal', NPM_CONFIG_USERCONFIG: '/personal/.npmrc', npm_config_registry: 'https://outside.invalid', 'npm_config_@company:registry': 'https://outside.invalid' }), {
    PATH: '/runtime', NODE_EXTRA_CA_CERTS: '/company-ca.pem', HTTPS_PROXY: 'http://proxy.internal',
  })
})

test('real npm resolves a scoped plugin and its dependency from only the loopback registry', { timeout: 120_000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'starmind-prepare-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const rootName = '@starmind/enterprise-market-smoke', helperName = `${rootName}-helper`
  const rootBytes = makeTarball(plugin('1.0.0', { name: rootName, dependencies: { [helperName]: '^1.0.0' } }))
  const helperBytes = makeTarball({ name: helperName, version: '1.0.0', type: 'module', exports: './index.js' })
  const archives = new Map([[rootName, rootBytes], [helperName, helperBytes]])
  let origin
  const server = createServer((request, response) => {
    const path = new URL(request.url, origin).pathname
    const name = decodeURIComponent(path.slice('/npm/'.length))
    if (path.startsWith('/npm/') && archives.has(name)) {
      const bytes = archives.get(name), info = inspectTarball(bytes)
      const manifest = { ...info.manifest, dist: { tarball: `${origin}/archives/${encodeURIComponent(name)}.tgz`, integrity: info.integrity } }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': manifest } }))
    } else if (path.startsWith('/archives/') && path.endsWith('.tgz')) {
      const bytes = archives.get(decodeURIComponent(path.slice('/archives/'.length, -4)))
      if (bytes) response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(bytes)
      else response.writeHead(404).end()
    } else response.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  const registry = `${origin}/npm/`
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const personalConfig = join(temporary, 'personal.npmrc')
  await writeFile(personalConfig, '@starmind:registry=http://127.0.0.1:1/\nignore-scripts=false\n')
  const previousConfig = process.env.npm_config_userconfig
  process.env.npm_config_userconfig = personalConfig
  t.after(() => { if (previousConfig === undefined) delete process.env.npm_config_userconfig; else process.env.npm_config_userconfig = previousConfig })
  const output = join(temporary, 'plugin.dshbundle.json')
  const result = await prepareOffline({ plugin: `${rootName}@1.0.0`, registry, output })
  assert.equal(result.packageCount, 2)
  const bundle = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(bundle.schema, 'starmind.enterprise-market.bundle')
  assert.equal(bundle.prepared.scriptsExecuted, false)
  const packages = bundle.packages.map(item => inspectTarball(Buffer.from(item.contentsBase64, 'base64')))
  assert.deepEqual(packages.map(item => item.manifest.name).sort(), ['@starmind/enterprise-market-smoke', '@starmind/enterprise-market-smoke-helper'])
  const exported = packages.find(item => item.manifest.name === rootName)
  assert.equal(exported.integrity, inspectTarball(rootBytes).integrity)
  await assert.rejects(prepareOffline({ plugin: `${rootName}@1.0.0`, registry, output }), /已存在/u)
  const localDirectory = join(temporary, 'local ~ offline%20 中文')
  await mkdir(localDirectory)
  const local = join(localDirectory, 'plugin ~ offline%20.tgz')
  await writeFile(local, rootBytes)
  const localOutput = join(temporary, 'local.dshbundle.json')
  const localResult = await prepareOffline({ tarball: local, registry, output: localOutput })
  assert.equal(localResult.packageCount, 2)
  const invalid = join(temporary, 'not-a-dsh-plugin.tgz'), invalidOutput = join(temporary, 'invalid.dshbundle.json')
  await writeFile(invalid, makeTarball({ name: '@starmind/plain-package', version: '1.0.0' }))
  await assert.rejects(prepareOffline({ tarball: invalid, registry, output: invalidOutput }), error => error.code === 'BUNDLE_INVALID')
  assert.equal(await stat(invalidOutput).catch(() => null), null)
})
