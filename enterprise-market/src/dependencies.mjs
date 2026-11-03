import { createRequire } from 'node:module';
import { assert } from './errors.mjs';
const require = createRequire(import.meta.url);
export const semver = require('../vendor/semver/index.js');

export function validName(name) {
  return typeof name === 'string' && name.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) && !['node_modules', 'favicon.ico'].includes(name);
}
export function validateIdentity(manifest) {
  assert(validName(manifest.name), 'PACKAGE_NAME_INVALID', '插件包名不是有效的小写 npm 包名。');
  assert(typeof manifest.version === 'string' && semver.valid(manifest.version) === manifest.version, 'PACKAGE_VERSION_INVALID', '插件需要规范、精确的 SemVer 版本。');
}
function entries(value, field, owner) {
  if (value === undefined) return [];
  assert(value && typeof value === 'object' && !Array.isArray(value), 'MANIFEST_INVALID', field + ' 必须是对象。', 400, { package: owner });
  return Object.entries(value);
}
export function parseDependency(name, spec, owner, field) {
  assert(validName(name) && typeof spec === 'string' && spec.length <= 1000, 'DEPENDENCY_UNSUPPORTED', '依赖声明格式不受支持。', 400, { owner, field, name, spec });
  let target = name, range = spec;
  if (spec.startsWith('npm:')) {
    const alias = spec.slice(4);
    const at = alias.lastIndexOf('@');
    assert(at > 0, 'DEPENDENCY_UNSUPPORTED', 'npm alias 必须包含原包名和版本范围。', 400, { owner, name, spec });
    target = alias.slice(0, at); range = alias.slice(at + 1);
  }
  assert(validName(target) && range.length > 0 && semver.validRange(range) !== null, 'DEPENDENCY_UNSUPPORTED', '仅支持 npm SemVer 范围和 npm alias；不支持 tag、Git、URL、本地文件或 workspace 依赖。', 400, { owner, field, name, spec });
  return { name, target, range };
}
export function checkPublication(packages, rootIdentity) {
  const byName = new Map(), ids = new Set(), warnings = [], edges = [];
  for (const pkg of packages) {
    validateIdentity(pkg.manifest);
    const id = pkg.manifest.name + '@' + pkg.manifest.version;
    assert(!ids.has(id), 'PACKAGE_VERSION_CONFLICT', '同一个发布包不能含重复 name/version。', 409, { package: id });
    ids.add(id);
    const bundled = pkg.manifest.bundleDependencies ?? pkg.manifest.bundledDependencies;
    assert(bundled === undefined || bundled === false || (Array.isArray(bundled) && bundled.length === 0), 'BUNDLED_DEPENDENCIES_UNSUPPORTED', '此包内嵌 node_modules/bundleDependencies；首版不能证明其闭包，请提供独立原始依赖包和不内嵌依赖的预构建发行包。', 422, { package: id });
    if (!byName.has(pkg.manifest.name)) byName.set(pkg.manifest.name, []);
    byName.get(pkg.manifest.name).push(pkg.manifest.version);
    const scripts = pkg.manifest.scripts ?? {};
    const blocked = ['preinstall', 'install', 'postinstall'].filter(key => typeof scripts[key] === 'string' && scripts[key].trim());
    if (pkg.installRisks?.length && !scripts.install) blocked.push('implicit node-gyp binding.gyp');
    assert(blocked.length === 0, 'OFFLINE_BUILD_UNSUPPORTED', '包需要安装脚本或原生构建；请提供无需安装脚本的离线预构建包。', 422, { package: id, scripts: blocked });
    if (pkg.nativeFiles?.length) warnings.push({ code: 'NATIVE_TARGET_VALIDATION_REQUIRED', package: id, message: '包含预编译原生模块，仍需在目标 Windows/Node ABI 验证。' });
  }
  const root = packages.find(pkg => pkg.manifest.name === rootIdentity.name && pkg.manifest.version === rootIdentity.version);
  assert(root, 'ROOT_PACKAGE_MISSING', '上传包集里没有选中的主插件。');
  assert(typeof root.manifest.dsh?.bundle?.patch === 'string', 'BUNDLE_INVALID', '主插件必须声明 dsh.bundle.patch 并包含对应文件。');
  assert(typeof root.manifest.engines?.dsh === 'string' && semver.validRange(root.manifest.engines.dsh) !== null, 'BUNDLE_INVALID', '主插件必须声明有效的 engines.dsh 兼容范围。');
  for (const pkg of packages) {
    const owner = pkg.manifest.name + '@' + pkg.manifest.version;
    const optional = new Set(Object.keys(pkg.manifest.optionalDependencies ?? {}));
    const declarations = [
      ...entries(pkg.manifest.dependencies, 'dependencies', owner).filter(([name]) => !optional.has(name)).map(([name, spec]) => [name, spec, 'dependencies']),
      ...entries(pkg.manifest.optionalDependencies, 'optionalDependencies', owner).map(([name, spec]) => [name, spec, 'optionalDependencies']),
      ...entries(pkg.manifest.peerDependencies, 'peerDependencies', owner).map(([name, spec]) => [name, spec, 'peerDependencies']),
    ];
    for (const [name, spec, field] of declarations) {
      const dependency = parseDependency(name, spec, owner, field);
      const versions = byName.get(dependency.target) ?? [];
      const selected = semver.maxSatisfying(versions, dependency.range);
      const optionalPeer = field === 'peerDependencies' && pkg.manifest.peerDependenciesMeta?.[name]?.optional === true;
      if (!selected && optionalPeer && versions.length === 0) continue;
      assert(selected, 'DEPENDENCY_MISSING', '离线包集缺少兼容的依赖/peer 版本；请补齐原始 tgz 后重试。', 422, { owner, field, dependency: name, target: dependency.target, range: dependency.range, availableVersions: versions });
      edges.push({ owner, field, dependency: name, target: dependency.target, range: dependency.range, selected });
    }
  }
  return { root, warnings, edges };
}
