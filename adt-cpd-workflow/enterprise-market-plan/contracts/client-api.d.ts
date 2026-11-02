import type { EnterprisePolicy, ChannelDescriptor, MarketFailure } from './contracts.js'

export interface BaselineExport {
  readonly schemaVersion: 1
  readonly productVariant: 'beta' | 'stable' | 'next'
  readonly upstreamCommit: string
  readonly dshVersion: string
  readonly nodeVersion: string
  readonly pnpmVersion: string
  readonly platform: 'win32'
  readonly arch: 'x64'
  readonly packages: readonly { readonly name: string; readonly version: string; readonly integrity: string }[]
  readonly patches: readonly { readonly path: string; readonly sha256: string }[]
}

export interface ResolvedEnterpriseSnapshot {
  readonly policy: EnterprisePolicy
  readonly descriptor: ChannelDescriptor
  readonly fetchedAt: string
  readonly status: 'resolved' | 'cached'
}

export interface RuntimeInput {
  readonly policyPath?: string
  readonly resolveBaseline: () => Promise<{ readonly baselineId: string; readonly document: BaselineExport }>
  readonly cacheDirectory: string
  readonly signal: AbortSignal
}

export interface EnterpriseProfilePatch { readonly text: string; readonly changed: boolean }

export interface ApprovedTarget {
  readonly packageName: string
  readonly version: string
  readonly registryUrl: string
  readonly snapshotId: string
}

export type EnterpriseRuntime =
  | { readonly mode: 'personal' }
  | { readonly mode: 'enterprise'; readonly state: 'resolved' | 'cached'; readonly snapshot: ResolvedEnterpriseSnapshot }
  | { readonly mode: 'enterprise'; readonly state: 'blocked'; readonly failure: MarketFailure }

export function validateEnterprisePolicy(value: unknown): EnterprisePolicy
export function validateChannelDescriptor(value: unknown, policy: EnterprisePolicy): ChannelDescriptor
export function resolveEnterpriseSnapshot(input: {
  policy: EnterprisePolicy; baselineId: string; cacheDirectory: string; signal: AbortSignal
}): Promise<ResolvedEnterpriseSnapshot>
export function exportRuntimeBaseline(input: {
  productVariant: 'beta' | 'stable' | 'next'; runtimeRoot: string; upstreamCommit: string; patchFiles: readonly string[]
}): Promise<{ baselineId: string; document: BaselineExport }>
export function inspectEnterpriseProfile(input: {
  profileDirectory: string; snapshot: ResolvedEnterpriseSnapshot
}): Promise<{ status: 'managed' | 'unmanaged' | 'external-reference'; issues: readonly string[] }>
export function buildEnterpriseProfilePatch(input: {
  snapshot: ResolvedEnterpriseSnapshot; existingText: string
}): EnterpriseProfilePatch
export function resolveApprovedTarget(input: {
  snapshot: ResolvedEnterpriseSnapshot; packageName: string; exactVersion: string
}): Promise<ApprovedTarget>
export function assertEnterpriseOperation(input: {
  operation: 'install' | 'update'; target: ApprovedTarget; profileIdentity: string
}): Promise<void>
export function createEnterpriseRuntime(input: RuntimeInput): Promise<EnterpriseRuntime>
/** One immutable runtime per Host. Calling before initialization must fail, never default to personal. */
export function getEnterpriseRuntime(): Readonly<EnterpriseRuntime>
