import { describe, expect, it } from 'vitest'
import { brandClientSource, brandWebIndex, starmindBrandAsset } from '../src/starmind-branding.ts'
import { NextUpdates } from '../src/updates.ts'
import { updateAction, updateLabel } from '../src/update-state.ts'

describe('StarMind presentation', () => {
  it('rebrands product copy while preserving provider module IDs, API endpoints and model names', () => {
    const source = '"DeepSeek Harness"; "探索未至之境"; "Into the Unknown"; "深度求索中"; "HARNESS"; "@deepseek-ai/dsh"; "https://api.deepseek.com"; "deepseek-chat"'
    const branded = brandClientSource(source)
    expect(branded).toContain('"StarMind"; "让专注成为一种习惯"; "Make focus a habit"; "深度思考中"; "STARMIND"')
    expect(branded).toContain('"@deepseek-ai/dsh"; "https://api.deepseek.com"; "deepseek-chat"')
    expect(brandWebIndex('<head><title>DeepSeek Harness</title><link rel="icon" href="favicon.svg"></head>')).toContain('<title>StarMind</title>')
    expect(brandWebIndex('<link rel="icon" href="favicon.svg">')).toContain('data:image/svg+xml,')
  })

  it('serves StarMind resources without intercepting API responses or user files', async () => {
    expect(await starmindBrandAsset('/favicon.svg')?.text()).toContain('StarMind')
    expect(await starmindBrandAsset('/plugins/@deepseek-ai/dsh-client-ui-chat/assets/running-whale%402x-123abc.png')?.text()).toContain('StarMind')
    expect(await starmindBrandAsset('/manifest.webmanifest')?.json()).toMatchObject({ name: 'StarMind' })
    expect(starmindBrandAsset('/api/sessions')).toBeUndefined()
    expect(starmindBrandAsset('/workspace/favicon.svg')).toBeUndefined()
    expect(starmindBrandAsset('/favicon.svg', 'POST')).toBeUndefined()
    expect(starmindBrandAsset('/favicon.svg', 'HEAD')?.body).toBeNull()
  })

  it('keeps the branded application off upstream installer and tracking endpoints', async () => {
    const fail = () => { throw new Error('An upstream updater endpoint was contacted') }
    const updates = new NextUpdates({ disabled: true, version: '1.0.0', platform: 'win32', packaged: true,
      userData: '', request: fail, artifactRequest: fail, prepare: fail, install: fail, changed: fail, log: fail })
    updates.start()
    await updates.check()
    await updates.download()
    await updates.install()
    expect(updates.snapshot()).toMatchObject({ disabled: true, installable: false })
    expect(updateAction(updates.snapshot())).toBeUndefined()
    expect(updateLabel(updates.snapshot(), 'zh')).toContain('StarMind 本地构建')
    await updates.dispose()
  })
})
