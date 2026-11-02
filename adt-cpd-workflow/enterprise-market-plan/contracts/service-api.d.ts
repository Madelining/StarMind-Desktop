/** Planned module boundaries. Implement names exactly; do not add a second service. */
import type { Server } from 'node:http'
import type { ChannelDescriptor, ReleaseManifest, RuntimeBaseline, TargetVerificationReport } from './contracts.js'

export interface ServiceConfig {
  readonly schemaVersion: 1
  readonly marketId: string
  readonly listenHost: string
  readonly listenPort: number
  readonly publicOrigin: string
  readonly dataDir: string
  readonly maxReleaseBytes: number
  readonly maxJsonBytes: number
  readonly minimumFreeBytes: number
  readonly logDir: string
}

export interface VerifiedRelease {
  readonly sourceDirectory: string
  readonly snapshotId: string
  readonly manifest: ReleaseManifest
  readonly assurance: 'structural'
  readonly totalBytes: number
}

export interface SnapshotRecord {
  readonly snapshotId: string
  readonly directory: string
  readonly manifest: ReleaseManifest
}

export interface ImportResult {
  readonly snapshotId: string
  readonly state: 'imported' | 'already-present'
  readonly published: false
}

export interface RuntimeProbeConfig {
  readonly schemaVersion: 1
  readonly nodeExecutable: string
  readonly pnpmEntry: string
  readonly hostProbeEntry: string
  readonly baselinePath: string
  readonly expectedBaseline: RuntimeBaseline
}

/** Sent to enterprise-market/tests/probe-manager.mjs by a local verification runner. */
export interface HostProbeRequest {
  readonly schemaVersion: 1
  readonly scenario: 'baseline' | 'install' | 'update' | 'download-failure' | 'activation-failure' | 'combined'
  readonly workspace: string
  readonly registryUrl: string
  readonly indexUrl: string
  readonly targets: readonly { readonly name: string; readonly version: string }[]
  readonly fallbackRegistries: readonly []
}

export interface HostProbeResult {
  readonly schemaVersion: 1
  readonly status: 'passed' | 'failed' | 'blocked'
  readonly actualRuntime: RuntimeBaseline
  readonly managerResults: readonly unknown[]
  readonly bundleStates: readonly { readonly name: string; readonly version?: string; readonly active: boolean; readonly error?: string }[]
  readonly evidenceFiles: readonly { readonly path: string; readonly sha256: string }[]
}

// src/contracts.mjs: shape checks only; official index/SemVer checks use the pinned tools.
export function parseServiceConfig(value: unknown): ServiceConfig
export function parseReleaseManifest(value: unknown): ReleaseManifest
export function parseTargetVerification(value: unknown): TargetVerificationReport

// src/paths.mjs: reject links/reparse, traversal, absolute and ambiguous Windows paths.
export function assertSafeRelativePath(value: string): void
export function resolveRegisteredFile(root: string, relativePath: string): Promise<string>

// src/integrity.mjs: stream bytes, don't buffer production tarballs or resources.
export function sha256File(path: string): Promise<string>
export function verifyFile(path: string, expected: { size: number; sha256: string }): Promise<void>

// src/verify.mjs: structural precheck is separate from actual target-cold execution.
export function verifyReleaseDirectory(options: {
  releaseDirectory: string; expectedOrigin: string; maxReleaseBytes: number; maxJsonBytes: number
}): Promise<VerifiedRelease>
export function verifySnapshot(options: {
  snapshotId: string; dataDir: string; runtimeConfig: RuntimeProbeConfig; workspace: string
}): Promise<TargetVerificationReport>

// src/import.mjs: one writer lock, same-volume staging, copy-then-verify, atomic commit.
export function importRelease(options: {
  releaseDirectory: string; dataDir: string; expectedOrigin: string
}): Promise<ImportResult>

// src/catalog.mjs / registry.mjs: no outbound HTTP, no custom version solver.
export function materializeIndex(snapshot: SnapshotRecord, publicOrigin: string): Promise<unknown>
export function createPackument(snapshot: SnapshotRecord, packageName: string, publicOrigin: string): Promise<unknown>
export function readVersionManifest(snapshot: SnapshotRecord, packageName: string, exactVersion: string, publicOrigin: string): Promise<unknown>

// src/publish.mjs: publish may use only a verified, immutable snapshot.
export function publishSnapshot(options: {
  snapshotId: string; verificationRunId: string; dataDir: string
}): Promise<ChannelDescriptor>
export function unpublishChannel(options: { channel: 'stable'; dataDir: string }): Promise<void>

// src/server.mjs: caller owns listen/close; only registered immutable content is served.
export function createReadOnlyServer(config: ServiceConfig): Promise<Server>

// tools/prepare-release.mjs: operator-run acquisition, never invoked by the read service.
export function prepareRelease(options: { configPath: string; outputDirectory: string }): Promise<VerifiedRelease>

// cli.mjs: pure argv routing around these functions; no shell command interpolation.
export function runCli(argv: readonly string[]): Promise<number>
