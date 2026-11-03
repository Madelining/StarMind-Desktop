/** Real headless Host + real pnpm: two plugins, update, activation failure, restart and removal. */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { DesktopHostProcess } from '../lib/host-process.js'
import { NextProfiles } from '../lib/profiles.js'
import { startMarketServer } from '../../enterprise-market/src/server.mjs'
import { createFixtures, PLUGIN, HELPER } from '../../adt-cpd-workflow/enterprise-market-plan/tools/create-fixtures.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'starmind-enterprise-host-'))
const home = join(temporary, 'home'), dataDir = join(temporary, 'market')
const fixtureDir = join(temporary, 'fixtures')
mkdirSync(home)
let market, host
const requests = []
const second = '@starmind/enterprise-second-smoke'
const networkGuard = join(temporary, 'network-guard.cjs'), networkAudit = join(temporary, 'network-violations.log')
writeFileSync(networkGuard, `
const net = require('node:net'); const fs = require('node:fs');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const object = first && typeof first === 'object' ? first : undefined;
  const ipc = object?.path ?? (typeof first === 'string' && !/^\\d+$/.test(first) ? first : undefined);
  const host = object?.host ?? (typeof args[1] === 'string' ? args[1] : 'localhost');
  if (!ipc && !['127.0.0.1', '::1', 'localhost', '[::1]'].includes(String(host))) {
    fs.appendFileSync(process.env.STARMIND_NETWORK_AUDIT_LOG, String(host) + '\\n');
    throw new Error('EXTERNAL_NETWORK_ATTEMPT: ' + host);
  }
  return connect.apply(this, args);
};
require('node:module').syncBuiltinESMExports();
`)

// Synthetic fixture only: deterministic original tgz, never used to repackage production dependencies.
function fixtureTarball(files) {
  const blocks = []
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content), header = Buffer.alloc(512)
    header.write(name, 0, 100)
    const octal = (v, p, n) => header.write(v.toString(8).padStart(n - 1, '0') + '\0', p, n, 'ascii')
    octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(body.length, 124, 12); octal(0, 136, 12)
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263)
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8)
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}
const profileManager = new NextProfiles(home)
const profileDirectory = profileManager.ensure('enterprise')
writeFileSync(join(profileDirectory, 'pnpm-workspace.yaml'), `storeDir: ${JSON.stringify(join(temporary, 'cold-pnpm-store'))}\n`)

