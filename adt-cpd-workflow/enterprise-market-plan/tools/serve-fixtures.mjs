import { createServer } from 'node:http'
import { lstatSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { hash } from './create-fixtures.mjs'

// Test harness only: no production import/publish, credentials, TLS, or approval enforcement.
export function createFixtureServer({ releaseDirectory, failArtifactVersion }) {
  const root = resolve(releaseDirectory)
  if (lstatSync(root).isSymbolicLink()) throw new Error('Linked fixture root rejected')
  const releaseBytes = readFileSync(join(root, 'release.json'))
  const release = JSON.parse(releaseBytes)
  const snapshotId = hash(releaseBytes)
  const origin = release.deployment.expectedOrigin
  const parsedOrigin = new URL(origin)
  if (parsedOrigin.origin !== origin || parsedOrigin.hostname !== '127.0.0.1' || parsedOrigin.protocol !== 'http:') throw new Error('Fixture server is restricted to loopback HTTP')
  const entries = new Map()
  for (const entry of release.files) {
    if (!entry.path || entry.path.split('/').some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) throw new Error('Invalid manifest file path')
    const path = join(root, ...entry.path.split('/'))
    let current = root
    for (const part of entry.path.split('/')) { current = join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('Linked fixture file rejected') }
    const bytes = readFileSync(path)
    if (bytes.length !== entry.size || hash(bytes) !== entry.sha256) throw new Error(`Fixture checksum mismatch: ${entry.path}`)
    entries.set(entry.path, { ...entry, bytes })
  }
  const packageMap = new Map()
  const artifactMap = new Map()
  for (const item of release.packages) {
    const metadata = JSON.parse(entries.get(item.metadataPath).bytes)
    const tarball = entries.get(item.tarballPath)
    if (metadata.name !== item.name || metadata.version !== item.version || item.integrity !== 'sha512-' + hash(tarball.bytes, 'sha512', 'base64')) throw new Error('Fixture package identity/integrity mismatch')
    const artifactPath = `/artifacts/${tarball.sha256}/${basename(item.tarballPath)}`
    const manifest = { ...metadata, dist: { ...metadata.dist, integrity: item.integrity, tarball: origin + artifactPath } }
    const packument = packageMap.get(item.name) ?? { name: item.name, 'dist-tags': release.packageTags[item.name] ?? {}, versions: {}, time: {} }
    packument.versions[item.version] = manifest; packument.time[item.version] = item.publishedAt
    packageMap.set(item.name, packument)
    artifactMap.set(artifactPath, { bytes: tarball.bytes, version: item.version })
  }
  const registryUrl = `${origin}/npm/snapshots/${snapshotId}/`
  const catalog = JSON.parse(entries.get(release.catalogPath).bytes)
  for (const plugin of catalog.plugins) for (const version of plugin.versions) version.source = { type: 'npm', registry: registryUrl }
  const descriptor = { schemaVersion: 1, marketId: release.marketId, channel: 'stable', snapshotId, indexUrl: `${origin}/snapshots/${snapshotId}/dsh-index.json`, registryUrl, baselineId: release.runtime.baselineId, publishedAt: release.createdAt }
  const server = createServer((request, response) => {
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      const body = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))
      response.writeHead(status, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : body)
    }
    if (!['GET', 'HEAD'].includes(request.method)) return send(405, { code: 'read-only' })
    if (request.headers.host !== parsedOrigin.host) return send(400, { code: 'unexpected-host' })
    let url
    try { url = new URL(request.url, origin) } catch { return send(400, { code: 'invalid-url' }) }
    if (url.origin !== origin) return send(400, { code: 'invalid-origin' })
    if (url.pathname === '/healthz') return send(200, { status: 'fixture-only', snapshotId })
    if (url.pathname === '/channels/stable.json') return send(200, descriptor)
    if (url.pathname === `/snapshots/${snapshotId}/dsh-index.json`) return send(200, catalog)
    const artifact = artifactMap.get(url.pathname)
    if (artifact) return artifact.version === failArtifactVersion
      ? send(503, { code: 'intentional-fixture-download-failure' })
      : send(200, artifact.bytes, 'application/octet-stream')
    const prefix = `/npm/snapshots/${snapshotId}/`
    if (!url.pathname.startsWith(prefix)) return send(404, { code: 'not-found' })
    let segments
    try { segments = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/\/$/, '').split('/') } catch { return send(400, { code: 'invalid-encoding' }) }
    const name = segments[0]?.startsWith('@') ? segments.splice(0, 2).join('/') : segments.shift()
    const packument = packageMap.get(name)
    if (!packument || segments.length > 1) return send(404, { error: 'package not present in fixture snapshot' })
    if (segments.length === 0) return send(200, packument)
    const version = packument['dist-tags'][segments[0]] ?? segments[0]
    return packument.versions[version] ? send(200, packument.versions[version]) : send(404, { error: 'version not present in fixture snapshot' })
  })
  return { server, snapshotId, descriptor, release }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { release: { type: 'string' }, port: { type: 'string', default: '18765' }, 'fail-artifact-version': { type: 'string' } } })
    if (!values.release) throw new Error('Usage: node serve-fixtures.mjs --release <fixture-directory> [--port 18765] [--fail-artifact-version 1.2.0]')
    const port = Number(values.port)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid fixture port')
    const result = createFixtureServer({ releaseDirectory: values.release, failArtifactVersion: values['fail-artifact-version'] })
    if (new URL(result.descriptor.indexUrl).port !== String(port)) throw new Error('Port must match release expectedOrigin; regenerate fixtures for another port')
    result.server.on('error', error => { console.error(error.message); process.exitCode = 1 })
    result.server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ fixtureOnly: true, ...result.descriptor })))
    process.once('SIGINT', () => result.server.close())
    process.once('SIGTERM', () => result.server.close())
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
