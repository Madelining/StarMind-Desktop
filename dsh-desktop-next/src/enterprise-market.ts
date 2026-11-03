/** Desktop-owned enterprise routing. Package state and operations remain owned by DSH's manager. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import { atomicJson, atomicText, readPrivateFile } from './private-files.ts'

export interface EnterpriseMarketConfig { schemaVersion: 1; enabled: boolean; url: string; allowHttp: boolean; caFile?: string }
export const ENTERPRISE_MARKET_API = '/api/enterprise-market'
export const ENTERPRISE_PUBLIC_BUNDLES = new Set(['dshmarket', 'dsh-community-market', '@deepseek-ai/dsh-experimental-plugin-market-bundle'])
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
const DEFAULT_CONFIG: EnterpriseMarketConfig = { schemaVersion: 1, enabled: false, url: '', allowHttp: false }

export function parseEnterpriseMarketConfig(value: unknown): EnterpriseMarketConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('企业市场配置必须是对象')
  const v = value as Record<string, unknown>
  if (v.schemaVersion !== 1 || typeof v.enabled !== 'boolean' || typeof v.url !== 'string' || typeof v.allowHttp !== 'boolean'
    || (v.caFile !== undefined && typeof v.caFile !== 'string')
    || Object.keys(v).some(k => !['schemaVersion', 'enabled', 'url', 'allowHttp', 'caFile'].includes(k))) throw new Error('企业市场配置字段无效')
  if (!v.enabled && v.url === '') return { ...DEFAULT_CONFIG,
    ...(v.caFile === undefined ? {} : { caFile: v.caFile as string }) }
  const url = new URL(v.url)
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)
    || url.pathname !== '/' || (url.protocol === 'http:' && !v.allowHttp)) throw new Error('请填写市场服务器 Origin；HTTP 需要明确允许')
  return { schemaVersion: 1, enabled: v.enabled, url: url.origin, allowHttp: v.allowHttp,
    ...(v.caFile === undefined ? {} : { caFile: v.caFile as string }) }
}

export function readEnterpriseMarketConfig(home: string): EnterpriseMarketConfig {
  const path = process.env.STARMIND_ENTERPRISE_POLICY ?? join(home, 'enterprise-market.json')
  const text = readPrivateFile(path, 16 * 1024)
  if (text === undefined) {
    if (process.env.STARMIND_ENTERPRISE_POLICY) throw new Error('管理员指定的企业市场配置不存在')
    return { ...DEFAULT_CONFIG }
  }
  return parseEnterpriseMarketConfig(JSON.parse(text))
}

export function enterpriseProfileIssues(directory: string, config: EnterpriseMarketConfig): string[] {
  const issues: string[] = []
  if (!config.enabled) return issues
  for (const name of ['pnpm-lock.yaml', '.npmrc', 'pnpm-workspace.yaml']) {
    const text = readPrivateFile(join(directory, name), 8 * 1024 * 1024)
    if (text === undefined) continue
    for (const match of text.matchAll(/https?:\/\/[^\s'"<>\]}),]+/gu)) {
      try { if (new URL(match[0]).origin !== config.url) issues.push(`${name} 包含外部地址`) } catch { issues.push(`${name} 包含无效地址`) }
    }
    if (/\b(?:git\+|github:|gitlab:|bitbucket:|ssh:)/u.test(text)) issues.push(`${name} 包含外部 Git 依赖`)
  }
  const manifest = JSON.parse(readPrivateFile(join(directory, 'package.json')) ?? '{}') as Record<string, unknown>
  const pnpm = manifest.pnpm as Record<string, unknown> | undefined
  for (const [field, map] of Object.entries({ dependencies: manifest.dependencies, devDependencies: manifest.devDependencies,
    optionalDependencies: manifest.optionalDependencies, peerDependencies: manifest.peerDependencies, overrides: manifest.overrides, 'pnpm.overrides': pnpm?.overrides })) {
    if (map === undefined) continue
    if (!map || typeof map !== 'object' || Array.isArray(map)) { issues.push(`${field} 结构无效`); continue }
    for (const [name, spec] of Object.entries(map)) {
      if (typeof spec !== 'string' || /(?:https?:|git(?:\+|:|@)|github:|gitlab:|bitbucket:|ssh:|file:|link:|workspace:|npm:|patch:)/u.test(spec)) issues.push(`${field} 的 ${name} 不是已批准的 registry 包`)
    }
  }
  if (pnpm?.patchedDependencies !== undefined) issues.push('pnpm.patchedDependencies 需要单独的企业兼容认证')
  return [...new Set(issues)]
}

export interface EnterpriseBundle { name: string; version?: string; enabled: boolean; installed?: boolean; removable?: boolean; error?: unknown }
export interface EnterprisePluginManager {
  listBundles(): Promise<EnterpriseBundle[]>
  installBundle(spec: string, options?: Record<string, unknown>): Promise<unknown>
  updateBundle(name: string, version: string, options?: Record<string, unknown>): Promise<unknown>
  removeBundle(name: string): Promise<unknown>
  setBundleEnabled(name: string, enabled: boolean): Promise<unknown>
  inspect?(spec: string, options?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  listVersions?(name: string, options?: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  readBundleDetail?(...args: unknown[]): Promise<unknown>
  serveDetailFile?(request: Request): Promise<Response>
}

/** A pnpm root symlink can move while Node retains its first bare-specifier resolution. */
export function enterprisePackageParent(specifier: string, directory: string, installationNames: ReadonlySet<string>): string | undefined {
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
  if (!PACKAGE.test(name) || installationNames.has(name)) return undefined
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown> }
  if (!manifest.dependencies || !Object.hasOwn(manifest.dependencies, name)) return undefined
  // Do not fall back to Node's cached old target if an expected new package is missing or corrupt.
  const anchor = realpathSync.native(join(directory, 'node_modules', name, 'package.json'))
  const installed: unknown = JSON.parse(readFileSync(anchor, 'utf8'))
  if (!installed || typeof installed !== 'object' || (installed as { name?: unknown }).name !== name) throw new Error(`企业插件 ${name} 的安装清单无效`)
  return pathToFileURL(anchor).href
}

