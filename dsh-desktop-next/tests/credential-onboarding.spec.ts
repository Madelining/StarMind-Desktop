import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { loadNextProfile, NextProfiles } from '../src/profiles.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

it('opens a fresh StarMind profile without requiring account or credential onboarding', () => {
  const home = mkdtempSync(join(tmpdir(), 'starmind-account-onboarding-'))
  homes.push(home)
  const profiles = new NextProfiles(home)
  const dir = profiles.ensure('desktop')
  const profile = loadNextProfile(dir, home)
  const entries = composeEntries([...profile.layers.map(layer => layer.patches), loadOverlayPatches('next', profile.patchPath)])
  expect(entries.find(row => row.id === 'ui-settings-models')).toMatchObject({
    name: '@deepseek-ai/dsh-client-ui-settings-models', config: { credentialOnboarding: false },
  })
})
