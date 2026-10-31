/** StarMind owns the documented product-brand slots; model providers retain their real names. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { STARMIND_LOGO_DATA_URL } from '../starmind-branding.ts'

export function StarMindMark({ size = 24, className }: { size?: number | undefined; className?: string | undefined }) {
  return <img src={STARMIND_LOGO_DATA_URL} alt="StarMind" width={size} height={size} className={className} style={{ display: 'inline-block', objectFit: 'contain', flexShrink: 0 }} />
}

function StarMindName() {
  return <span style={{ fontFamily: 'Inter, Segoe UI, sans-serif', fontSize: 18, fontWeight: 650, letterSpacing: '-.03em' }}>StarMind</span>
}

export function registerStarMindBrand(ctx: Context): void {
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -100 }, StarMindMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -100 }, StarMindName))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -100 }, StarMindMark))
  ctx.effect(() => {
    const previous = document.title
    document.title = 'StarMind'
    // The upstream run indicator has a decorative SVG fallback as well as its animation asset.
    const style = document.createElement('style')
    style.dataset.starmindBrand = ''
    style.textContent = `[data-chat-running] [aria-hidden="true"]:has(>svg) { background: url("${STARMIND_LOGO_DATA_URL}") center / contain no-repeat; } [data-chat-running] [aria-hidden="true"]:has(>svg)>* { visibility: hidden; }`
    document.head.append(style)
    return () => { document.title = previous; style.remove() }
  }, 'StarMind document title')
}