async function boot() {
  host = new DesktopHostProcess(process.execPath, root, profileDirectory, undefined,
    { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', STARMIND_ENTERPRISE_POLICY: join(home, 'enterprise-market.json'),
      NODE_OPTIONS: `--require "${networkGuard.replaceAll('\\', '/')}"`, STARMIND_NETWORK_AUDIT_LOG: networkAudit,
      HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '' },
    undefined, undefined, undefined, join(root, 'scripts', 'fixtures', 'isolated-user-host.mjs'), () => {})
  let timer
  const ready = await Promise.race([host.start(), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Enterprise Host startup exceeded 90 seconds')), 90_000)
  })]).finally(() => clearTimeout(timer))
  const target = new URL(ready.url)
  const login = await fetch(target, { redirect: 'manual' })
  assert.equal(login.status, 303)
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  await login.body?.cancel()
  assert.ok(cookie)
  const operation = async value => {
    const response = await fetch(`${target.origin}/api/enterprise-market/operation`, {
      method: 'POST', headers: { cookie, origin: target.origin, 'content-type': 'application/json', 'x-starmind-market-request': '1' }, body: JSON.stringify(value),
    })
    const body = await response.json()
    assert.equal(response.status, 200, JSON.stringify(body))
    return body.result
  }
  const rpc = async (method, args) => {
    const response = await fetch(`${target.origin}/api/pluginManager/${method}`, {
      method: 'POST', headers: { cookie, origin: target.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `pluginManager/${method}`, payload: { args } }),
    })
    return response.json()
  }
  const denied = await fetch(`${target.origin}/api/enterprise-market/state`)
  assert.equal(denied.status, 401); await denied.body?.cancel()
  return { operation, rpc, origin: target.origin, cookie }
}
const success = result => {
  const change = result.result ?? result
  assert.equal(change.application, 'applied', JSON.stringify(result))
  assert.equal(change.error, undefined, JSON.stringify(result))
}
const activePlugin = async (session, name) => {
  const reply = await session.rpc('listPlugins', {})
  assert.equal(reply.result?.ok, true, JSON.stringify(reply))
  const row = reply.result.value.find(plugin => plugin.moduleName === name)
  assert.equal(row?.enabled, true, JSON.stringify(row))
  assert.equal(row?.fiberPhase, 'active', JSON.stringify(row))
}
const installedVersion = name => JSON.parse(readFileSync(join(profileDirectory, 'node_modules', name, 'package.json'), 'utf8')).version
try {
  market = await startMarketServer({ dataDir, port: 0 })
  market.server.on('request', request => { requests.push(request.url) })
  const { user } = await market.market.createUser('host-smoke', 'admin')
  createFixtures({ output: fixtureDir })
  const release = JSON.parse(readFileSync(join(fixtureDir, 'release.json'), 'utf8'))
  for (const version of ['1.0.0', '1.1.0', '1.2.0']) {
    const helperVersion = version === '1.0.0' ? '1.0.0' : '1.1.0'
    const packages = release.packages.filter(p => p.name === PLUGIN && p.version === version || p.name === HELPER && p.version === helperVersion)
      .map(p => ({ filename: `${p.name.replaceAll('/', '-')}-${p.version}.tgz`, contentsBase64: readFileSync(join(fixtureDir, p.tarballPath)).toString('base64') }))
    await market.market.importBundle({ schema: 'starmind.enterprise-market.bundle', schemaVersion: 1, plugin: { name: PLUGIN, version }, packages }, user)
  }
  const bytes = fixtureTarball({
    'package/package.json': JSON.stringify({ name: second, version: '1.0.0', type: 'module', exports: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    'package/index.js': "export const name='enterprise-second-smoke'; export function apply(ctx){ctx.logger.info('SECOND_FIXTURE_LOADED')}\n",
    'package/cordis.patch.yml': `- insert:\n    - id: enterprise-second-smoke\n      name: '${second}'\n`,
  })
  await market.market.importBundle({ schema: 'starmind.enterprise-market.bundle', schemaVersion: 1, plugin: { name: second, version: '1.0.0' }, packages: [{ filename: 'second.tgz', contentsBase64: bytes.toString('base64') }] }, user)
  writeFileSync(join(home, 'enterprise-market.json'), JSON.stringify({ schemaVersion: 1, enabled: true, url: market.origin, allowHttp: true }))
  let session = await boot()
  const { operation, rpc } = session
  const connected = await fetch(`${session.origin}/api/enterprise-market/connect`, {
    method: 'POST', headers: { cookie: session.cookie, origin: session.origin, 'content-type': 'application/json', 'x-starmind-market-request': '1' }, body: '{}',
  })
  assert.equal(connected.status, 200)
  const portalUrl = (await connected.json()).result.portalUrl
  assert.equal(new URL(portalUrl).hostname, '127.0.0.1')
  assert.notEqual(new URL(portalUrl).origin, session.origin, 'Portal must have an origin separate from main Host RPC')
  const portalPage = await fetch(portalUrl)
  assert.equal(portalPage.status, 200)
  assert.ok((await portalPage.text()).includes('StarMind'))
  const blockedProxyWrite = await fetch(new URL('api/login', portalUrl), { method: 'POST', headers: { origin: 'https://outside.invalid', 'x-starmind-market-request': '1', 'content-type': 'application/json' }, body: '{}' })
  assert.equal(blockedProxyWrite.status, 403); await blockedProxyWrite.body?.cancel()
  const noNonce = await fetch(new URL('/api/pluginManager/listBundles', portalUrl))
  assert.equal(noNonce.status, 404); await noNonce.body?.cancel()
  success(await operation({ action: 'install', packageName: PLUGIN, version: '1.0.0' }))
  assert.equal(installedVersion(PLUGIN), '1.0.0')
  await activePlugin(session, PLUGIN)
  const pluginRequire = createRequire(join(profileDirectory, 'node_modules', PLUGIN, 'package.json'))
  assert.equal(JSON.parse(readFileSync(join(dirname(pluginRequire.resolve(HELPER)), 'package.json'), 'utf8')).version, '1.0.0')
  success(await operation({ action: 'install', packageName: second, version: '1.0.0' }))
  assert.equal(installedVersion(second), '1.0.0')
  await activePlugin(session, second)
  success(await operation({ action: 'update', packageName: PLUGIN, version: '1.1.0' }))
  assert.equal(installedVersion(PLUGIN), '1.1.0')
  await activePlugin(session, PLUGIN)
  const listed = await operation({ action: 'list' })
  assert.ok(listed.bundles.some(row => row.name === PLUGIN && row.enabled && !row.error), JSON.stringify(listed))
  const refused = await rpc('installBundle', { spec: 'https://registry.npmjs.org/example.tgz' })
  assert.equal(refused.result?.ok, false, 'Official remote entry must also reject external specs')
  const publicMarket = await rpc('setBundleEnabled', { name: 'dshmarket', enabled: true })
  assert.equal(publicMarket.result?.ok, false, 'Official remote must not re-enable public markets')
  const broken = await operation({ action: 'update', packageName: PLUGIN, version: '1.2.0' })
  assert.equal(broken.result?.application, 'failed', JSON.stringify(broken))
  if (broken.restore) { success(broken.restore); assert.equal(installedVersion(PLUGIN), '1.1.0'); await activePlugin(session, PLUGIN) }
  else throw new Error('Host has no verified HMR restoration; refusing to report activation recovery success')
  await host.stop(true); host = undefined
  session = await boot()
  await activePlugin(session, PLUGIN)
  await activePlugin(session, second)
  success(await session.operation({ action: 'uninstall', packageName: second }))
  success(await session.operation({ action: 'uninstall', packageName: PLUGIN }))
  const final = await session.operation({ action: 'list' })
  assert.equal(final.bundles.some(row => row.name === PLUGIN && row.installed), false, JSON.stringify(final))
  const lock = readFileSync(join(profileDirectory, 'pnpm-lock.yaml'), 'utf8')
  assert.ok(!/registry\.npmjs\.org|registry\.npmmirror\.com|github\.com|jsdelivr\.net/u.test(lock), lock)
  assert.ok(requests.some(path => path.startsWith('/npm/')), 'Real pnpm must read company metadata')
  assert.ok(requests.some(path => path.startsWith('/artifacts/')), 'Real pnpm must download original artifacts')
  assert.equal(existsSync(networkAudit) ? readFileSync(networkAudit, 'utf8') : '', '', 'Host and package-manager children must not attempt external connections')
  console.log(JSON.stringify({ test: 'enterprise-real-host', status: 'passed', installedTwoPlugins: true, updated: true, activationFailureRestored: true, removedAfterRestart: true, requestCount: requests.length }))
} finally {
  if (host) await host.stop(true).catch(() => {})
  if (market) { market.server.closeAllConnections(); await market.close() }
  rmSync(temporary, { recursive: true, force: true })
}
