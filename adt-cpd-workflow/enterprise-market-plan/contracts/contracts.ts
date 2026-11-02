/** Design contracts. These are not installed into the application yet. */
export interface EnterprisePolicy {
  readonly schemaVersion: 1
  readonly mode: 'enterprise'
  readonly marketId: string
  readonly expectedOrigin: string
  readonly channelUrl: string
  readonly allowHttp: boolean
  readonly caFile?: string
  readonly channelMaxAgeSeconds: number
}

export interface ChannelDescriptor {
  readonly schemaVersion: 1
  readonly marketId: string
  readonly channel: 'stable'
  readonly snapshotId: string
  readonly indexUrl: string
  readonly registryUrl: string
  readonly baselineId: string
  readonly publishedAt: string
}

export interface RuntimeBaseline {
  readonly baselineId: string
  readonly dshVersion: string
  readonly nodeVersion: string
  readonly pnpmVersion: string
  readonly platform: 'win32'
  readonly arch: 'x64'
}

export interface ReleaseFile {
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly role: 'catalog' | 'metadata' | 'tarball' | 'resource' | 'license' | 'media'
}

export interface ReleasePackage {
  readonly name: string
  readonly version: string
  readonly publishedAt: string
  readonly metadataPath: string
  readonly tarballPath: string
  readonly integrity: string
}

export interface RuntimeResource {
  readonly id: string
  readonly kind: 'electron-runtime' | 'native-addon' | 'engine' | 'other'
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly consumer: { readonly package: string; readonly version: string; readonly adapter: string }
  readonly platform: 'win32'
  readonly arch: 'x64'
  readonly version: string
}

export interface ReleaseManifest {
  readonly schema: 'starmind.enterprise-market.release'
  readonly schemaVersion: 1
  readonly marketId: string
  readonly releaseName: string
  readonly createdAt: string
  readonly deployment: { readonly expectedOrigin: string }
  readonly runtime: RuntimeBaseline
  readonly catalogPath: string
  readonly packages: readonly ReleasePackage[]
  readonly packageTags: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly resources: readonly RuntimeResource[]
  readonly files: readonly ReleaseFile[]
  readonly verification: { readonly requiredCaseIds: readonly string[] }
  readonly preparedWith: { readonly toolVersion: string; readonly nodeVersion: string; readonly pnpmVersion: string }
}

export interface VerificationCase {
  readonly id: string
  readonly status: 'passed' | 'failed' | 'blocked' | 'not-run'
  readonly command?: string
  readonly exitCode?: number
  readonly evidenceFiles: readonly { readonly path: string; readonly sha256: string }[]
}

/** Separate file: never hashed back into release.json, which would create a cycle. */
export interface TargetVerificationReport {
  readonly schema: 'starmind.enterprise-market.verification'
  readonly schemaVersion: 1
  readonly runId: string
  readonly snapshotId: string
  readonly marketId: string
  readonly expectedOrigin: string
  readonly baselineId: string
  readonly assurance: 'target-cold'
  readonly status: 'passed' | 'failed' | 'blocked' | 'not-run'
  readonly runtime: RuntimeBaseline
  readonly publicNetworkBlocked: boolean
  readonly startedAt: string
  readonly finishedAt: string
  readonly cases: readonly VerificationCase[]
}

export interface FixtureVerificationReport {
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly assurance: 'fixture-only'
  readonly status: 'not-run'
  readonly cases: readonly []
  readonly note?: string
}

export type VerificationReport = TargetVerificationReport | FixtureVerificationReport

export type MarketFailureCode =
  | 'POLICY_INVALID' | 'CHANNEL_UNAVAILABLE' | 'CHANNEL_INVALID' | 'CHANNEL_STALE'
  | 'BASELINE_MISMATCH' | 'PROFILE_UNMANAGED' | 'PROFILE_EXTERNAL_REFERENCE'
  | 'RELEASE_INVALID' | 'FILE_MISSING' | 'FILE_HASH_MISMATCH' | 'PACKAGE_IDENTITY_MISMATCH'
  | 'PACKAGE_VERSION_CONFLICT' | 'DEPENDENCY_MISSING' | 'RESOURCE_ADAPTER_UNSUPPORTED'
  | 'DEPLOYMENT_ORIGIN_MISMATCH' | 'VERIFICATION_REQUIRED' | 'IMPORT_BUSY'
  | 'SNAPSHOT_NOT_FOUND' | 'PACKAGE_NOT_FOUND' | 'VERSION_NOT_FOUND' | 'ARTIFACT_NOT_FOUND'

export interface MarketFailure {
  readonly code: MarketFailureCode
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

export interface MarketErrorResponse { readonly error: MarketFailure }
