import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { EnterpriseMarket, createEnterprisePortalProxy, enterpriseProfileIssues, parseEnterpriseMarketConfig, type EnterprisePluginManager } from '../src/enterprise-market.ts'

const temporary: string[] = []
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'enterprise-market-unit-')); temporary.push(home)
  const profile = join(home, 'profiles', 'enterprise'); mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'enterprise', dependencies: {} }))
  writeFileSync(join(home, 'enterprise-market.json'), JSON.stringify({ schemaVersion: 1, enabled: true, url: 'http://127.0.0.1:18765', allowHttp: true }))
  return { home, profile }
}
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
it('requires an explicit HTTP decision and rejects URL credentials or remote policy fields', () => {
  expect(() => parseEnterpriseMarketConfig({ schemaVersion: 1, enabled: true, url: 'http://company.internal', allowHttp: false })).toThrow()
  expect(() => parseEnterpriseMarketConfig({ schemaVersion: 1, enabled: true, url: 'https://u:p@company.internal', allowHttp: false })).toThrow()
  expect(() => parseEnterpriseMarketConfig({ schemaVersion: 1, enabled: true, url: 'https://company.internal', allowHttp: false, fallback: 'https://registry.npmjs.org' })).toThrow()
})
it('keeps invalid enterprise policy blocked and removes all public market layers', () => {
  const { home, profile } = setup(); writeFileSync(join(home, 'enterprise-market.json'), '{broken')
  const market = new EnterpriseMarket(home, profile)
  expect(market.enabled).toBe(true); expect(market.configError).toBeDefined()
  expect(market.profilePatch()[0]?.config.fallbackRegistries).toEqual([])
  expect(market.filterProfile({ layers: [{ packageName: 'dshmarket' }, { packageName: 'dsh-community-market' }, { packageName: 'desktop' }] }).layers).toEqual([{ packageName: 'desktop' }])
})
it('does not rewrite an old external lock; it blocks new enterprise installs', () => {
  const { home, profile } = setup()
  writeFileSync(join(profile, 'pnpm-lock.yaml'), 'tarball: https://registry.npmjs.org/external.tgz\n')
  expect(enterpriseProfileIssues(profile, new EnterpriseMarket(home, profile).config)).toContain('pnpm-lock.yaml 包含外部地址')
})
it('a public remote install cannot bypass the exact-version guard', async () => {
  const { home, profile } = setup(); const market = new EnterpriseMarket(home, profile)
  let installs = 0
  const manager: EnterprisePluginManager = { async listBundles() { return [] }, async installBundle() { installs++; return {} }, async updateBundle() { return {} }, async removeBundle() { return {} }, async setBundleEnabled() { return {} } }
  market.guard(manager)
  await expect(manager.installBundle('https://registry.npmjs.org/p.tgz', {})).rejects.toThrow()
  await expect(manager.setBundleEnabled('dshmarket', true)).rejects.toThrow()
  expect(installs).toBe(0)
})
it('portal proxy isolates origins, strips Host credentials and refuses redirects or cross-origin writes', async () => {
  const { home, profile } = setup()
  let forwardedCookie: string | undefined, forwardedOrigin: string | undefined
  const upstream = createServer((req, res) => {
    forwardedCookie = req.headers.cookie; forwardedOrigin = req.headers.origin
    if (req.url === '/api/redirect') { res.writeHead(302, { location: 'https://external.invalid/' }); res.end(); return }
    req.resume(); req.once('end', () => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}') })
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  writeFileSync(join(home, 'enterprise-market.json'), JSON.stringify({ schemaVersion: 1, enabled: true, url: origin, allowHttp: true }))
  const proxy = await createEnterprisePortalProxy(new EnterpriseMarket(home, profile))
  try {
    const response = await fetch(new URL('api/config', proxy.url), { headers: { cookie: 'HostSecret=private' } })
    expect(response.status).toBe(200); await response.body?.cancel()
    expect(forwardedCookie).toBeUndefined(); expect(forwardedOrigin).toBe(origin)
    const bad = await fetch(new URL('api/login', proxy.url), { method: 'POST', headers: { origin: 'https://outside.invalid', 'x-starmind-market-request': '1' }, body: '{}' })
    expect(bad.status).toBe(403); await bad.body?.cancel()
    const redirect = await fetch(new URL('api/redirect', proxy.url))
    expect(redirect.status).toBe(502); await redirect.body?.cancel()
    const noNonce = await fetch(new URL('/api/pluginManager/listBundles', proxy.url))
    expect(noNonce.status).toBe(404); await noNonce.body?.cancel()
  } finally { await proxy.close(); upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())) }
})
