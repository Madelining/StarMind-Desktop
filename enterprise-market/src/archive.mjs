import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { assert, MarketError } from './errors.mjs';

export const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const utf8 = new TextDecoder('utf-8', { fatal: true });
function text(bytes) {
  try { return utf8.decode(bytes); }
  catch { throw new MarketError('ARCHIVE_INVALID', '归档含无效 UTF-8 文本。'); }
}
function field(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return text(end < 0 ? bytes : bytes.subarray(0, end));
}
function octal(header, start, length) {
  const value = field(header, start, length).trim();
  assert(value === '' || /^[0-7]+$/.test(value), 'ARCHIVE_INVALID', '不支持的 tar 数字格式。');
  const number = value === '' ? 0 : Number.parseInt(value, 8);
  assert(Number.isSafeInteger(number) && number >= 0, 'ARCHIVE_INVALID', '无效 tar 长度。');
  return number;
}
function safePath(value) {
  assert(value.length > 0 && value.length <= 2048 && !/[\\\0:]/.test(value) && !value.startsWith('/'), 'ARCHIVE_PATH_INVALID', '归档路径非法。');
  const clean = value.endsWith('/') ? value.slice(0, -1) : value;
  const parts = clean.split('/');
  assert(parts[0] === 'package' && parts.every(part => part && part !== '.' && part !== '..'), 'ARCHIVE_PATH_INVALID', '归档文件必须位于 package/ 内，且不能越界。');
  return clean;
}
function pax(bytes) {
  const result = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    assert(space > offset, 'ARCHIVE_INVALID', '无效 PAX 记录。');
    const lengthString = bytes.subarray(offset, space).toString('ascii');
    assert(/^[1-9][0-9]*$/.test(lengthString), 'ARCHIVE_INVALID', '无效 PAX 长度。');
    const length = Number(lengthString);
    assert(length > space - offset + 2 && offset + length <= bytes.length, 'ARCHIVE_INVALID', 'PAX 长度越界。');
    const line = text(bytes.subarray(space + 1, offset + length));
    assert(line.endsWith('\n') && line.includes('='), 'ARCHIVE_INVALID', '无效 PAX 内容。');
    const equal = line.indexOf('=');
    const key = line.slice(0, equal);
    assert(!['__proto__', 'prototype', 'constructor'].includes(key), 'ARCHIVE_INVALID', '无效 PAX 字段。');
    result[key] = line.slice(equal + 1, -1);
    offset += length;
  }
  return result;
}

/** Inspect only; never extracts files or runs package code. */
export function inspectTarball(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const maxExpandedBytes = options.maxExpandedBytes ?? 512 * 1024 * 1024;
  assert(buffer.length >= 18 && buffer[0] === 0x1f && buffer[1] === 0x8b, 'ARCHIVE_INVALID', '请选择原始 npm .tgz 包。');
  let tar;
  try { tar = gunzipSync(buffer, { maxOutputLength: maxExpandedBytes }); }
  catch { throw new MarketError('ARCHIVE_INVALID', '无法解读 gzip，文件损坏或解压后超过限制。'); }
  let offset = 0, count = 0, manifest, readme, longPath, pendingPax = {}, globalPax = {};
  const paths = new Set(), installRisks = [], nativeFiles = [];
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      assert(tar.subarray(offset).every(byte => byte === 0), 'ARCHIVE_INVALID', 'tar 结束标记后有异常内容。');
      break;
    }
    assert(++count <= (options.maxEntries ?? 100000), 'ARCHIVE_INVALID', '归档文件数量超过限制。');
    const expected = octal(header, 148, 8);
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
    assert(expected === checksum, 'ARCHIVE_INVALID', 'tar 头校验失败。');
    const size = octal(header, 124, 12);
    const start = offset + 512;
    assert(start + size <= tar.length, 'ARCHIVE_INVALID', 'tar 文件长度越界。');
    const body = tar.subarray(start, start + size);
    const type = String.fromCharCode(header[156] || 48);
    offset = start + Math.ceil(size / 512) * 512;
    assert(offset <= tar.length, 'ARCHIVE_INVALID', 'tar 填充长度越界。');
    if (type === 'x' || type === 'g') {
      const records = pax(body);
      if (type === 'g') globalPax = { ...globalPax, ...records };
      else pendingPax = records;
      continue;
    }
    if (type === 'L') {
      longPath = text(body).replace(/\0.*$/s, '').replace(/\n$/, '');
      continue;
    }
    assert(type === '0' || type === '5', 'ARCHIVE_UNSUPPORTED', '不支持含符号链接、硬链接或特殊设备的归档。');
    const prefix = field(header, 345, 155);
    const mergedPax = { ...globalPax, ...pendingPax };
    const raw = mergedPax.path ?? longPath ?? (prefix ? prefix + '/' : '') + field(header, 0, 100);
    const path = safePath(raw);
    if (mergedPax.size !== undefined) assert(String(size) === mergedPax.size, 'ARCHIVE_UNSUPPORTED', 'PAX size 扩展与 tar 头不一致。');
    pendingPax = {}; longPath = undefined;
    assert(!paths.has(path), 'ARCHIVE_INVALID', '归档含重复路径。', 400, { path });
    paths.add(path);
    if (type === '5') continue;
    if (path === 'package/package.json') {
      assert(size <= 1024 * 1024 && !manifest, 'ARCHIVE_INVALID', 'package.json 过大或重复。');
      try { manifest = JSON.parse(text(body)); }
      catch (error) { if (error instanceof MarketError) throw error; throw new MarketError('MANIFEST_INVALID', 'package.json 无法解析。'); }
    }
    if (/^package\/readme(?:\.md|\.markdown|\.txt)?$/i.test(path) && readme === undefined && size <= 1024 * 1024) readme = text(body);
    if (path === 'package/binding.gyp') installRisks.push(path);
    if (path.endsWith('.node')) nativeFiles.push(path);
  }
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'MANIFEST_INVALID', '归档缺少 package/package.json。');
  const patch = manifest.dsh?.bundle?.patch;
  if (typeof patch === 'string') {
    assert(!patch.startsWith('/') && !patch.includes('\\') && !patch.split('/').includes('..'), 'BUNDLE_INVALID', 'dsh.bundle.patch 路径非法。');
    const normalized = patch.replace(/^\.\//, '');
    assert(paths.has('package/' + normalized), 'BUNDLE_INVALID', '归档缺少声明的 bundle patch。');
  }
  return { manifest, readme, paths: [...paths], installRisks, nativeFiles, size: buffer.length, sha256: hash(buffer), integrity: 'sha512-' + hash(buffer, 'sha512', 'base64') };
}