/** Keep the official HMR transaction; change only the root tree's user-package resolution parent. */
function installEnterpriseProfileImports(ctx: Context, market: EnterpriseMarket): void {
  if (!market.enabled) return
  const packages = ctx.get('pluginPackages') as unknown as { resolution?: { entries: { name: string; scope: string }[] } } | undefined
  const entries = packages?.resolution?.entries
  if (!entries) throw new Error('企业插件市场需要当前 Host 的官方包解析服务')
  const installationNames = new Set(entries.filter(entry => entry.scope === 'installation').map(entry => entry.name))
  // app-boot keeps this Include instance on patch updates. Its original method retains the actual
  // development or packaged bareModuleBaseUrl for every installation-owned or non-package import.
  const tree = ctx.loader.resolve('include').subtree
  const internal = ctx.loader.internal
  if (!tree || !internal) throw new Error('企业插件市场需要当前 Host 的根插件加载器')
  const original = tree.import
  const wrapped: typeof original = (name, getOuterStack) => {
    const parent = enterprisePackageParent(name, market.profileDirectory, installationNames)
    return parent === undefined ? original.call(tree, name, getOuterStack) : internal.import(name, parent, {})
  }
  tree.import = wrapped
  ctx.effect(() => () => { if (tree.import === wrapped) tree.import = original }, 'Enterprise Market: current pnpm package import parents')
}

/** Bounded JSON request; redirects never turn a local policy into a different server. */
export function enterpriseJson(config: EnterpriseMarketConfig, path: string): Promise<Record<string, unknown>> {
  const start = new URL(path, `${config.url}/`)
  const ca = config.caFile === undefined ? undefined : readFileSync(config.caFile)
  const read = (url: URL, redirects: number): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    if (url.origin !== config.url || redirects > 2 || url.username || url.password) { reject(new Error('市场地址发生未授权跳转')); return }
    const client = url.protocol === 'https:' ? https : http
    const req = client.get(url, { headers: { accept: 'application/json' }, ...(ca === undefined ? {} : { ca }) }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        res.resume()
        if (!res.headers.location) { reject(new Error('无效市场跳转')); return }
        void read(new URL(res.headers.location, url), redirects + 1).then(resolve, reject); return
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`企业市场请求失败 (${res.statusCode ?? 0})`)); return }
      const buffers: Buffer[] = []; let bytes = 0
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 4 * 1024 * 1024) { res.destroy(new Error('市场响应过大')); return }
        buffers.push(chunk)
      })
      res.once('error', reject)
      res.once('end', () => {
        try {
          const result: unknown = JSON.parse(Buffer.concat(buffers).toString('utf8'))
          if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('市场响应格式无效')
          resolve(result as Record<string, unknown>)
        } catch (error) { reject(error) }
      })
    })
    req.setTimeout(15_000, () => req.destroy(new Error('企业市场请求超时')))
    req.once('error', reject)
  })
  return read(start, 0)
}

