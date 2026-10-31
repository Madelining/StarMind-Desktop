/** Exercise the Stable adapter against a real upstream Host in a disposable home. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initProfile, loadLayeredEnv, loadProfileDirectory, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createDesktopGatewayBridge } from '../src/client/gateway-bridge.ts'
import { parseGatewayDraft } from '../src/gateway.ts'

const temporaryRoot = resolve(tmpdir())
const home = mkdtempSync(join(temporaryRoot, 'starmind-stable-live-smoke-'))
const anchor = fileURLToPath(new URL('../package.json', import.meta.url))
const savedHome = process.env.DSH_HOME
process.env.DSH_HOME = home
function cleanup() {
  if (dirname(resolve(home)) !== temporaryRoot || !home.startsWith(join(temporaryRoot, 'starmind-stable-live-smoke-'))) throw new Error('Unexpected smoke cleanup target')
  rmSync(home, { recursive: true, force: true })
}
process.once('exit', cleanup)
const timeout = setTimeout(() => { console.error('Stable live gateway smoke timed out'); process.exit(1) }, 45000)
timeout.unref()
let running, succeeded = false
try {
  const directory = join(home, 'profiles', 'web')
  initProfile(directory, PROFILE_TEMPLATES.web.bundles)
  const profile = loadProfileDirectory('web', directory, anchor)
  running = await runProfile({ environment: loadLayeredEnv('StarMind live gateway smoke'), profile: 'web',
    resolvedProfile: { profile, installAnchor: anchor }, patchFiles: [], args: ['--no-open', '--port', '0'] })
  const settings = running.ctx.get('settingsController')
  const credentials = running.ctx.get('credentialsController')
  assert(settings && credentials, 'The real Host must expose configuration and credential APIs')
  const wrap = method => async (...args) => {
    try { return { ok: true, value: await method(...args) } }
    catch (error) { return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } } }
  }
  const remote = {
    settings: { describe: wrap(() => settings.describe()), mutate: wrap((...args) => settings.mutate(...args)) },
    credentials: { describe: wrap(refs => credentials.describe(refs)), set: wrap((ref, value) => credentials.set(ref, value)), unset: wrap(ref => credentials.unset(ref)) },
  }
  const native = { validate: async draft => parseGatewayDraft(draft), discover: async () => [] }
  const bridge = createDesktopGatewayBridge(remote, native)
  assert.equal((await bridge.read()).keyConfigured, false)
  await bridge.save({ baseURL: 'http://127.0.0.1:9999/v1', apiKey: 'stable-live-smoke-key', model: 'smoke-model', models: ['smoke-model', 'second-model'] })
  const llm = running.ctx.get('llm')
  const defaultModel = running.ctx.get('agentDefaultModel')
  assert(llm.listProviders().some(row => row.id === 'starmind'), 'Live form writes must activate the StarMind route')
  assert.deepEqual((await llm.listModels('starmind')).map(row => row.id), ['smoke-model', 'second-model'])
  assert.deepEqual(defaultModel.currentSelection(), { provider: 'starmind', model: 'smoke-model' })
  assert.equal((await running.ctx.get('credentials').resolve(credentialRef('STARMIND_API_KEY')))?.value, 'stable-live-smoke-key')
  assert(!readFileSync(join(directory, 'cordis.patch.yml'), 'utf8').includes('stable-live-smoke-key'), 'The API key must stay in the credential store')
  const settingsView = await createDesktopGatewayBridge(remote, native).read()
  assert.equal(settingsView.baseURL, 'http://127.0.0.1:9999/v1')
  assert.equal(settingsView.model, 'smoke-model')
  assert.equal(settingsView.keyConfigured, true)
  await bridge.save({ baseURL: settingsView.baseURL, model: 'second-model', models: settingsView.models, clearApiKey: true })
  assert.deepEqual(defaultModel.currentSelection(), { provider: 'starmind', model: 'second-model' })
  assert.equal((await bridge.read()).keyConfigured, false)
  assert.equal(await running.ctx.get('credentials').resolve(credentialRef('STARMIND_API_KEY')), undefined)
  console.log('PASS: Stable live gateway writes activated the real provider and model catalog, synchronized settings, persisted the selected model, and stored/cleared its credential.')
  succeeded = true
} finally {
  clearTimeout(timeout)
  await running?.shutdown.shutdown(succeeded ? 0 : 1)
  if (savedHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedHome
  cleanup()
}
