/** Enterprise portal inside the existing Desktop shell, backed by authenticated Host operations. */
import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

interface Config { schemaVersion: 1; enabled: boolean; url: string; allowHttp: boolean }
interface State { config: Config; caConfigured: boolean; enabled: boolean; error?: string; profileIssues: string[]; busy: boolean; managed: boolean }
const API = '/api/enterprise-market'
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}/${path}`, {
    credentials: 'same-origin',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-starmind-market-request': '1' }, body: JSON.stringify(body) }),
  })
  const value = await response.json() as { error?: string; result?: T }
  if (!response.ok || value.error) throw new Error(value.error ?? `市场请求失败 (${response.status})`)
  return (body === undefined ? value : value.result) as T
}

export function registerEnterpriseMarket(ctx: Context): void {
  const open = (): void => { window.dispatchEvent(new Event('starmind:enterprise-market:open')) }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'starmind-enterprise-market', order: 40,
  }, () => <button type="button" aria-label="企业插件市场" title="企业插件市场" onClick={open}
    style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '8px 10px', font: 'inherit' }}>▦ 企业市场</button>))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'starmind-enterprise-market-dialog', order: 120 }, EnterpriseMarketDialog))
  ctx.slots.inject('plugins.overview', () => ctx.slots.register({ name: 'plugins.overview', id: 'starmind-enterprise-market-card', order: -20 }, () =>
    <section style={{ border: '1px solid var(--dsw-alias-border-primary, #ddd)', padding: 18, borderRadius: 12, width: '100%', boxSizing: 'border-box' }}>
      <strong>StarMind 企业插件市场</strong><p>浏览公司插件，上传版本，并通过当前 Profile 的官方管理器安装和更新。</p>
      <button type="button" onClick={open}>打开企业市场</button>
    </section>))
}

function EnterpriseMarketDialog() {
  const [open, setOpen] = useState(false), [state, setState] = useState<State>()
  const [url, setUrl] = useState(''), [enabled, setEnabled] = useState(true), [allowHttp, setAllowHttp] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false), [settings, setSettings] = useState(false), [restart, setRestart] = useState(false)
  const [portalUrl, setPortalUrl] = useState('')
  const iframe = useRef<HTMLIFrameElement>(null)
  const active = useRef(new Set<string>())
  const refresh = async (): Promise<void> => {
    const value = await request<State>('state')
    setState(value); setUrl(value.config.url); setEnabled(value.config.enabled); setAllowHttp(value.config.allowHttp)
    setSettings(!value.config.url || Boolean(value.error)); setError(value.error ?? value.profileIssues.join('；'))
  }
  useEffect(() => {
    const show = (): void => { setOpen(true); setError(''); void refresh().catch(e => setError(String(e))) }
    window.addEventListener('starmind:enterprise-market:open', show)
    return () => window.removeEventListener('starmind:enterprise-market:open', show)
  }, [])
  useEffect(() => {
    setConnected(false); setPortalUrl('')
    if (!open || !state?.enabled || !state.config.url || restart) return
    let disposed = false
    void request<{ portalUrl: string }>('connect', {}).then(value => { if (!disposed) { setPortalUrl(value.portalUrl); setConnected(true) } }, e => { if (!disposed) setError(String(e)) })
    return () => { disposed = true }
  }, [open, state?.config.url, state?.enabled, restart])
  useEffect(() => {
    if (!open || !connected || !portalUrl) return
    const origin = new URL(portalUrl).origin
    const listener = (event: MessageEvent): void => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== origin || !event.data || typeof event.data !== 'object') return
      const data = event.data as { type?: unknown; requestId?: unknown; payload?: Record<string, unknown> }
      if (typeof data.type !== 'string' || typeof data.requestId !== 'string' || data.requestId.length > 128) return
      const requestId = data.requestId, type = data.type
      const reply = (value: object): void => { iframe.current?.contentWindow?.postMessage({ type: `${type}.result`, requestId, ...value }, event.origin === 'null' ? '*' : event.origin) }
      if (type === 'starmind.market.handshake') { reply({ ok: true, result: { install: true, update: true, uninstall: true, list: true, toggle: true } }); return }
      const action = ({ 'starmind.market.install': 'install', 'starmind.market.update': 'update',
        'starmind.market.uninstall': 'uninstall', 'starmind.market.list': 'list', 'starmind.market.set-enabled': 'set-enabled' } as Record<string, string>)[type]
      if (!action || active.current.has(requestId)) return
      if (active.current.size > 20) { reply({ ok: false, error: '请求过多，请等待已有操作' }); return }
      active.current.add(requestId)
      const payload = data.payload ?? {}
      if (action !== 'list') {
        const operation = action === 'install' ? '安装' : action === 'update' ? '更新' : action === 'uninstall' ? '卸载' : payload.enabled ? '启用' : '停用'
        if (!window.confirm(`确认在当前 StarMind Profile ${operation} ${String(payload.packageName)}${payload.version ? ` @ ${String(payload.version)}` : ''}？`)) {
          active.current.delete(requestId); reply({ ok: false, error: '用户取消操作' }); return
        }
        setBusy(true); setMessage(`正在处理 ${String(payload.packageName)}，请等待真实管理器结果…`)
      }
      void request('operation', { ...payload, action }).then(result => {
        reply({ ok: true, result }); if (action !== 'list') setMessage('操作已返回。请根据市场中的真实安装或加载结果确认是否需要重启。')
      }, e => { reply({ ok: false, error: String(e) }); if (action !== 'list') setError(String(e)) })
        .finally(() => { active.current.delete(requestId); if (action !== 'list') setBusy(false) })
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [open, connected, portalUrl])
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !busy) setOpen(false) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, busy])
  if (!open) return null
  const save = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      await request('config', { schemaVersion: 1, enabled, url: url.trim(), allowHttp })
      setRestart(true); setConnected(false); setMessage('配置已保存。重启客户端后使用新的市场策略；当前插件操作不会中途更换来源。')
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#0007', display: 'grid', placeItems: 'center', padding: 20 }}>
    <section role="dialog" aria-modal="true" aria-label="企业插件市场" style={{ width: 'min(1180px, 96vw)', height: 'min(860px, 93vh)', borderRadius: 16,
      background: 'var(--dsw-alias-background-primary, #fff)', color: 'var(--dsw-alias-label-primary, #172033)', boxShadow: '0 24px 90px #0004', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header style={{ padding: '15px 20px', display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid #8883' }}>
        <strong style={{ flex: 1 }}>StarMind 企业插件市场</strong><span style={{ fontSize: 12 }}>{connected ? '已连接内网市场' : '尚未连接'}</span>
        <button type="button" onClick={() => setSettings(!settings)}>市场设置</button>
        <button type="button" disabled={busy} aria-label="关闭企业市场" onClick={() => setOpen(false)}>×</button>
      </header>
      {settings && <form onSubmit={e => { e.preventDefault(); void save() }} style={{ padding: 20, display: 'grid', gap: 12, borderBottom: '1px solid #8883' }}>
        {state?.managed && <p role="status" style={{ margin: 0 }}>市场设置由公司管理员统一管理，请联系管理员修改。</p>}
        {state?.caConfigured && <p style={{ margin: 0, fontSize: 12 }}>已配置公司证书。保存设置会保留现有证书配置。</p>}
        <fieldset disabled={busy || state?.managed} style={{ display: 'grid', gap: 12, border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> 启用企业模式（公共插件市场停止联网）</label>
        <label>公司市场地址 <input aria-label="公司市场地址" type="url" placeholder="https://plugins.company.internal" value={url} onChange={e => setUrl(e.target.value)} style={{ width: 'min(600px, 75%)', padding: 8 }} /></label>
        <label><input type="checkbox" checked={allowHttp} onChange={e => setAllowHttp(e.target.checked)} /> 允许管理员部署的内网 HTTP 服务</label>
        <p style={{ fontSize: 12, margin: 0 }}>企业模式采用公司固定分发源。旧 Profile 若保存公网包地址，需要先新建 Profile；配置不会自动改写旧锁文件。</p>
        <div><button disabled={busy} type="submit">保存配置</button></div>
        </fieldset>
      </form>}
      {error && <div role="alert" style={{ color: '#b42318', background: '#fff0ed', padding: '10px 20px' }}>{error}</div>}
      {!!state?.profileIssues.length && <div style={{ padding: '10px 20px' }}>
        旧 Profile 保持原样。新建 Profile 将自动使用已保存的企业市场设置。
        <button type="button" disabled={busy} onClick={() => { setOpen(false); void window.desktopNext?.command({ type: 'controls', page: 'create-profile' }) }}>新建企业 Profile</button>
      </div>}
      {message && <div role="status" style={{ padding: '10px 20px', fontSize: 13 }}>{message}</div>}
      {restart && <div style={{ padding: '10px 20px' }}><button type="button" disabled={busy} onClick={() => { void window.desktopNext?.command({ type: 'restart' }).catch(e => setError(String(e))) }}>重启并应用配置</button></div>}
      {connected && !restart ? <iframe ref={iframe} title="公司插件市场" src={portalUrl}
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerPolicy="origin" style={{ flex: 1, width: '100%', border: 0, minHeight: 0 }} />
        : <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 30 }}>在市场设置中填写公司服务器地址，保存并重启后浏览和安装公司插件。</div>}
    </section>
  </div>
}
