import { createRequire } from 'node:module'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GatewaySettings } from '../src/client/gateway-settings.tsx'
import type { GatewayBridge } from '../src/gateway-contract.ts'

const { JSDOM } = createRequire(new URL('../../dsh-plugin-desktop/package.json', import.meta.url))('jsdom')
let container: HTMLDivElement, root: Root, dom: any
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://starmind.example/' })
  for (const name of ['window', 'document', 'navigator', 'Event', 'HTMLElement']) vi.stubGlobal(name, name === 'window' ? dom.window : dom.window[name])
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove(); dom.window.close(); vi.unstubAllGlobals() })

it('loads the persisted gateway without putting its saved key into the input', async () => {
  const bridge: GatewayBridge = {
    read: vi.fn(async () => ({ baseURL: 'https://gateway.example/v1', model: 'saved-model', models: ['saved-model'], keyConfigured: true })),
    discover: vi.fn(), save: vi.fn(),
  }
  await act(async () => { root.render(createElement(GatewaySettings, { bridge, language: 'zh' })) })
  expect(container.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe('https://gateway.example/v1')
  expect(container.querySelector<HTMLInputElement>('input[list]')?.value).toBe('saved-model')
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('')
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.placeholder).toContain('已保存密钥')
})

it('autofills the first discovered model and saves the displayed values before continuing setup', async () => {
  const bridge: GatewayBridge = {
    read: vi.fn(async () => ({ baseURL: 'https://gateway.example/v1', model: '', models: [], keyConfigured: false })),
    discover: vi.fn(async () => ['first-model', 'second-model']),
    save: vi.fn(async draft => ({ baseURL: draft.baseURL, model: draft.model, models: draft.models ?? [], keyConfigured: false })),
  }
  const onSaved = vi.fn()
  await act(async () => { root.render(createElement(GatewaySettings, { bridge, language: 'zh', setup: true, onSaved })) })
  const discover = [...container.querySelectorAll('button')].find(button => button.textContent === '获取可用模型')!
  await act(async () => { discover.click() })
  expect(bridge.discover).toHaveBeenCalledWith({ baseURL: 'https://gateway.example/v1', apiKey: '', clearApiKey: false })
  expect(container.querySelector<HTMLInputElement>('input[list]')?.value).toBe('first-model')
  expect(container.querySelectorAll('select option')).toHaveLength(2)
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(bridge.save).toHaveBeenCalledWith({ baseURL: 'https://gateway.example/v1', apiKey: '', clearApiKey: false, model: 'first-model', models: ['first-model', 'second-model'] })
  expect(onSaved).toHaveBeenCalledOnce()
})
