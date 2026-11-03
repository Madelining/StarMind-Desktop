import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { escapeHtml, formatBytes, formatDate, publicationError, safeLink, operationOutcome, apiUrl, createApi, downloadUrl, normalizeBundles } from '../public/core.js'

test('untrusted names and README text escape all HTML metacharacters', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">&\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;')
  assert.equal(escapeHtml(null), '')
})

test('links cannot execute scripts, smuggle credentials or use control characters', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'https://user:secret@company.internal/a', 'java\nscript:alert(1)', ' https://company.internal']) assert.equal(safeLink(value), undefined)
  assert.equal(safeLink('/docs', 'https://company.internal/market/'), 'https://company.internal/docs')
  assert.equal(safeLink('https://company.internal/a#readme'), 'https://company.internal/a#readme')
})

test('publication failure explains the exact missing dependency without losing the request number', () => {
  const message = publicationError({ error: { code: 'DEPENDENCY_MISSING', message: '缺少依赖', details: { owner: '@company/plugin@1.0.0', dependency: 'helper', range: '^2', availableVersions: ['1.0.0'], requestId: 'request-123' } } })
  for (const fragment of ['缺少依赖', '@company/plugin@1.0.0', 'helper', '^2', '1.0.0', 'request-123', 'DEPENDENCY_MISSING']) assert(message.includes(fragment))
})

test('activation failure, cancellation, restart and rollback are different from a successful HTTP response', () => {
  assert.equal(operationOutcome({ result: { application: 'failed' } }).status, 'failed')
  const restored = operationOutcome({ result: { application: 'failed' }, restore: { application: 'applied' } })
  assert.equal(restored.status, 'failed'); assert.equal(restored.restored, true)
  assert.equal(operationOutcome({ result: { application: 'cancelled' } }).status, 'cancelled')
  assert.equal(operationOutcome({ result: { restartRequired: true } }).status, 'restart')
  assert.equal(operationOutcome({ result: { application: 'applied' } }).status, 'completed')
  assert.equal(operationOutcome({ ok: true }).status, 'unknown')
  assert.equal(operationOutcome(undefined).status, 'unknown')
})

test('formatting handles unknown values and uses binary byte units', () => {
  assert.equal(formatBytes(1024), '1.0 KiB')
  assert.equal(formatBytes(256 * 1024 * 1024), '256 MiB')
  assert.equal(formatBytes(NaN), '大小未知')
  assert.equal(formatDate('invalid'), '发布时间未知')
})

test('proxy API and download links stay under the nonce prefix and never send tokens to metadata URLs', async () => {
  const id = 'a'.repeat(64)
  assert.equal(downloadUrl(`https://company.internal/api/releases/${id}/download`, id), apiUrl(`api/releases/${id}/download`))
  assert.equal(downloadUrl(`https://company.internal/api/releases/${id}/withdraw`, id), null)
  assert.equal(downloadUrl(`file:///api/releases/${id}/download`, id), null)
  assert.equal(downloadUrl(`/api/releases/${id}/download`, 'not-an-id'), null)
  let request
  const api = createApi(() => 'test-only-token', async (url, options) => { request = { url, options }; return Response.json({ release: { id } }) })
  await api('api/releases', { method: 'POST', body: '{}' })
  assert.equal(request.url, apiUrl('api/releases'))
  assert.equal(request.options.headers.get('authorization'), 'Bearer test-only-token')
  assert.equal(request.options.headers.get('x-starmind-market-request'), '1')
  assert.equal(request.options.redirect, 'error')
  assert.equal(request.options.credentials, 'omit')
  await assert.rejects(api('https://outside.invalid/api/releases'), /相对路径/u)
  await assert.rejects(api('../operation'), /不能跳出/u)
})

test('API errors keep actionable details; bundle display preserves disabled and not-installed states', async () => {
  const api = createApi(() => '', async () => Response.json({ error: { code: 'DEPENDENCY_MISSING', message: '缺少依赖', details: { dependency: 'helper', range: '^2' } } }, { status: 422 }))
  await assert.rejects(api('api/releases'), error => error.status === 422 && error.details.range === '^2' && error.message.includes('helper'))
  const bundles = normalizeBundles({ result: { bundles: [{ name: '@company/a', enabled: false, installed: false }, { name: 'b', enabled: true, installed: true }] } })
  assert.equal(bundles[0].enabled, false); assert.equal(bundles[0].installed, false)
  assert.equal(bundles[1].installed, true)
})

test('the shell loads only local executable assets and gives upload and errors accessible labels', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8')
  assert(!/<(?:script|link)\b[^>]*(?:src|href)=["'](?:https?:)?\/\//iu.test(html))
  assert.match(html, /lang="zh-CN"/u)
  assert.match(html, /id="publishError"[^>]+role="alert"/u)
  assert.match(html, /for="packageFiles"/u)
  assert.match(html, /aria-labelledby="publishTitle"/u)
})
