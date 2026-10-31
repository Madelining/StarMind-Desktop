/** One gateway form reused in setup and the main window's Desktop settings. */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { GatewayBridge, GatewaySnapshot } from '../gateway-contract.ts'

const fieldStyle: CSSProperties = { width: '100%', minWidth: 0, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--background)', color: 'var(--foreground)', font: 'inherit' }
const buttonStyle: CSSProperties = { ...fieldStyle, width: 'auto', cursor: 'pointer' }

export function GatewaySettings({ bridge, language, setup = false, onSaved, onBusyChange }: { bridge?: GatewayBridge; language: string; setup?: boolean; onSaved?(): void; onBusyChange?(busy: boolean): void }) {
  const t = (zh: string, en: string) => language.startsWith('zh') ? zh : en
  const id = useId()
  const [snapshot, setSnapshot] = useState<GatewaySnapshot>()
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [model, setModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState<'loading' | 'discovering' | 'saving' | ''>('loading')
  const [failure, setFailure] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const operation = useRef(false)
  useEffect(() => { onBusyChange?.(Boolean(busy)); return () => { onBusyChange?.(false) } }, [busy, onBusyChange])
  useEffect(() => {
    mounted.current = true
    if (!bridge) { setBusy(''); setFailure(t('网关设置不可用，请重新启动 StarMind。', 'Gateway settings are unavailable. Restart StarMind.')); return }
    void bridge.read().then(value => {
      if (!mounted.current) return
      setSnapshot(value); setBaseURL(value.baseURL); setModel(value.model); setModels(value.models)
    }).catch(error => { if (mounted.current) setFailure(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (mounted.current) setBusy('') })
    return () => { mounted.current = false }
  }, [bridge])

  async function discover() {
    if (!bridge || operation.current) return
    operation.current = true; setBusy('discovering'); setFailure(''); setNotice('')
    try {
      const available = await bridge.discover({ baseURL, apiKey, clearApiKey })
      if (!mounted.current) return
      setModels(available)
      if (!available.includes(model)) setModel(available[0] ?? '')
      setNotice(t(`已获取 ${available.length} 个模型，可从列表选择或手动填写。`, `Found ${available.length} models. Select one or enter an ID manually.`))
    } catch (error) { if (mounted.current) setFailure(error instanceof Error ? error.message : String(error)) }
    finally { operation.current = false; if (mounted.current) setBusy('') }
  }

  async function save() {
    if (!bridge || operation.current) return
    operation.current = true; setBusy('saving'); setFailure(''); setNotice('')
    try {
      const saved = await bridge.save({ baseURL, apiKey, clearApiKey, model, models })
      if (!mounted.current) return
      setSnapshot(saved); setBaseURL(saved.baseURL); setModel(saved.model); setModels(saved.models); setApiKey(''); setClearApiKey(false)
      setNotice(t('网关配置已保存。', 'Gateway configuration saved.'))
      onSaved?.()
    } catch (error) { if (mounted.current) setFailure(error instanceof Error ? error.message : String(error)) }
    finally { operation.current = false; if (mounted.current) setBusy('') }
  }

  const disabled = Boolean(busy) || !bridge
  return <section className="dshDesktopSettingsGroup" data-starmind-gateway="" style={{ minWidth: 0 }}>
    {!setup && <h3>{t('StarMind 网关', 'StarMind gateway')}</h3>}
    <form onSubmit={event => { event.preventDefault(); void save() }} style={{ display: 'grid', gap: 14 }}>
      <label htmlFor={`${id}-url`} style={{ display: 'grid', gap: 6 }}>Base URL
        <input id={`${id}-url`} type="url" required spellCheck={false} autoComplete="url" value={baseURL} disabled={disabled} placeholder="https://your-gateway.example/v1" style={fieldStyle} onChange={event => { setBaseURL(event.target.value); setModels([]); setNotice('') }} />
      </label>
      <label htmlFor={`${id}-key`} style={{ display: 'grid', gap: 6 }}>{t('API 密钥', 'API key')}
        <input id={`${id}-key`} type="password" autoComplete="new-password" spellCheck={false} value={apiKey} disabled={disabled || clearApiKey} placeholder={snapshot?.keyConfigured ? t('已保存密钥；留空保持不变', 'Key saved; leave blank to keep it') : t('输入 API 密钥（本地无鉴权网关可留空）', 'Enter API key (optional for local gateways)')} style={fieldStyle} onChange={event => setApiKey(event.target.value)} />
      </label>
      {snapshot?.keyConfigured && <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}><input type="checkbox" checked={clearApiKey} disabled={disabled} onChange={event => setClearApiKey(event.target.checked)} />{t('清除已保存的密钥', 'Clear saved API key')}</label>}
      <label htmlFor={`${id}-model`} style={{ display: 'grid', gap: 6 }}>{t('使用模型', 'Model')}
        <input id={`${id}-model`} list={`${id}-models`} required spellCheck={false} autoComplete="off" value={model} disabled={disabled} placeholder={t('选择或输入模型 ID', 'Select or enter a model ID')} style={fieldStyle} onChange={event => setModel(event.target.value)} />
        <datalist id={`${id}-models`}>{models.map(value => <option key={value} value={value} />)}</datalist>
      </label>
      {models.length > 0 && <select aria-label={t('可用模型', 'Available models')} value={models.includes(model) ? model : ''} disabled={disabled} style={fieldStyle} onChange={event => setModel(event.target.value)}>
        {!models.includes(model) && <option value="">{t('从可用模型选择', 'Choose an available model')}</option>}
        {models.map(value => <option key={value} value={value}>{value}</option>)}
      </select>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" disabled={disabled || !baseURL.trim()} style={buttonStyle} onClick={() => { void discover() }}>{busy === 'discovering' ? t('正在获取…', 'Fetching…') : t('获取可用模型', 'Fetch available models')}</button>
        <button type="submit" disabled={disabled || !baseURL.trim() || !model.trim()} style={{ ...buttonStyle, background: 'var(--foreground)', color: 'var(--background)' }}>{busy === 'saving' ? t('正在保存…', 'Saving…') : setup ? t('保存网关并继续', 'Save gateway and continue') : t('保存并重新连接', 'Save and reconnect')}</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted-foreground)', lineHeight: 1.7, margin: 0 }}>{setup ? t('支持 OpenAI 兼容网关。配置会同步到全局模型设置，也可以稍后在设置中修改。', 'Supports OpenAI-compatible gateways. This configuration is shared with model settings and can be changed later.') : t('与引导页及模型设置共用配置。保存后将重新连接，正在运行的任务会中断。', 'Shared with setup and model settings. Saving reconnects the client and interrupts running tasks.')}</p>
      {failure && <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13, overflowWrap: 'anywhere' }}>{failure}</p>}
      {notice && <p role="status" style={{ fontSize: 13 }}>{notice}</p>}
    </form>
  </section>
}
