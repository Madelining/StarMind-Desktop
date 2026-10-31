/** Native validation and discovery; configuration writes stay on the live Host. */
import type { GatewayDraft } from './gateway-contract.ts'

export interface GatewayNativeBridge {
  validate(draft: unknown): Promise<GatewayDraft>
  discover(draft: Pick<GatewayDraft, 'baseURL' | 'apiKey' | 'clearApiKey'>): Promise<string[]>
}