export class EnterpriseMarket {
  readonly config: EnterpriseMarketConfig
  readonly configError?: string
  private manager?: EnterprisePluginManager
  private readonly restoring = new AsyncLocalStorage<ReadonlySet<string>>()
  private busy = false
  private portal?: Promise<{ url: string; close(): Promise<void> }>
  constructor(readonly home: string, readonly profileDirectory: string) {
    try { this.config = readEnterpriseMarketConfig(home) }
    catch (error) {
      this.config = { ...DEFAULT_CONFIG, enabled: true }
      this.configError = error instanceof Error ? error.message : String(error)
    }
  }
  get enabled(): boolean { return this.config.enabled }
  get registry(): string { return `${this.config.url}/npm/` }
  profilePatch() {
    if (!this.enabled) return []
    // Invalid configuration remains enterprise-blocked, never personal/public fallback.
    return [
      { id: 'plugin-manager', config: { registry: this.config.url ? this.registry : 'http://127.0.0.1:1/', fallbackRegistries: [] } },
      { id: 'plugin-market', config: { indexes: [] } },
    ]
  }
  filterProfile<T extends { layers: { packageName: string }[] }>(profile: T): T {
    if (this.enabled) profile.layers = profile.layers.filter(layer => !ENTERPRISE_PUBLIC_BUNDLES.has(layer.packageName))
    return profile
  }
  pnpmEnvironment(): Readonly<Record<string, string>> {
    if (!this.enabled) return {}
    const npmrc = join(this.home, 'enterprise-market.npmrc')
    const globalNpmrc = join(this.home, 'enterprise-market.global.npmrc')
    atomicText(npmrc, `registry=${this.config.url ? this.registry : 'http://127.0.0.1:1/'}\nstrict-ssl=true\nupdate-notifier=false\n`)
    atomicText(globalNpmrc, '')
    const env: Record<string, string> = {
      npm_config_registry: this.config.url ? this.registry : 'http://127.0.0.1:1/',
      pnpm_config_registry: this.config.url ? this.registry : 'http://127.0.0.1:1/',
      NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
      npm_config_audit: 'false', npm_config_fund: 'false',
      npm_config_ignore_scripts: 'true', pnpm_config_ignore_scripts: 'true',
      npm_config_strict_ssl: 'true', pnpm_config_strict_ssl: 'true',
      npm_config_update_notifier: 'false', pnpm_config_update_notifier: 'false',
      ...(this.config.caFile ? { NODE_EXTRA_CA_CERTS: this.config.caFile, npm_config_cafile: this.config.caFile } : {}),
    }
    // The upstream invocation merges string overrides into the inherited environment.
    // Override scoped and differently-cased registry variables as well; undefined is not a deletion there.
    const forced = new Map(Object.entries(env).map(([key, value]) => [key.toLowerCase(), value]))
    for (const key of Object.keys(process.env)) {
      const value = forced.get(key.toLowerCase())
      if (value !== undefined) env[key] = value
      else if (/^(?:npm|pnpm)_config_.*registry$/iu.test(key)) env[key] = env.npm_config_registry!
    }
    return env
  }
  private assertReady(): void {
    if (!this.enabled) throw new Error('请先配置并启用企业插件市场，然后重启客户端')
    if (this.configError) throw new Error(this.configError)
    const issues = enterpriseProfileIssues(this.profileDirectory, this.config)
    if (issues.length) throw new Error(`当前 Profile 不是纯内网环境，请新建企业 Profile。${issues.join('；')}`)
  }
  async approved(name: string, version: string): Promise<Record<string, unknown>> {
    this.assertReady()
    if (!PACKAGE.test(name) || !VERSION.test(version)) throw new Error('安装必须指定合法包名和确切版本')
    const release = await enterpriseJson(this.config, `/api/plugins/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`)
    if (release.name !== name || release.version !== version || release.withdrawn === true || release.status !== 'published'
      || typeof release.registryUrl !== 'string' || new URL(release.registryUrl).href !== this.registry) throw new Error('该版本未获批准、已下架或分发源不匹配')
    return release
  }
  private parseSpec(spec: string): { name: string; version: string } {
    const index = spec.lastIndexOf('@')
    if (index <= 0) throw new Error('企业模式仅接受公司批准的确切版本，请使用企业市场')
    const name = spec.slice(0, index), version = spec.slice(index + 1)
    if (!PACKAGE.test(name) || !VERSION.test(version)) throw new Error('企业模式不允许外部 URL、Git、本地路径或动态版本')
    return { name, version }
  }
  /** Applies to the real service object, including official remote/UI callers, not only our portal. */
  guard(manager: EnterprisePluginManager): void {
    this.manager = manager
    if (!this.enabled) return
    const install = manager.installBundle.bind(manager), update = manager.updateBundle.bind(manager)
    const enable = manager.setBundleEnabled.bind(manager), inspect = manager.inspect?.bind(manager)
    manager.installBundle = async (spec, options) => {
      if (!this.restoring.getStore()?.has(spec)) {
        const target = this.parseSpec(spec); await this.approved(target.name, target.version)
      }
      return install(spec, { ...options, registry: this.registry, saveExact: true })
    }
    manager.updateBundle = async (name, version, options) => {
      await this.approved(name, version)
      const old = (await manager.listBundles()).find(bundle => bundle.name === name)
      const permitted = new Set([`${name}@${version}`, ...(old?.version ? [`${name}@${old.version}`] : [])])
      return this.restoring.run(permitted, () => update(name, version, { ...options, registry: this.registry }))
    }
    manager.setBundleEnabled = async (name, enabled) => {
      if (enabled && ENTERPRISE_PUBLIC_BUNDLES.has(name)) throw new Error('企业模式已停用公共市场，请使用企业插件市场')
      return enable(name, enabled)
    }
    if (inspect) manager.inspect = async (spec, options, signal) => {
      const target = this.parseSpec(spec); await this.approved(target.name, target.version)
      return inspect(spec, { ...options, registry: this.registry }, signal)
    }
    if (manager.readBundleDetail) manager.readBundleDetail = async () => {
      throw new Error('企业模式请在企业市场查看插件说明；官方公共 CDN 详情读取已停用')
    }
    // Images have a separate authenticated Fetch route and do not call readBundleDetail.
    if (manager.serveDetailFile) manager.serveDetailFile = async () => new Response('企业模式请在企业市场查看插件说明', {
      status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
    // The public UI's registry-derived version picker must not offer retained, unapproved versions.
    const versions = manager.listVersions?.bind(manager)
    if (versions) manager.listVersions = async (name, options, signal) => {
      this.assertReady()
      const result = await versions(name, { ...options, registry: this.registry }, signal)
      if (Array.isArray(result.versions)) {
        result.versions = (await Promise.all(result.versions.map(async (row: { version?: unknown }) => {
          try { await this.approved(name, String(row.version)); return row } catch { return undefined }
        }))).filter(row => row !== undefined)
      }
      return result
    }
  }
  async operation(value: unknown): Promise<unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('操作格式无效')
    const v = value as Record<string, unknown>, manager = this.manager
    if (!manager) throw new Error('当前 Host 的官方插件管理器尚未就绪')
    if (v.action === 'list') return { bundles: await manager.listBundles() }
    if (!this.enabled) throw new Error('启用企业市场后请重启客户端')
    if (this.busy) throw new Error('已有插件操作正在进行，请等待完成')
    if (typeof v.packageName !== 'string' || !PACKAGE.test(v.packageName)) throw new Error('包名无效')
    this.busy = true
    try {
      switch (v.action) {
        case 'install': return await manager.installBundle(`${v.packageName}@${String(v.version)}`, { enabled: true, saveExact: true, registry: this.registry, requestId: randomUUID() })
        case 'update': return await manager.updateBundle(v.packageName, String(v.version), { registry: this.registry, requestId: randomUUID() })
        case 'uninstall': return await manager.removeBundle(v.packageName)
        case 'set-enabled':
          if (typeof v.enabled !== 'boolean') throw new Error('启用状态无效')
          return await manager.setBundleEnabled(v.packageName, v.enabled)
        default: throw new Error('不支持的企业市场操作')
      }
    } finally { this.busy = false }
  }
  state() {
    let issues: string[] = []
    try { issues = enterpriseProfileIssues(this.profileDirectory, this.config) } catch (error) { issues = [String(error)] }
    return { config: { ...this.config, caFile: undefined }, caConfigured: this.config.caFile !== undefined,
      enabled: this.enabled, error: this.configError, profileIssues: issues, busy: this.busy,
      managed: Boolean(process.env.STARMIND_ENTERPRISE_POLICY), profileReady: this.enabled && !this.configError && issues.length === 0 }
  }
  async connect(): Promise<Record<string, unknown>> {
    if (this.configError) throw new Error(this.configError)
    if (!this.config.url) throw new Error('请先保存企业市场地址并重启')
    const config = await enterpriseJson(this.config, '/api/config')
    this.portal ??= createEnterprisePortalProxy(this).catch(error => { this.portal = undefined; throw error })
    const portal = await this.portal
    return { marketId: config.marketId, name: config.name, portalUrl: portal.url }
  }
  async dispose(): Promise<void> { await (await this.portal)?.close() }
  save(value: unknown): { restartRequired: true } {
    if (process.env.STARMIND_ENTERPRISE_POLICY) throw new Error('当前企业市场地址由管理员配置，不能在界面覆盖')
    if (this.busy) throw new Error('请等待插件操作完成后修改配置')
    const config = parseEnterpriseMarketConfig(value)
    // The renderer intentionally does not receive the local certificate path.
    // A normal settings edit preserves it unless a caller explicitly supplies caFile.
    if (this.config.caFile !== undefined && !Object.hasOwn(value as object, 'caFile')) config.caFile = this.config.caFile
    atomicJson(join(this.home, 'enterprise-market.json'), config)
    return { restartRequired: true }
  }
}

async function jsonBody(req: IncomingMessage): Promise<unknown> {
  let bytes = 0; const parts: Buffer[] = []
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += data.length
    if (bytes > 16 * 1024) throw new Error('请求过大')
    parts.push(data)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}

/** A separate loopback origin keeps the company portal away from the main Host's RPC and renderer DOM. */
export async function proxyEnterprisePortal(req: IncomingMessage, res: ServerResponse, market: EnterpriseMarket, prefix: string): Promise<void> {
  if (!market.enabled || market.configError || !market.config.url) { json(res, 503, { error: '企业市场未配置或需重启' }); return }
  const incoming = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = incoming.pathname.slice(prefix.length) || '/'
  if (!['GET', 'HEAD', 'POST'].includes(req.method ?? '') || !(path === '/' || /^\/(?:app\.js|core\.js|ui\.js|bridge\.js|publish\.js|installed\.js|styles\.css|favicon\.ico)$/u.test(path) || /^\/(?:api|artifacts)\//u.test(path))) {
    json(res, 404, { error: '不支持的市场代理路径' }); return
  }
  if (req.method === 'POST' && req.headers['x-starmind-market-request'] !== '1') { json(res, 403, { error: '无效市场写入请求' }); return }
  const remote = new URL(market.config.url)
  remote.pathname = path; remote.search = incoming.search
  const headers: Record<string, string> = { origin: market.config.url }
  // In particular: never forward the local Host Cookie, native renderer token, or Host authority.
  for (const key of ['content-type', 'content-length', 'authorization', 'accept', 'if-none-match']) {
    const value = req.headers[key]
    if (typeof value === 'string') headers[key] = value
  }
  // Import/export uses base64 JSON around at most 256 MiB of original archives.
  const limit = 384 * 1024 * 1024
  const bound = () => {
    let size = 0
    return new Transform({ transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      done(size > limit ? new Error('市场传输超过 384 MiB 限制') : undefined, chunk)
    } })
  }
  await new Promise<void>((resolve, reject) => {
    const client = remote.protocol === 'https:' ? https : http
    const upstream = client.request(remote, { method: req.method, headers,
      ...(market.config.caFile ? { ca: readFileSync(market.config.caFile) } : {}) }, response => {
      const status = response.statusCode ?? 502
      if (status >= 300 && status < 400 && status !== 304) {
        response.resume(); reject(new Error('市场代理不跟随重定向，请配置最终服务 Origin')); return
      }
      const output: Record<string, string> = { 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' dsh-app://app http://127.0.0.1:* http://localhost:*; object-src 'none'" }
      for (const key of ['content-type', 'content-length', 'content-disposition', 'etag', 'last-modified', 'cache-control']) {
        const value = response.headers[key]
        if (typeof value === 'string') output[key] = value
      }
      res.writeHead(status, output)
      void pipeline(response, bound(), res).then(resolve, reject)
    })
    upstream.setTimeout(30_000, () => upstream.destroy(new Error('企业市场代理连接超时')))
    upstream.once('error', reject)
    const abort = () => { if (!res.writableFinished) upstream.destroy(new Error('市场页面已关闭')) }
    res.once('close', abort)
    upstream.once('close', () => res.off('close', abort))
    void pipeline(req, bound(), upstream).catch(reject)
  })
}

export async function createEnterprisePortalProxy(market: EnterpriseMarket): Promise<{ url: string; close(): Promise<void> }> {
  const prefix = `/${randomBytes(16).toString('hex')}`
  let origin = ''
  const server = http.createServer(async (req, res) => {
    const request = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.headers.host !== new URL(origin).host || !(request.pathname === prefix || request.pathname.startsWith(`${prefix}/`))) {
      json(res, 404, { error: '市场代理会话不存在' }); return
    }
    if (req.method === 'POST' && req.headers.origin !== origin) { json(res, 403, { error: '拒绝跨源市场写入' }); return }
    try { await proxyEnterprisePortal(req, res, market, prefix) }
    catch (error) {
      if (res.headersSent) { res.destroy(); return }
      json(res, 502, { error: error instanceof Error ? error.message : String(error) })
    }
  })
  server.headersTimeout = 15_000
  server.requestTimeout = 10 * 60 * 1000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('企业市场代理启动失败') }
  origin = `http://127.0.0.1:${address.port}`
  return { url: `${origin}${prefix}/`, close: async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  } }
}

