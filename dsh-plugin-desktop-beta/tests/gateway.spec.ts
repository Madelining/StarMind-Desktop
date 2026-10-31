import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { discoverGatewayModels, gatewayBaseURL, readGateway, readGatewayKey, saveGateway } from '../src/gateway.ts'

const roots: string[] = []
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'starmind-gateway-')); roots.push(home)
  const profile = join(home, 'profiles', 'desktop'); mkdirSync(profile, { recursive: true })
  return { home, profile }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('writes the shared provider and default model while keeping credentials out of renderer snapshots', () => {
  const { home, profile } = fixture()
  writeFileSync(join(profile, 'cordis.patch.yml'), '# keep my settings\n- id: another-plugin\n  config:\n    enabled: true\n')
  writeFileSync(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  ANOTHER_KEY: untouched\nrecords: {}\n', { mode: 0o600 })
  const saved = saveGateway(profile, home, { baseURL: 'https://gateway.example/v1/', apiKey: 'private-key', model: 'model-a', models: ['model-a', 'model-b'] })
  expect(saved).toEqual({ baseURL: 'https://gateway.example/v1', model: 'model-a', models: ['model-a', 'model-b'], keyConfigured: true })
  expect(JSON.stringify(saved)).not.toContain('private-key')
  expect(readGateway(profile, home)).toEqual(saved)
  const patch = parse(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'))
  expect(patch[0]).toEqual({ id: 'another-plugin', config: { enabled: true } })
  expect(patch.find((row: any) => row.id === 'llm-pi-ai').config.providers.starmind).toEqual({ displayName: 'StarMind', api: 'openai-completions', baseURL: saved.baseURL, models: [{ id: 'model-a' }, { id: 'model-b' }], apiKeyEnv: 'STARMIND_API_KEY' })
  expect(patch.find((row: any) => row.id === 'agent-default-model').config).toMatchObject({ provider: 'starmind', model: 'model-a' })
  expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toContain('# keep my settings')
  expect(parse(readFileSync(join(home, '.credentials.yaml'), 'utf8')).refs).toEqual({ ANOTHER_KEY: 'untouched', STARMIND_API_KEY: 'private-key' })
})

it('keeps an existing key on blank edits, clears it explicitly, and supports keyless gateways', () => {
  const { home, profile } = fixture()
  const draft = { baseURL: 'http://localhost:8000/v1', model: 'local-model', apiKey: 'stored-key' }
  saveGateway(profile, home, draft)
  expect(saveGateway(profile, home, { ...draft, apiKey: '' }).keyConfigured).toBe(true)
  expect(readGatewayKey(home)).toBe('stored-key')
  expect(saveGateway(profile, home, { ...draft, apiKey: '', clearApiKey: true }).keyConfigured).toBe(false)
  expect(readGatewayKey(home)).toBe('')
  const provider = parse(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).find((row: any) => row.id === 'llm-pi-ai').config.providers.starmind
  expect(provider).not.toHaveProperty('apiKeyEnv')
})

it.each(['file:///tmp/socket', 'https://user:password@example.com/v1', 'https://example.com/v1?key=secret', 'not a URL'])('rejects an invalid gateway URL without writing settings: %s', value => {
  expect(() => gatewayBaseURL(value)).toThrow()
})

it('queries the models endpoint with the one-shot key and preserves endpoint model order', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-b' }] })))
  await expect(discoverGatewayModels({ baseURL: 'https://gateway.example/custom/v1/', apiKey: 'draft-key' }, 'stored-key', request)).resolves.toEqual(['model-b', 'model-a'])
  expect(request).toHaveBeenCalledWith('https://gateway.example/custom/v1/models', expect.objectContaining({ headers: { Accept: 'application/json', Authorization: 'Bearer draft-key' }, credentials: 'omit', redirect: 'error' }))
})

it('reports authentication failures without exposing the key or provider response body', async () => {
  const request = vi.fn(async () => new Response('secret-key provider diagnostic', { status: 401 }))
  await expect(discoverGatewayModels({ baseURL: 'https://gateway.example/v1' }, 'secret-key', request)).rejects.toThrow('HTTP 401')
  await expect(discoverGatewayModels({ baseURL: 'https://gateway.example/v1' }, 'secret-key', request)).rejects.not.toThrow('secret-key')
})

it('preserves the stored documents when a draft is invalid', () => {
  const { home, profile } = fixture()
  saveGateway(profile, home, { baseURL: 'https://gateway.example/v1', model: 'model-a', apiKey: 'key' })
  const path = join(profile, 'cordis.patch.yml'), credentials = join(home, '.credentials.yaml')
  const before = readFileSync(path, 'utf8'), secretBefore = readFileSync(credentials, 'utf8')
  expect(() => saveGateway(profile, home, { baseURL: 'https://gateway.example/v1', model: '', apiKey: 'new-key' })).toThrow()
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(readFileSync(credentials, 'utf8')).toBe(secretBefore)
})
