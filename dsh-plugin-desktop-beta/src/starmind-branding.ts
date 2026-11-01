/** Product presentation applied only to application-owned static frontend assets. */
import { STARMIND_LOGO_SVG } from './starmind-artwork.ts'
export { STARMIND_LOGO_SVG } from './starmind-artwork.ts'
export const STARMIND_NAME = 'StarMind'
export const STARMIND_TAGLINE = '让专注成为一种习惯'
export const STARMIND_IDENTITY = 'You are StarMind, an AI assistant that helps people focus and complete tasks. StarMind: 让专注成为一种习惯。'

export const STARMIND_LOGO_DATA_URL = 'data:image/svg+xml,' + encodeURIComponent(STARMIND_LOGO_SVG)

/** Keep upstream modules intact on disk; replace product copy as the Desktop serves its UI. */
export function brandClientSource(source: string): string {
  return source.replaceAll('DeepSeek Harness', STARMIND_NAME)
    .replaceAll('Harness home', `${STARMIND_NAME} home`)
    .replace(/\bHarness\b/gu, STARMIND_NAME)
    .replace(/\bDSH\b/gu, STARMIND_NAME)
    .replaceAll('dsh web', `${STARMIND_NAME} Web`)
    .replaceAll('dsh desktop', `${STARMIND_NAME} desktop`)
    .replaceAll('探索未至之境', STARMIND_TAGLINE)
    .replaceAll('Into the Unknown', 'Make focus a habit')
    .replaceAll('深度求索中', '深度思考中')
    .replaceAll('DSH Terminal', 'StarMind Terminal')
    .replaceAll('DSH 终端', 'StarMind 终端')
    .replace(/(["'])HARNESS\1/gu, '$1STARMIND$1')
}

/** Give the published frontend a product title and an owned favicon before first paint. */
export function brandWebIndex(source: string): string {
  return brandClientSource(source).replace(/<title>[^<]*<\/title>/iu, '<title>StarMind</title>')
    .replace(/(<link\b[^>]*\brel=["'](?:icon|apple-touch-icon)["'][^>]*\bhref=)["'][^"']*["']/giu, `$1"${STARMIND_LOGO_DATA_URL}"`)
}

/** Override only brand resources, never user files, model responses or API payloads. */
export function starmindBrandAsset(path: string, method = 'GET'): Response | undefined {
  if (method !== 'GET' && method !== 'HEAD') return undefined
  if (path === '/manifest.webmanifest') return new Response(method === 'HEAD' ? null : JSON.stringify({
    name: STARMIND_NAME, short_name: STARMIND_NAME, description: STARMIND_TAGLINE,
    display: 'standalone', start_url: './', icons: [{ src: './favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' } })
  if (/^\/(?:favicon(?:-dark)?\.svg|apple-touch-icon\.png|icon-(?:192|512)(?:-maskable)?\.png)$/u.test(path)
    || /^\/plugins\/[^?#]*\/(?:running-whale(?:%40|@)2x-[\da-f]+\.png|favicon(?:-dark)?\.svg)$/iu.test(path)) {
    return new Response(method === 'HEAD' ? null : STARMIND_LOGO_SVG,
      { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } })
  }
  return undefined
}
