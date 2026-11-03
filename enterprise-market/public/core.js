// Shared, side-effect-free display rules. They never treat an HTTP 200 as proof of plugin activation.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '大小未知'
  if (value < 1024) return `${Math.round(value)} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let size = value / 1024, index = 0
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++ }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

export function formatDate(value) {
  const date = new Date(value)
  if (!value || !Number.isFinite(date.getTime())) return '发布时间未知'
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Links may be followed only on an explicit user action. Remote images and automatic imports use no such exemption. */
export function safeLink(value, base = 'http://localhost/') {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/u.test(value)) return undefined
  try {
    const url = new URL(value, base)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.href
  } catch { return undefined }
}

function describe(value, maximum = 3000) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.slice(0, maximum)
  try { return JSON.stringify(value, null, 2).slice(0, maximum) } catch { return '无法显示详细信息' }
}

export function publicationError(payload) {
  const error = payload?.error ?? payload
  if (typeof error === 'string') return error
  const message = typeof error?.message === 'string' ? error.message : '操作失败，请稍后重试。'
  const details = error?.details
  const fields = []
  if (details && typeof details === 'object') {
    const labels = [['package', '包'], ['owner', '来源包'], ['field', '声明位置'], ['dependency', '缺失依赖'], ['target', '真实包名'], ['range', '需要版本'], ['availableVersions', '已上传版本'], ['scripts', '安装脚本'], ['missingDependencies', '缺失依赖'], ['missingResources', '缺失离线资源'], ['requestId', '请求编号']]
    const known = new Set(labels.map(([key]) => key))
    for (const [key, label] of labels) {
      if (details[key] !== undefined) fields.push(`${label}：${describe(details[key])}`)
    }
    for (const [key, value] of Object.entries(details)) if (!known.has(key) && !/token|password|secret|authorization|cookie|credential/iu.test(key)) fields.push(`${key}：${describe(value)}`)
  }
  return [message, ...(typeof error?.code === 'string' ? [`错误代码：${error.code}`] : []), ...fields].join('\n')
}

function changeRecord(value) {
  let current = value
  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    if (typeof current.application === 'string' || current.error || current.ok === false || current.restartRequired === true) return current
    if (!current.result) return current
    current = current.result
  }
  return undefined
}

export function operationOutcome(value) {
  const record = changeRecord(value)
  if (!record) return { status: 'unknown', message: '管理器尚未返回可确认的加载结果，请刷新已安装状态。' }
  const application = record.application
  const restore = changeRecord(value?.restore ?? value?.result?.restore)
  if (record.ok === false || record.error || application === 'failed') {
    const restored = restore && ['applied', 'success'].includes(restore.application) && !restore.error && restore.ok !== false
    return { status: 'failed', restored: Boolean(restored), message: `${restored ? '更新失败，管理器已恢复旧版本。' : '插件操作失败。'}${record.error ? ` ${describe(record.error)}` : ''}` }
  }
  if (application === 'cancelled' || application === 'canceled') return { status: 'cancelled', message: '操作已取消。' }
  if (record.restartRequired === true || ['restart-required', 'requires-restart', 'pending-restart', 'deferred'].includes(application)) {
    return { status: 'restart', message: '包已处理，需要重启 StarMind 后确认插件加载。' }
  }
  if (['applied', 'success', 'removed'].includes(application)) return { status: 'completed', message: '管理器已完成操作，请查看当前安装状态。' }
  return { status: 'unknown', message: '管理器已返回；包的安装状态与插件加载状态请以已安装列表为准。' }
}

export const BASE = new URL('.', import.meta.url)
export function apiUrl(path) {
  if (typeof path !== 'string' || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(path)) throw new Error('接口必须使用当前市场的相对路径')
  const url = new URL(path.replace(/^\//u, ''), BASE)
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) throw new Error('接口不能跳出当前市场')
  return url.href
}
export function text(value, fallback = '') {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    for (const key of ['zh', 'zh-CN', 'en']) if (typeof value[key] === 'string') return value[key]
  }
  return fallback
}
export const bytes = formatBytes
export const date = formatDate
export const errorText = publicationError
export const isPackageName = value => typeof value === 'string' && value.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(value)

export function downloadUrl(value, releaseId) {
  if (typeof releaseId !== 'string' || !/^[a-f0-9]{64}$/u.test(releaseId)) return null
  if (value) {
    try {
      const url = new URL(value, 'http://market.invalid/')
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== `/api/releases/${releaseId}/download`) return null
    } catch { return null }
  }
  return apiUrl(`api/releases/${releaseId}/download`)
}

export function normalizeBundles(value) {
  let records = value
  for (let depth = 0; depth < 4 && !Array.isArray(records); depth++) records = records?.bundles ?? records?.result
  if (!Array.isArray(records)) return []
  return records.filter(row => row && typeof row === 'object' && isPackageName(row.name ?? row.packageName)).map(row => ({
    ...row, name: row.name ?? row.packageName, enabled: row.enabled !== false, installed: row.installed !== false,
  }))
}

export function operationMessage(result, action = '操作') {
  const outcome = operationOutcome(result)
  return { error: outcome.status === 'failed', text: `${action}：${outcome.message}`, status: outcome.status }
}

export function createApi(getToken, fetchImpl = globalThis.fetch) {
  return async (path, options = {}) => {
    const method = options.method ?? 'GET'
    const headers = new Headers(options.headers)
    headers.set('accept', 'application/json')
    const token = getToken?.()
    if (token) headers.set('authorization', `Bearer ${token}`)
    if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
      headers.set('x-starmind-market-request', '1')
      if (typeof options.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json')
    }
    const response = await fetchImpl(apiUrl(path), { ...options, method, headers, credentials: 'omit', redirect: 'error' })
    let payload
    try { payload = await response.json() }
    catch { throw Object.assign(new Error(`市场返回了无法解析的响应（HTTP ${response.status}）`), { status: response.status }) }
    if (!response.ok || payload?.error) throw Object.assign(new Error(publicationError(payload)), { status: response.status, details: payload?.error?.details, code: payload?.error?.code })
    return payload
  }
}
