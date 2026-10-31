/** Configure the same provider, default model, and credential store as Models settings. */
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
import { isMap, isSeq, parseDocument, type Document } from 'yaml'
import { atomicText, readPrivateFile } from './private-files.ts'
import type { GatewayDraft, GatewaySnapshot } from './gateway-contract.ts'

export const GATEWAY_PROVIDER = 'starmind'
export const GATEWAY_KEY_REF = 'STARMIND_API_KEY'

export function gatewayBaseURL(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('请输入有效的 Base URL / Enter a valid Base URL')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Base URL 必须是完整的 HTTP(S) 地址 / Use a complete HTTP(S) Base URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 仅支持 HTTP(S)，不能包含账号、查询参数或片段 / Base URL must be HTTP(S) without credentials, query, or fragment')
  }
  return url.href.replace(/\/+$/u, '')
}

function key(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > 16384 || /[^\x20-\x7e]/u.test(value.trim())) throw new Error('API 密钥格式无效 / Invalid API key')
  return value.trim()
}

function modelIDs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('模型列表无效 / Invalid model list')
  const models = value.map(item => {
    if (typeof item !== 'string' || !item.trim() || item.length > 512 || /[\r\n\0]/u.test(item)) throw new Error('模型名称无效 / Invalid model ID')
    return item.trim()
  })
  return [...new Set(models)]
}

export function parseGatewayDraft(value: unknown): GatewayDraft & { models: string[]; apiKey: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid gateway configuration')
  const input = value as Record<string, unknown>
  if (input.clearApiKey !== undefined && typeof input.clearApiKey !== 'boolean') throw new Error('Invalid credential choice')
  const model = modelIDs([input.model])[0]!
  return { baseURL: gatewayBaseURL(input.baseURL), model, models: modelIDs([model, ...modelIDs(input.models ?? [])]), apiKey: key(input.apiKey), clearApiKey: input.clearApiKey === true }
}

function patchDocument(text: string) {
  const doc = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  if (doc.errors[0]) throw new Error('无法读取 Profile 配置 / Could not read Profile configuration')
  if (!isSeq(doc.contents)) throw new Error('Profile patch must be a YAML sequence')
  return doc
}

function credentialsDocument(text: string | undefined) {
  const doc = parseDocument(text ?? 'version: 1\nrefs: {}\n')
  if (doc.errors[0] || !isMap(doc.contents) || doc.get('version') !== 1 || (doc.has('refs') && !isMap(doc.get('refs')))) {
    throw new Error('无法读取凭据存储 / Could not read credential store')
  }
  return doc
}

/** Last override wins, matching the Profile patch dialect. */
function configAt(doc: Document, id: string, path: string[]): unknown {
  if (!isSeq(doc.contents)) return undefined
  let value: unknown
  doc.contents.items.forEach((item, index) => {
    if (isMap(item) && item.get('id') === id && !item.has('insert') && doc.hasIn([index, 'config', ...path])) {
      value = doc.getIn([index, 'config', ...path], true)
    }
  })
  return value && typeof value === 'object' && 'toJSON' in value ? (value as { toJSON(): unknown }).toJSON() : value
}

function setConfig(doc: Document, id: string, path: string[], value: unknown): void {
  if (!isSeq(doc.contents)) throw new Error('Profile patch must be a YAML sequence')
  const index = doc.contents.items.findLastIndex(item => isMap(item) && item.get('id') === id && !item.has('insert'))
  if (index < 0) { doc.add(doc.createNode({ id, config: {} })); setConfig(doc, id, path, value); return }
  doc.setIn([index, 'config', ...path], value)
}

export function readGateway(profile: string, home: string): GatewaySnapshot {
  const doc = patchDocument(readPrivateFile(join(profile, 'cordis.patch.yml')) ?? '[]\n')
  const provider = configAt(doc, 'llm-pi-ai', ['providers', GATEWAY_PROVIDER]) as Record<string, unknown> | undefined
  const selected = configAt(doc, 'agent-default-model', ['provider']) === GATEWAY_PROVIDER
    ? configAt(doc, 'agent-default-model', ['model']) : undefined
  const models = Array.isArray(provider?.models) ? provider.models.flatMap(item => item && typeof item.id === 'string' ? [item.id] : []) : []
  const credential = credentialsDocument(readPrivateFile(join(home, '.credentials.yaml'))).getIn(['refs', GATEWAY_KEY_REF])
  return { baseURL: typeof provider?.baseURL === 'string' ? provider.baseURL : '', model: typeof selected === 'string' ? selected : models[0] ?? '', models, keyConfigured: typeof credential === 'string' && credential.length > 0 }
}

