/** Both setup and Settings edit the same live configuration forms and credentials. */
import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { GatewayBridge, GatewayDraft, GatewaySnapshot } from '../gateway-contract.ts'
import type { GatewayNativeBridge } from '../gateway-native-contract.ts'

const PROVIDER = 'starmind'
const KEY_REF = 'STARMIND_API_KEY'
type Result<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
interface Namespace { ns: string; value: unknown; revision: number }
export interface DesktopGatewayRemote {
  settings: {
    describe(): Promise<Result<{ writable: boolean; namespaces: Namespace[] }>>
    mutate(ns: string, ops: SettingsPathOpView[], expectedRevision: number | undefined): Promise<Result<Namespace>>
  }
  credentials: {
    describe(refs: string[]): Promise<Result<Record<string, { configured: boolean }>>>
    set(ref: string, value: string): Promise<Result<void>>
    unset(ref: string): Promise<Result<void>>
  }
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function createDesktopGatewayBridge(
  remote: DesktopGatewayRemote,
  native?: GatewayNativeBridge,
  afterSave?: () => Promise<void>,
): GatewayBridge {
  async function state() {
    const description = unwrap(await remote.settings.describe())
    const providerNamespace = description.namespaces.find(item => item.ns === 'llm-pi-ai')
    const modelNamespace = description.namespaces.find(item => item.ns === 'agent-default-model')
    if (!providerNamespace || !modelNamespace) throw new Error('模型设置尚未就绪，请稍后重试 / Model settings are not ready; retry shortly')
    const provider = object(object(object(providerNamespace.value).providers)[PROVIDER])
    const defaults = object(modelNamespace.value)
    const credentials = unwrap(await remote.credentials.describe([KEY_REF]))
    const models = Array.isArray(provider.models) ? provider.models.flatMap(item => typeof object(item).id === 'string' ? [object(item).id as string] : []) : []
    const snapshot: GatewaySnapshot = {
      baseURL: typeof provider.baseURL === 'string' ? provider.baseURL : '',
      model: defaults.provider === PROVIDER && typeof defaults.model === 'string' ? defaults.model : models[0] ?? '',
      models,
      keyConfigured: provider.apiKeyEnv === KEY_REF && credentials[KEY_REF]?.configured === true,
    }
    return { description, providerNamespace, modelNamespace, provider, credentials, snapshot }
  }

  return {
    read: async () => (await state()).snapshot,
    discover: async draft => {
      if (!native) throw new Error('原生网关连接不可用 / Native gateway connection is unavailable')
      return native.discover(draft)
    },
    save: async (input: GatewayDraft) => {
      if (!native) throw new Error('原生网关连接不可用 / Native gateway connection is unavailable')
      // Validate before any credential or profile mutation. This is the same
      // normalizer used by the other Desktop editions and native discovery.
      const draft = await native.validate(input)
      const current = await state()
      if (!current.description.writable) throw new Error('当前 Profile 的设置为只读 / This Profile is read-only')
      if (!draft.clearApiKey && draft.apiKey) unwrap(await remote.credentials.set(KEY_REF, draft.apiKey))
      const hasKey = !draft.clearApiKey && Boolean(draft.apiKey || current.credentials[KEY_REF]?.configured)
      const previousModels = Array.isArray(current.provider.models) ? current.provider.models : []
      const models = (draft.models ?? [draft.model]).map(id => ({
        ...object(previousModels.find(item => object(item).id === id)), id,
      }))
      const fields: Record<string, JsonValue> = { displayName: 'StarMind', api: 'openai-completions', baseURL: draft.baseURL, models: models as JsonValue }
      const ops: SettingsPathOpView[] = Object.entries(fields).map(([name, value]) => ({ op: 'set', path: ['providers', PROVIDER, name], value }))
      ops.push(hasKey ? { op: 'set', path: ['providers', PROVIDER, 'apiKeyEnv'], value: KEY_REF }
        : { op: 'unset', path: ['providers', PROVIDER, 'apiKeyEnv'] })
      unwrap(await remote.settings.mutate(current.providerNamespace.ns, ops, current.providerNamespace.revision))
      // These are the upstream model picker's own live form fields. Its model
      // catalog and the main Settings page observe the same change events.
      unwrap(await remote.settings.mutate(current.modelNamespace.ns, [
        { op: 'set', path: ['provider'], value: PROVIDER },
        { op: 'set', path: ['model'], value: draft.model },
        { op: 'unset', path: ['reasoningEffort'] },
      ], current.modelNamespace.revision))
      if (draft.clearApiKey) unwrap(await remote.credentials.unset(KEY_REF))
      const saved = (await state()).snapshot
      await afterSave?.()
      return saved
    },
  }
}