export function installEnterpriseMarketRoutes(ctx: Context, market: EnterpriseMarket): void {
  const manager = ctx.get('pluginManager') as unknown as EnterprisePluginManager | undefined
  if (!manager) throw new Error('Enterprise Market requires the official pluginManager service')
  installEnterpriseProfileImports(ctx, market)
  market.guard(manager)
  ctx.effect(() => () => market.dispose(), 'Enterprise Market: isolated loopback portal proxy')
  for (const suffix of ['state', 'config', 'connect', 'operation']) {
    const route = `${ENTERPRISE_MARKET_API}/${suffix}`
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: route, handler: async (req, res) => {
      // The Desktop WebServer also applies connection authentication to every enterprise route.
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) { json(res, rejection, { error: '请登录当前 StarMind Host' }); return }
      try {
        if (req.method === 'GET' && suffix === 'state') { json(res, 200, market.state()); return }
        if (req.method !== 'POST' || req.headers['x-starmind-market-request'] !== '1') { json(res, 403, { error: '无效市场操作请求' }); return }
        const origin = req.headers.origin
        if (origin && origin !== `http://${req.headers.host}` && origin !== 'dsh-app://app') { json(res, 403, { error: '拒绝跨源操作' }); return }
        const body = await jsonBody(req)
        const result = suffix === 'config' ? market.save(body) : suffix === 'connect' ? await market.connect() : await market.operation(body)
        json(res, 200, { result })
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }) }
    } }), `Enterprise Market: ${suffix}`)
  }
}
