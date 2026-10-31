import { describe, expect, it, vi } from 'vitest'
import { createDesktopGatewayBridge } from '../src/client/gateway-bridge.ts'
import { parseGatewayDraft } from '../src/gateway.ts'

function fixture() {
  const values: Record<string, Record<string, any>> = {
    'llm-pi-ai': { providers: { other: { baseURL: 'https://other.test/v1' }, starmind: {
      baseURL: 'https://first.test/v1', apiKeyEnv: 'STARMIND_API_KEY',
      models: [{ id: 'first', name: 'Keep metadata', contextWindow: 64000 }], headers: { 'X-Custom': 'keep' },
    } } },
    'agent-default-model': { provider: 'starmind', model: 'first', reasoningEffort: 'high' },
  }
  const credentials: Record<string, string> = { STARMIND_API_KEY: 'test-only-key' }
  const revisions: Record<string, number> = { 'llm-pi-ai': 3, 'agent-default-model': 7 }
  const namespace = (ns: string) => ({ ns, value: structuredClone(values[ns]), revision: revisions[ns]! })
  const remote = {
    settings: {
      describe: vi.fn(async () => ({ ok: true as const, value: { writable: true, namespaces: Object.keys(values).map(namespace) } })),
      mutate: vi.fn(async (ns: string, ops: { op: 'set' | 'unset'; path: string[]; value?: unknown }[], expected: number | undefined) => {
        expect(expected).toBe(revisions[ns])
        for (const op of ops) {
          let target: Record<string, any> = values[ns]!
          for (const key of op.path.slice(0, -1)) target = target[key] ??= {}
          const key = op.path.at(-1)!
          if (op.op === 'set') target[key] = structuredClone(op.value)
          else delete target[key]
        }
        revisions[ns]!++
        return { ok: true as const, value: namespace(ns) }
      }),
      update: vi.fn(async (ns: string, patch: Record<string, unknown>, expected: number | undefined) => {
        expect(expected).toBe(revisions[ns])
        Object.assign(values[ns]!, patch)
        revisions[ns]!++
        return { ok: true as const, value: namespace(ns) }
      }),
    },
    credentials: {
      describe: vi.fn(async (refs: string[]) => ({ ok: true as const, value: Object.fromEntries(refs.map(ref => [ref, { configured: Boolean(credentials[ref]) }])) })),
      set: vi.fn(async (ref: string, value: string) => { credentials[ref] = value; return { ok: true as const, value: undefined } }),
      unset: vi.fn(async (ref: string) => { delete credentials[ref]; return { ok: true as const, value: undefined } }),
    },
  }
  const native = { validate: vi.fn(async (draft: unknown) => parseGatewayDraft(draft)), discover: vi.fn(async (_draft: unknown) => ['first', 'second']) }
  const afterSave = vi.fn(async () => {})
  return { remote, values, credentials, native, afterSave, bridge: createDesktopGatewayBridge(remote, native, afterSave) }
}

describe('Stable live gateway adapter', () => {
  it('reads the upstream model and credential state without returning secrets', async () => {
    const view = fixture()
    expect(await view.bridge.read()).toEqual({ baseURL: 'https://first.test/v1', model: 'first', models: ['first'], keyConfigured: true })
    expect(JSON.stringify(await view.bridge.read())).not.toContain('test-only-key')
    view.values['agent-default-model']!.model = 'edited-in-main-settings'
    expect((await view.bridge.read()).model).toBe('edited-in-main-settings')
  })

  it('saves through shared upstream forms, preserving other providers and model metadata', async () => {
    const view = fixture()
    const saved = await view.bridge.save({ baseURL: 'https://new.test/v1/', apiKey: 'new-test-key', model: 'second', models: ['first', 'second'] })
    expect(saved).toMatchObject({ baseURL: 'https://new.test/v1', model: 'second', models: ['second', 'first'], keyConfigured: true })
    expect(view.values['llm-pi-ai']!.providers.other).toEqual({ baseURL: 'https://other.test/v1' })
    expect(view.values['llm-pi-ai']!.providers.starmind.headers).toEqual({ 'X-Custom': 'keep' })
    expect(view.values['llm-pi-ai']!.providers.starmind.models).toContainEqual({ id: 'first', name: 'Keep metadata', contextWindow: 64000 })
    expect(view.values['agent-default-model']).toEqual({ provider: 'starmind', model: 'second' })
    expect(view.credentials.STARMIND_API_KEY).toBe('new-test-key')
    expect(view.afterSave).toHaveBeenCalledOnce()
  })

  it('keeps a blank key and supports explicit clearing through the credential owner', async () => {
    const view = fixture()
    await view.bridge.save({ baseURL: 'https://first.test/v1', model: 'first', apiKey: '' })
    expect(view.remote.credentials.set).not.toHaveBeenCalled()
    expect(view.credentials.STARMIND_API_KEY).toBe('test-only-key')
    expect((await view.bridge.save({ baseURL: 'https://first.test/v1', model: 'first', clearApiKey: true })).keyConfigured).toBe(false)
    expect(view.values['llm-pi-ai']!.providers.starmind).not.toHaveProperty('apiKeyEnv')
    expect(view.credentials).not.toHaveProperty('STARMIND_API_KEY')
    expect(view.remote.credentials.unset).toHaveBeenCalledExactlyOnceWith('STARMIND_API_KEY')
  })

  it('rejects invalid configuration before any credential or settings write', async () => {
    const view = fixture()
    await expect(view.bridge.save({ baseURL: 'file:///tmp/key', apiKey: 'not-stored', model: 'first' })).rejects.toThrow('HTTP(S)')
    expect(view.remote.settings.mutate).not.toHaveBeenCalled()
    expect(view.remote.settings.update).not.toHaveBeenCalled()
    expect(view.remote.credentials.set).not.toHaveBeenCalled()
    expect(view.afterSave).not.toHaveBeenCalled()
  })

  it('surfaces upstream write conflicts without changing the selected model or restarting', async () => {
    const view = fixture()
    view.remote.settings.mutate.mockImplementationOnce(async () => ({ ok: false, error: { message: 'Settings conflict: reload and retry' } }) as any)
    await expect(view.bridge.save({ baseURL: 'https://new.test/v1', model: 'second' })).rejects.toThrow('Settings conflict')
    expect(view.remote.settings.mutate).toHaveBeenCalledOnce()
    expect(view.remote.settings.update).not.toHaveBeenCalled()
    expect(view.values['agent-default-model']!.model).toBe('first')
    expect(view.afterSave).not.toHaveBeenCalled()
  })

  it('uses the native discovery bridge for both setup and settings', async () => {
    const view = fixture()
    const request = { baseURL: 'https://first.test/v1', apiKey: '' }
    expect(await view.bridge.discover(request)).toEqual(['first', 'second'])
    expect(view.native.discover).toHaveBeenCalledExactlyOnceWith(request)
    expect(view.remote.credentials.describe).not.toHaveBeenCalled()
  })
})
