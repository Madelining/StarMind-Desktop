import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { prepareDesktopProfile } from '../src/profile.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

it('opens a fresh StarMind profile without requiring account or credential onboarding', () => {
  const home = mkdtempSync(join(tmpdir(), 'starmind-account-onboarding-'))
  homes.push(home)
  const profile = prepareDesktopProfile(undefined, home, 'win32')
  const entries = composeEntries([profile.patches])
  expect(entries.find(row => row.id === 'ui-settings-models')).toMatchObject({
    name: '@deepseek-ai/dsh-client-ui-settings-models', config: { credentialOnboarding: false },
  })
})
