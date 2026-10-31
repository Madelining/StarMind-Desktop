/** Shared by the first-run wizard and the main window's gateway settings. */
export interface GatewaySnapshot {
  baseURL: string
  model: string
  models: string[]
  keyConfigured: boolean
}

export interface GatewayDraft {
  baseURL: string
  model: string
  models?: string[]
  /** Blank keeps the stored credential; clearing is an explicit choice. */
  apiKey?: string
  clearApiKey?: boolean
}

export interface GatewayBridge {
  read(): Promise<GatewaySnapshot>
  save(draft: GatewayDraft): Promise<GatewaySnapshot>
  discover(draft: Pick<GatewayDraft, 'baseURL' | 'apiKey' | 'clearApiKey'>): Promise<string[]>
}
