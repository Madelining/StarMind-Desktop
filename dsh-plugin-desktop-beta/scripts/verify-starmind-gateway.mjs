/** A real profile/LLM/credentials integration smoke; never touches the user's home. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { loadNextProfile, NEXT_PACKAGE, NextProfiles, readNextProfilePatches } from '../lib/profiles.js'
import { saveGateway } from '../src/gateway.ts'

const root = dirname(NEXT_PACKAGE)
const temporaryRoot = resolve(tmpdir())
const home = mkdtempSync(join(temporaryRoot, 'starmind-gateway-host-smoke-'))
function cleanup() {
  // Keep recursive cleanup inside the one temporary root this smoke just created.
  if (dirname(resolve(home)) !== temporaryRoot || !home.startsWith(join(temporaryRoot, 'starmind-gateway-host-smoke-'))) throw new Error('Unexpected smoke cleanup path')
  rmSync(home, { recursive: true, force: true })
}
// The official shutdown controller may use process.exit when its grace expires.
process.once('exit', cleanup)
const savedHome = process.env.DSH_HOME
process.env.DSH_HOME = home
let running
let succeeded = false
const timeout = setTimeout(() => { console.error('StarMind gateway Host smoke timed out'); process.exit(1) }, 45000)
timeout.unref()
try {
  const manager = new NextProfiles(home)
  const profileDirectory = manager.ensure('desktop')
  saveGateway(profileDirectory, home, { baseURL: 'http://127.0.0.1:9999/v1', apiKey: 'starmind-smoke-only', model: 'smoke-model', models: ['smoke-model', 'another-model'] })
  const profile = loadNextProfile(profileDirectory, home)
  const overlays = [join(root, 'host.cordis.patch.yml'), join(profileDirectory, 'desktop-next.cordis.patch.json')]
  running = await runProfile({
    environment: loadLayeredEnv('StarMind gateway smoke'), profile: 'desktop',
    resolvedProfile: { profile, installAnchor: NEXT_PACKAGE, readPatches: patches => readNextProfilePatches(profileDirectory, home, overlays, patches) },
    patchFiles: overlays, args: ['--no-open', '--port', '0'],
    packageManager: { command: process.execPath, args: [join(dirname(createRequire(NEXT_PACKAGE).resolve('pnpm')), 'bin', 'pnpm.mjs')] },
  })
  const llm = running.ctx.get('llm')
  const credentials = running.ctx.get('credentials')
  const defaultModel = running.ctx.get('agentDefaultModel')
  assert(llm && credentials && defaultModel, 'The real Host must expose the LLM, credential, and default-model services')
  assert(llm.listProviders().some(row => row.id === 'starmind'), 'The real adapter must register the StarMind route')
  const models = await llm.listModels('starmind')
  assert.deepEqual(models.map(row => row.id), ['smoke-model', 'another-model'])
  assert.equal((await credentials.resolve(credentialRef('STARMIND_API_KEY')))?.value, 'starmind-smoke-only')
  assert.deepEqual(defaultModel.currentSelection(), { provider: 'starmind', model: 'smoke-model' })
  const namespace = running.ctx.get('settings').describe().find(row => row.ns === 'llm-pi-ai')
  assert.equal(namespace?.value?.providers?.starmind?.baseURL, 'http://127.0.0.1:9999/v1')
  console.log('PASS: real Host registered StarMind, exposed both configured models, resolved the saved credential, and selected the configured default model.')
  succeeded = true
} catch (error) {
  console.error('FAIL: StarMind gateway Host smoke:', error instanceof Error ? error.message : String(error))
  throw error
} finally {
  clearTimeout(timeout)
  await running?.shutdown.shutdown(succeeded ? 0 : 1)
  if (savedHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedHome
  cleanup()
}
