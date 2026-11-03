import { mkdir, readFile, writeFile, rename, unlink, rm, stat, open, readdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve, join, basename } from 'node:path';
import { hostname } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { inspectTarball, hash } from './archive.mjs';
import { validateIdentity, checkPublication, validName, semver } from './dependencies.mjs';
import { assert, MarketError } from './errors.mjs';

export const BUNDLE_SCHEMA = 'starmind.enterprise-market.bundle';
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const json = value => JSON.stringify(value, null, 2) + '\n';
const safeId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
async function atomicJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(json(value)); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, file); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
export async function openMarket(dataDir, options = {}) {
  const root = resolve(dataDir);
  const limits = { maxArtifactBytes: 256 * 1024 * 1024, maxPublicationBytes: 256 * 1024 * 1024, maxExpandedBytes: 512 * 1024 * 1024, maxPackages: 1000, maxUploadBytesPerUser: 1024 * 1024 * 1024, ...options.limits };
  for (const dir of ['', 'artifacts', 'uploads']) await mkdir(join(root, dir), { recursive: true });
  const statePath = join(root, 'state.json');
  try { const file = await open(statePath, 'wx', 0o600); await file.writeFile(json({ schemaVersion: 1, users: [], releases: [], audit: [] })); await file.sync(); await file.close(); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const readState = async () => {
    const value = JSON.parse(await readFile(statePath, 'utf8'));
    assert(value.schemaVersion === 1 && Array.isArray(value.users) && Array.isArray(value.releases) && Array.isArray(value.audit), 'STORE_INVALID', '市场数据文件格式错误。', 503);
    return value;
  };
  async function mutation(action) {
    const lock = join(root, 'writer.lock');
    try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new MarketError('STORE_BUSY', '另一个发布正在提交，请稍后重试。', 409); throw error; }
    try {
      await writeFile(join(lock, 'owner.json'), json({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }), { flag: 'wx' });
      const state = await readState();
      const result = await action(state);
      await atomicJson(statePath, state);
      return result;
    } finally { await rm(lock, { recursive: true, force: true }); }
  }
  const audit = (state, actor, action, target, details = {}) => state.audit.push({ id: randomUUID(), at: new Date().toISOString(), actor: { id: actor.id, name: actor.name }, action, target, details });
  async function createUser(name, role = 'publisher') {
    assert(typeof name === 'string' && /^[\p{L}\p{N}_.@-]{1,80}$/u.test(name), 'USER_INVALID', '用户名格式非法。');
    assert(role === 'admin' || role === 'publisher', 'USER_INVALID', '用户角色非法。');
    const token = 'sm_' + randomBytes(32).toString('base64url');
    const user = await mutation(state => {
      assert(!state.users.some(item => item.name === name), 'USER_EXISTS', '用户已存在。', 409);
      const value = { id: randomUUID(), name, role, tokenHash: hash(token), createdAt: new Date().toISOString(), disabled: false };
      state.users.push(value);
      audit(state, value, 'user-created', value.id, { role });
      return value;
    });
    return { user: { id: user.id, name: user.name, role: user.role }, token };
  }
  async function authenticate(token) {
    assert(typeof token === 'string' && token.length >= 30 && token.length <= 200, 'UNAUTHORIZED', '请使用发布账号令牌登录。', 401);
    const digest = Buffer.from(hash(token), 'hex');
    const user = (await readState()).users.find(item => !item.disabled && typeof item.tokenHash === 'string' && item.tokenHash.length === 64 && timingSafeEqual(Buffer.from(item.tokenHash, 'hex'), digest));
    assert(user, 'UNAUTHORIZED', '发布令牌无效或账号已停用。', 401);
    return { id: user.id, name: user.name, role: user.role };
  }
  function artifactPath(digest) {
    assert(safeId(digest), 'ARTIFACT_NOT_FOUND', '制品不存在。', 404);
    return join(root, 'artifacts', digest + '.tgz');
  }
  async function readUpload(id, user) {
    assert(typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id), 'UPLOAD_NOT_FOUND', '上传记录不存在。', 404);
    let meta;
    try { meta = JSON.parse(await readFile(join(root, 'uploads', id + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new MarketError('UPLOAD_NOT_FOUND', '上传已过期或不存在。', 404); throw error; }
    assert(meta.ownerId === user.id, 'FORBIDDEN', '不能使用其他用户的未发布上传。', 403);
    assert(Date.now() - Date.parse(meta.createdAt) < UPLOAD_TTL_MS, 'UPLOAD_EXPIRED', '上传记录已过期，请重新上传。', 410);
    return meta;
  }
  const uploadsInUse = new Map();
  function holdUploads(ids) { for (const id of ids) uploadsInUse.set(id, (uploadsInUse.get(id) ?? 0) + 1); }
  function releaseUploads(ids) { for (const id of ids) { const count = uploadsInUse.get(id) - 1; if (count > 0) uploadsInUse.set(id, count); else uploadsInUse.delete(id); } }
  let cleanupPromise;
  function cleanupUploads(now = Date.now()) {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const uploadsDir = join(root, 'uploads'), retained = new Set();
      const entries = await readdir(uploadsDir, { withFileTypes: true });
      let removedFiles = 0;
      const remove = async file => { try { await unlink(file); removedFiles++; } catch (error) { if (error.code !== 'ENOENT') throw error; } };
      for (const entry of entries) {
        const match = entry.isFile() && entry.name.match(/^([0-9a-f-]{36})\.json$/);
        if (!match) continue;
        const id = match[1], file = join(uploadsDir, entry.name);
        if (uploadsInUse.has(id)) { retained.add(id); continue; }
        let createdAt;
        try { createdAt = Date.parse(JSON.parse(await readFile(file, 'utf8')).createdAt); }
        catch (error) { if (error.code === 'ENOENT') continue; if (!(error instanceof SyntaxError)) throw error; }
        if (!Number.isFinite(createdAt)) createdAt = (await stat(file)).mtimeMs;
        if (now - createdAt < UPLOAD_TTL_MS) { retained.add(id); continue; }
        await remove(file);
        await remove(join(uploadsDir, id + '.tgz'));
      }
      // A process crash can leave a tarball or atomic metadata temporary file without its record.
      for (const entry of entries) {
        const match = entry.isFile() && entry.name.match(/^([0-9a-f-]{36})(?:\.tgz|\.json\.[0-9a-f-]{36}\.tmp)$/);
        if (!match || retained.has(match[1]) || uploadsInUse.has(match[1])) continue;
        const file = join(uploadsDir, entry.name);
        let info;
        try { info = await stat(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (now - info.mtimeMs >= UPLOAD_TTL_MS) await remove(file);
      }
      return { removedFiles };
    })().finally(() => { cleanupPromise = undefined; });
    return cleanupPromise;
  }
  async function stage(stream, filename, user) {
    assert(typeof filename === 'string' && filename.length <= 200 && filename.endsWith('.tgz') && basename(filename) === filename && !/[\\/\0\r\n]/.test(filename), 'UPLOAD_FILENAME_INVALID', '只支持文件名明确的原始 .tgz 包。');
    await cleanupUploads();
    let currentBytes = 0;
    for (const entry of await readdir(join(root, 'uploads'))) {
      if (!entry.endsWith('.json')) continue;
      let upload;
      try { upload = JSON.parse(await readFile(join(root, 'uploads', entry), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (upload.ownerId === user.id && Date.now() - Date.parse(upload.createdAt) < UPLOAD_TTL_MS) currentBytes += upload.size;
    }
    assert(currentBytes < limits.maxUploadBytesPerUser, 'UPLOAD_QUOTA_EXCEEDED', '当前用户暂存空间已满。', 413);
    const id = randomUUID(), file = join(root, 'uploads', id + '.tgz');
    holdUploads([id]);
    let size = 0;
    const measure = new Transform({ transform(chunk, encoding, callback) {
      size += chunk.length;
      callback(size > limits.maxArtifactBytes || size + currentBytes > limits.maxUploadBytesPerUser ? new MarketError('UPLOAD_TOO_LARGE', '上传文件超过大小限制。', 413) : null, chunk);
    } });
    try {
      await pipeline(stream, measure, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
      const info = inspectTarball(await readFile(file), limits);
      validateIdentity(info.manifest);
      const meta = { id, ownerId: user.id, filename, createdAt: new Date().toISOString(), ...info };
      await atomicJson(join(root, 'uploads', id + '.json'), meta);
      return { id, filename, size, sha256: info.sha256, name: info.manifest.name, version: info.manifest.version, bundle: typeof info.manifest.dsh?.bundle?.patch === 'string' };
    } catch (error) { await unlink(file).catch(() => {}); throw error; }
    finally { releaseUploads([id]); }
  }
  const bounded = (value, fallback, max) => {
    if (value === undefined) return fallback;
    assert(typeof value === 'string' && value.length <= max && !value.includes('\0'), 'PUBLICATION_INVALID', '发布说明长度或格式非法。');
    return value;
  };
  async function publishStaged(input, user) {
    assert(input && typeof input === 'object' && input.plugin && validName(input.plugin.name) && typeof input.plugin.version === 'string', 'PUBLICATION_INVALID', '请选择主插件及其精确版本。');
    assert(Array.isArray(input.uploadIds) && input.uploadIds.length > 0 && input.uploadIds.length <= limits.maxPackages && new Set(input.uploadIds).size === input.uploadIds.length, 'PUBLICATION_INVALID', '上传包列表为空、重复或过大。');
    const uploads = await Promise.all(input.uploadIds.map(id => readUpload(id, user)));
    assert(uploads.reduce((sum, meta) => sum + meta.size, 0) <= limits.maxPublicationBytes, 'PUBLICATION_TOO_LARGE', '发布包集压缩后总大小超过限制，请拆分发行包或联系管理员调整受控限制。', 413);
    const packages = [];
    for (const meta of uploads) {
      const bytes = await readFile(join(root, 'uploads', meta.id + '.tgz'));
      const inspected = inspectTarball(bytes, limits);
      assert(inspected.sha256 === meta.sha256, 'FILE_HASH_MISMATCH', '暂存制品被修改，请重新上传。', 422);
      packages.push({ ...inspected, filename: meta.filename, bytes });
    }
    const checked = checkPublication(packages, input.plugin);
    const manifest = checked.root.manifest;
    const title = bounded(input.title, typeof manifest.title === 'string' ? manifest.title : manifest.name, 200);
    const description = bounded(input.description, typeof manifest.description === 'string' ? manifest.description : '', 4000);
    const category = bounded(input.category, '其他', 80);
    const readme = bounded(input.readme, checked.root.readme ?? (typeof manifest.readme === 'string' ? manifest.readme : ''), 1024 * 1024);
    const result = await mutation(async state => {
      const samePlugin = state.releases.filter(item => item.name === manifest.name);
      const owner = samePlugin[0]?.owner;
      assert(!owner || owner.id === user.id || user.role === 'admin', 'PACKAGE_OWNED_BY_OTHER_USER', '包名已由其他用户发布；请使用自己的命名空间或联系管理员。', 403);
      assert(!samePlugin.some(item => item.version === manifest.version), 'VERSION_IMMUTABLE', '该版本已经发布过，撤回后也不能覆盖，请提升版本。', 409);
      const now = new Date().toISOString();
      const records = packages.map(pkg => ({ name: pkg.manifest.name, version: pkg.manifest.version, sha256: pkg.sha256, integrity: pkg.integrity, size: pkg.size, filename: pkg.filename, manifest: pkg.manifest, publishedAt: now }));
      for (const record of records) {
        const existing = state.releases.flatMap(item => item.packages).find(item => item.name === record.name && item.version === record.version);
        assert(!existing || existing.sha256 === record.sha256, 'PACKAGE_VERSION_CONFLICT', '同名同版本制品内容与既有发布不同；禁止替换依赖包，请提升版本。', 409, { name: record.name, version: record.version });
        if (existing) record.publishedAt = existing.publishedAt;
      }
      const id = hash(JSON.stringify({ plugin: input.plugin, packages: records.map(pkg => [pkg.name, pkg.version, pkg.sha256]).sort(), ownerId: owner?.id ?? user.id, title, description, category, readme }));
      for (const pkg of packages) {
        const target = artifactPath(pkg.sha256);
        try {
          const existing = await readFile(target);
          assert(hash(existing) === pkg.sha256, 'STORE_CORRUPT', '已有制品摘要错误，发布已中止。', 503);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const temp = target + '.' + randomUUID() + '.tmp';
          const handle = await open(temp, 'wx', 0o600);
          try { await handle.writeFile(pkg.bytes); await handle.sync(); } finally { await handle.close(); }
          await rename(temp, target);
        }
      }
      const release = { id, name: manifest.name, version: manifest.version, title, description, category, readme, status: 'published', publishedAt: now, owner: owner ?? user, publishedBy: user, packages: records, warnings: checked.warnings, dependencyEdges: checked.edges, closureVerified: true };
      state.releases.push(release);
      audit(state, user, 'release-published', id, { name: release.name, version: release.version, packages: records.length });
      return release;
    });
    for (const upload of uploads) {
      await unlink(join(root, 'uploads', upload.id + '.json')).catch(() => {});
      await unlink(join(root, 'uploads', upload.id + '.tgz')).catch(() => {});
    }
    return result;
  }
  async function publish(input, user) {
    const ids = Array.isArray(input?.uploadIds) ? input.uploadIds : [];
    holdUploads(ids);
    try { return await publishStaged(input, user); }
    finally { releaseUploads(ids); }
  }
  async function importBundle(bundle, user) {
    assert(bundle?.schema === BUNDLE_SCHEMA && bundle.schemaVersion === 1 && Array.isArray(bundle.packages) && bundle.packages.length > 0 && bundle.packages.length <= limits.maxPackages, 'BUNDLE_INVALID', '不支持的离线包格式或包数量。');
    assert(bundle.resources === undefined || (Array.isArray(bundle.resources) && bundle.resources.length === 0), 'RESOURCE_ADAPTER_UNSUPPORTED', '当前服务仅导入 npm 包闭包，不支持额外引擎/浏览器资源，请先提供专用适配器。', 422);
    const uploadIds = [];
    try {
      const { Readable } = await import('node:stream');
      for (const item of bundle.packages) {
        assert(typeof item.contentsBase64 === 'string' && item.contentsBase64.length <= Math.ceil(limits.maxArtifactBytes / 3) * 4 && item.contentsBase64.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(item.contentsBase64), 'BUNDLE_INVALID', '离线包中的 base64 数据无效。');
        const bytes = Buffer.from(item.contentsBase64, 'base64');
        assert(bytes.toString('base64') === item.contentsBase64, 'BUNDLE_INVALID', 'base64 数据不是规范编码。');
        const upload = await stage(Readable.from(bytes), item.filename, user);
        uploadIds.push(upload.id);
        if (item.sha256 !== undefined) assert(upload.sha256 === item.sha256, 'FILE_HASH_MISMATCH', '离线包内制品摘要不一致。', 422);
      }
      return await publish({ ...bundle, uploadIds }, user);
    } catch (error) {
      for (const id of uploadIds) {
        await unlink(join(root, 'uploads', id + '.json')).catch(() => {});
        await unlink(join(root, 'uploads', id + '.tgz')).catch(() => {});
      }
      throw error;
    }
  }
  async function withdraw(id, user) {
    assert(safeId(id), 'RELEASE_NOT_FOUND', '发布不存在。', 404);
    return mutation(state => {
      const release = state.releases.find(item => item.id === id);
      assert(release, 'RELEASE_NOT_FOUND', '发布不存在。', 404);
      assert(release.owner.id === user.id || user.role === 'admin', 'FORBIDDEN', '只能撤回自己的插件。', 403);
      if (release.status !== 'withdrawn') {
        release.status = 'withdrawn'; release.withdrawnAt = new Date().toISOString();
        audit(state, user, 'release-withdrawn', id, { name: release.name, version: release.version });
      }
      return release;
    });
  }
  async function exportBundle(release) {
    const packages = [];
    for (const pkg of release.packages) {
      const bytes = await readFile(artifactPath(pkg.sha256));
      assert(hash(bytes) === pkg.sha256, 'STORE_CORRUPT', '制品摘要错误。', 503);
      packages.push({ filename: pkg.filename, sha256: pkg.sha256, contentsBase64: bytes.toString('base64') });
    }
    return { schema: BUNDLE_SCHEMA, schemaVersion: 1, plugin: { name: release.name, version: release.version }, title: release.title, description: release.description, category: release.category, readme: release.readme, packages };
  }
  return { root, limits, readState, mutation, createUser, authenticate, stage, publish, importBundle, withdraw, exportBundle, artifactPath, cleanupUploads };
}