export function readGatewayKey(home: string): string {
  const credential = credentialsDocument(readPrivateFile(join(home, '.credentials.yaml'))).getIn(['refs', GATEWAY_KEY_REF])
  return typeof credential === 'string' ? credential : ''
}

/** Called before the Host starts, or while it is stopped for an explicit settings save. */
export function saveGateway(profile: string, home: string, value: unknown): GatewaySnapshot {
  const draft = parseGatewayDraft(value)
  const patchPath = join(profile, 'cordis.patch.yml'), credentialPath = join(home, '.credentials.yaml')
  const originalPatch = readPrivateFile(patchPath), originalCredentials = readPrivateFile(credentialPath)
  const doc = patchDocument(originalPatch ?? '[]\n'), credentials = credentialsDocument(originalCredentials)
  const previous = configAt(doc, 'llm-pi-ai', ['providers', GATEWAY_PROVIDER]) as Record<string, unknown> | undefined
  const previousModels = Array.isArray(previous?.models) ? previous.models : []
  const provider: Record<string, unknown> = {
    ...previous, displayName: 'StarMind', api: 'openai-completions', baseURL: draft.baseURL,
    models: draft.models.map(id => ({ ...previousModels.find(item => item && typeof item === 'object' && item.id === id), id })),
  }
  if (!draft.clearApiKey && (draft.apiKey || credentials.hasIn(['refs', GATEWAY_KEY_REF]))) provider.apiKeyEnv = GATEWAY_KEY_REF
  else delete provider.apiKeyEnv
  setConfig(doc, 'llm-pi-ai', ['providers', GATEWAY_PROVIDER], provider)
  setConfig(doc, 'agent-default-model', ['provider'], GATEWAY_PROVIDER)
  setConfig(doc, 'agent-default-model', ['model'], draft.model)
  // An effort chosen for the previous provider might not be valid for this model.
  if (isSeq(doc.contents)) doc.contents.items.forEach((item, index) => {
    if (isMap(item) && doc.getIn([index, 'id']) === 'agent-default-model' && !item.has('insert')) doc.deleteIn([index, 'config', 'reasoningEffort'])
  })
  if (draft.clearApiKey) credentials.deleteIn(['refs', GATEWAY_KEY_REF])
  else if (draft.apiKey) credentials.setIn(['refs', GATEWAY_KEY_REF], draft.apiKey)
  atomicText(credentialPath, String(credentials))
  try { atomicText(patchPath, String(doc)) } catch (error) {
    if (originalCredentials === undefined) unlinkSync(credentialPath)
    else atomicText(credentialPath, originalCredentials)
    throw error
  }
  return readGateway(profile, home)
}

/** Discovery happens in the native process, so gateway CORS policies do not block setup. */
export async function discoverGatewayModels(value: unknown, storedKey: string, request: typeof fetch = fetch): Promise<string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid gateway discovery request')
  const draft = value as Record<string, unknown>
  const baseURL = gatewayBaseURL(draft.baseURL)
  const apiKey = key(draft.apiKey) || (draft.clearApiKey === true ? '' : storedKey)
  let response: Response
  try {
    response = await request(`${baseURL}/models`, { headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) })
  } catch { throw new Error('无法连接网关，请检查地址和网络 / Cannot connect to gateway; check the URL and network') }
  if (!response.ok) throw new Error(`获取模型失败 / Model discovery failed (HTTP ${response.status})`)
  const text = await response.text()
  if (text.length > 4 * 1024 * 1024) throw new Error('模型列表响应过大 / Model list response is too large')
  let payload: { data?: unknown; models?: unknown }
  try { payload = JSON.parse(text) } catch { throw new Error('网关未返回有效 JSON / Gateway did not return valid JSON') }
  const entries = payload?.data ?? payload?.models
  if (!Array.isArray(entries)) throw new Error('网关未返回模型列表 / Gateway did not return a model list')
  const models = modelIDs(entries.map(item => typeof item === 'string' ? item : item?.id ?? item?.name))
  if (!models.length) throw new Error('网关没有返回可用模型，请手动填写 / No models returned; enter a model manually')
  return models
}
