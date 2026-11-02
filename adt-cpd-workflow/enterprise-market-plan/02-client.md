# 客户端文件级实施：官方 Discover、Profile 与固定企业快照

本章最终位置：`adt-cpd-workflow/enterprise-market-plan/02-client.md`。
本章规定待实现行为，不声称真实 DSH Host 已验证通过；C01 是实现前的阻断门槛。
代码基线：`feat/adt-cpd-workflow-plan`，`5d8fad25d136de2371c39f87a6013ffe441e3105`。
公司 Agent 首先读取实际仓库根 `AGENTS.md`；当前文档工作目录没有源码检出，不可据此绕过仓库规则。

## 1. 范围与已知接入路径

首版复用官方 `dsh-plugin-market` 的 format 1 索引与官方 Discover；不实现另一套市场 UI。
不把 npm 包 `dshmarket`、`dsh-community-market` 与官方市场当成同一组件。
继续由官方 pluginManager 维护 manifest、lock、bundle、启停与安装结果，不增加安装状态数据库。
Beta 先实现；Stable 按仓库变体门禁同步；Next 本轮不新增企业业务。

已由基线研究确定的接入路径如下；插入点必须在 C00/C01 与实际源码再次对应：

| 路径 | 改造职责 |
|---|---|
| `dsh-plugin-desktop-beta/src/profile-plugin-market.ts` | 目前为官方市场写默认索引；企业模式写本次固定快照索引 |
| `dsh-plugin-desktop-beta/src/profiles.ts` | `NextProfiles` 的 Profile 构造/patch 组合；注入企业 Profile 配置 |
| `dsh-plugin-desktop-beta/src/host/index.ts` | 真实 Host 启动组合；在官方市场与管理器启动前应用企业运行上下文 |
| `dsh-plugin-desktop-beta/src/host-process.ts` | Electron 到 Host 子进程的启动边界；传递受控配置路径与证书环境 |
| `dsh-plugin-desktop-beta/src/main.ts` | 应用生命周期与 Host 启动协调；解析企业入口配置并显示启动状态 |
| `dsh-plugin-desktop-beta/package.json`、`build/installer.nsh` | 打包配置模板及企业部署材料；不写公司秘密 |

上述文件名和 `NextProfiles` 是既有接入点；本章以下 `enterprise-market/` 模块及函数均为拟新增设计。
旧函数的精确参数、配置的 Cordis entry 结构、CLI 注册位置必须以本地源码和 C01 证据确定，不能猜造。
官方配置服务键使用 `plugin-market` / `@deepseek-ai/dsh-plugin-market` 和 `plugin-manager` / `@deepseek-ai/dsh-plugin-manager`；两种 entry 写法的匹配方式由现有 Profile helper 及 C01 验证。
禁止为了省事同时插入两份同功能 entry；必须修改实际存在的官方服务配置。

## 2. 新模块与修改白名单

在 Beta 新建以下文件；不引入新的 npm 运行依赖：

```text
dsh-plugin-desktop-beta/src/enterprise-market/
  policy.ts         本地受控配置读取、类型与校验
  channel.ts        描述文件获取、缓存、固定快照解析
  baseline.ts       实际宿主基线导出、规范化与匹配
  profile.ts        企业 Profile 检查及最小配置 patch
  guard.ts          批准版本与包操作入口边界
  runtime.ts        一个 Host 内共享且不可变的运行上下文
dsh-plugin-desktop-beta/tests/
  enterprise-market-policy.spec.ts
  enterprise-market-channel.spec.ts
  enterprise-market-baseline.spec.ts
  enterprise-market-profile.spec.ts
  enterprise-market-guard.spec.ts
  enterprise-market-runtime.spec.ts
```

C06 白名单为这些新增模块及测试、`src/profile-plugin-market.ts`、`src/profiles.ts`。
C07 另含 `src/host/index.ts`、`src/host-process.ts`、`src/main.ts`、Beta 打包资源声明及 `build/installer.nsh`。
CLI 具体代码位置若不在上述文件中，在 C01 记录实际路径后补入白名单；未完成前不能声称 CLI 已支持。
需要 runtime patch 时走仓库已有 `patches/` 与 vendored runtime 工作流；先提交最小设计修订，不直接改子模块或生成 tgz。
不要为本章大范围更新 package.json、锁文件、现有 runtime 版本或 Community Market。

## 3. 唯一本地 policy 合同

权威字段与服务端共用交接包 `contracts/contracts.ts`，不要另造近似字段名。

```ts
interface EnterprisePolicy {
  schemaVersion: 1; mode: 'enterprise'; marketId: string;
  expectedOrigin: string; channelUrl: string; allowHttp: boolean;
  channelMaxAgeSeconds: number; caFile?: string;
}
type PolicyLoadResult =
  | { mode: 'personal' }
  | { mode: 'enterprise'; policy: EnterprisePolicy; policyPath: string }
  | { mode: 'enterprise-invalid'; error: MarketFailure };
function loadEnterprisePolicy(input: { policyPath?: string }): Promise<PolicyLoadResult>;
function validateEnterprisePolicy(value: unknown): EnterprisePolicy;
```

企业部署使用显式的 `STARMIND_ENTERPRISE_POLICY` 指向管理员控制的 JSON；测试可显式传路径。
没有该入口时为 personal；指定了入口但文件不存在、损坏或不合法时为 enterprise-invalid。
不要把读取失败当“没有配置”，否则会退回个人模式并访问公网。
普通 Profile 的设置不能覆盖此配置；远端索引不能更改 expectedOrigin、CA 或允许 HTTP。
只接受上述字段；拒绝未知字段、URL 内凭据/fragment、非同源 channelUrl、不合法 TTL。
expectedOrigin 必须是无路径、query、fragment 的 origin；channelUrl 固定为该 origin 的 `/channels/stable.json`。
生产默认 HTTPS；HTTP 只在 allowHttp=true 时使用，并明确展示管理员授权的开发/隔离内网模式。
caFile 必须是本地受控路径；不得关闭 TLS 校验，也不得把该路径和证书内容发给 Renderer。
首版不接受 token、cookie、用户名密码等鉴权字段；有需求时单独扩展合同。

## 4. descriptor、缓存和 Host 固定会话

```ts
interface ChannelDescriptor {
  schemaVersion: 1; marketId: string; channel: 'stable'; snapshotId: string;
  indexUrl: string; registryUrl: string; baselineId: string; publishedAt: string;
}
interface ResolvedEnterpriseSnapshot {
  readonly policy: EnterprisePolicy; readonly descriptor: ChannelDescriptor;
  readonly fetchedAt: string; readonly status: 'resolved' | 'cached';
}
function resolveEnterpriseSnapshot(input: {
  policy: EnterprisePolicy; baselineId: string; cacheDirectory: string;
  signal: AbortSignal;
}): Promise<ResolvedEnterpriseSnapshot>;
function validateChannelDescriptor(value: unknown, policy: EnterprisePolicy): ChannelDescriptor;
```

snapshotId 必须为 64 位小写十六进制 SHA-256；marketId 与本地 policy 完全相等。
indexUrl 必须为 `<expectedOrigin>/snapshots/<snapshotId>/dsh-index.json`。
registryUrl 必须为 `<expectedOrigin>/npm/snapshots/<snapshotId>/`，保留结尾斜杠。
baselineId 与本机认证基线相等；不能靠忽略字段放宽版本要求。
拒绝跨 origin 重定向、snapshot 路径错配、未知字段、非法日期和不支持 schemaVersion。
单次读取限制为 256KiB、超时 15 秒、最多 2 次同源 redirect；失败有明确错误，不请求公共服务。
缓存键为规范化 policy 中 marketId、expectedOrigin、channelUrl 的 SHA-256；缓存含 validated descriptor 与本机 fetchedAt。
缓存用原子替换写入受控应用数据目录；缓存不是安装记录，也不能从远端导入任意可信状态。
TTL 从最后成功获取并校验时刻 fetchedAt 计算，不从 publishedAt 计算；负年龄或超 TTL 视为 stale。
离线时可显示最后有效缓存；首版 cached/stale/unavailable 均不开始新的安装或更新，避免把缓存冒充当前发布状态。
已有本地插件查看、启停、卸载不依赖渠道在线，仍由管理器处理。
一次 Host 启动只 resolve 一次并冻结对象；索引与 registry 必须从同一对象生成，不能各自读 channel。
新 stable 发布对已运行 Host 不生效；下次 Host 启动或用户明确刷新 Host 后生效。
刷新前必须等待管理器操作完成；刷新是重建 Host 上下文，不原地改正在使用的 registry。

## 5. baselineId 的确定规范

baselineId 表示被认证的宿主组合，不能直接用应用显示版本或人工填写的 `beta-*` 字符串。
fixture 中的 `beta-*` 为 synthetic marker，仅测试协议，不是生产基线。
新增导出函数：

```ts
function exportRuntimeBaseline(input: {
  productVariant: 'beta' | 'stable' | 'next'; runtimeRoot: string;
  upstreamCommit: string; patchFiles: readonly string[];
}): Promise<{ baselineId: string; document: BaselineExport }>;
```

BaselineExport 固定包含 `schemaVersion:1`、productVariant、upstreamCommit、dshVersion、nodeVersion、pnpmVersion、platform、arch、packages、patches。
packages 为实际认证宿主闭包的 `{name,version,integrity}` 数组；从目标 lock 与随包 manifest 导出，不从公网解析。
patches 为作用于该 runtime 的 `{path,sha256}` 数组；path 用仓库相对 POSIX 路径。
至少覆盖官方 Host、plugin-manager、plugin-market、client-ui-plugin-manager、client-ui-plugin-market、随包 pnpm 及其实际宿主闭包。
Node 取真实 Host Node 完整版本，不取外层开发 shell 的 Node；DSH、pnpm 也取真实加载/调用版本。
canonical JSON：递归将对象 key 按 UTF-8 字节序排序；packages 按 name 再 version 排序；patches 按 path 排序。
数组除此保持定义顺序；字符串不额外 Unicode 归一化；只含 JSON 支持的值，拒绝 undefined、NaN、重复 package 身份。
输出 UTF-8、无 BOM、无缩进、无尾换行；baselineId 为这些字节 SHA-256 的 64 位小写 hex。
document 不包含 baselineId 自身、导出时间、绝对安装路径、员工 Profile 或机器名，避免循环与机器噪音。
导出 document、baselineId 和使用的工具版本随认证证据保存；服务端 report 引用同一值。
无法读取 lock/原始制品 integrity、补丁缺失或实际 runtime 不一致时导出失败，不猜默认值。
构建时可生成 baseline 文档随包携带；C00/C01 再核对实际 Host 二进制和包集合，不能仅相信预置文件。
同一 runtime 换目录所得 baselineId 应相同；任何包版本/integrity/补丁/Node 变化所得值必须变化。

## 6. Profile 最小 patch 与既有 Profile

```ts
function inspectEnterpriseProfile(input: {
  profileDirectory: string; snapshot: ResolvedEnterpriseSnapshot;
}): Promise<{ status: 'managed' | 'unmanaged' | 'external-reference'; issues: readonly string[] }>;
function buildEnterpriseProfilePatch(input: {
  snapshot: ResolvedEnterpriseSnapshot; existingText: string;
}): EnterpriseProfilePatch;
```

在 `NextProfiles` 既有“基础配置 -> 默认市场 patch -> 用户 patch”合成流程确定最终有效顺序；C01 必须打印脱敏后的有效配置。
不要仅在最前面写一个 registry 后任由后续 user patch 覆盖；也不要删除整个用户 patch 文件。
企业新建 Profile 的官方 indexes 只有 descriptor.indexUrl；管理器主 registry 为 descriptor.registryUrl；fallbackRegistries 明确为空数组。
scope registry、.npmrc、用户全局配置、环境代理可能覆盖主 registry；C01/C07 必须记录实际有效配置及实际请求。
不要用不存在字段“看起来写上了”当完成；官方配置字段结构与 registry 类型以 C01 的真实 API 为准。
补丁只管理 indexes、registry、fallback 及本功能明确所属字段；保留其他插件配置和用户数据。
EnterpriseProfilePatch固定为{text:string,changed:boolean}；existingText是现有cordis.patch.yml的UTF-8文本，复用当前yaml库按现有helper方式读写，不自写YAML解析器。没有变化时返回原文本与changed:false。
managed 标识只是本地配置归属提示，不是独立安装事实或信任证明；不能靠改一个标记使旧锁变安全。
重复初始化必须幂等；同一 snapshot 不反复改写 manifest/patch；切 snapshot 要显式、可恢复，不在包操作中运行。
旧 Profile 检查 package.json、lock、.npmrc 中公网 tarball、scope registry、Git/URL/本地路径依赖；报告问题与具体字段。
首版不自动迁移旧 Profile，提示新建企业 Profile；禁止偷偷删 lock 或改包依赖以绕过检查。
plain personal Profile 保持原默认来源与用户索引；企业配置不可用时不要对员工文件做半套改写。

## 7. 唯一运行上下文及应用接线

```ts
type EnterpriseRuntime =
  | { mode: 'personal' }
  | { mode: 'enterprise'; state: 'resolved' | 'cached'; snapshot: ResolvedEnterpriseSnapshot }
  | { mode: 'enterprise'; state: 'blocked'; failure: MarketFailure };
function createEnterpriseRuntime(input: RuntimeInput): Promise<EnterpriseRuntime>;
function getEnterpriseRuntime(): Readonly<EnterpriseRuntime>;
```

`main.ts` 读取受控入口，`host-process.ts` 只向 Host 传规范化配置路径/必要环境；不要在 Renderer 解析 policy。
`host/index.ts` 在 Profile 组合、官方 market/manager 插件启动前完成 runtime 创建，再把同一实例交给 Profile 与 guard。
真正的 descriptor 获取在 Host 进行；Electron main 不同时另取一份 descriptor 造成两个快照。
createEnterpriseRuntime先读取policy；personal分支不调用RuntimeInput.resolveBaseline，不做新增网络或基线导出。enterprise分支才通过该回调导出实际基线并解析descriptor。这样不会让个人模式因为新增基线材料缺失而启动失败。
阻断状态不使整应用退出：显示企业来源故障，本地不依赖市场的功能继续启动；禁用新的包安装/更新入口。
在企业模式中排除独立联网的 dshmarket 与公共 Community Market 装载；仅隐藏按钮不足以阻止后台请求。
personal 分支保持原组合；Next 本轮不引入企业 profile/插件组合，门禁要求的共享类型变化单独兼容。
企业 CA 同时作用于 Host 请求和管理器实际 pnpm 子进程；C01 检验实际子进程 Node/CA 环境。
不能设置 NODE_TLS_REJECT_UNAUTHORIZED=0；不能把广泛代理/凭据从 Renderer 透传。

## 8. 批准目录与官方管理器入口 guard

只设置 indexes/registry/fallback 不能保证所有入口只装批准版本：registry 可能保留旧版供恢复。
V1 的目标是正常入口内网路由与目录批准版本；不构成对本机管理员、手改 Profile 或任意插件代码的隔离。

```ts
function resolveApprovedTarget(input: {
  snapshot: ResolvedEnterpriseSnapshot; packageName: string; exactVersion: string;
}): Promise<{ packageName: string; version: string; registryUrl: string; snapshotId: string }>;
function assertEnterpriseOperation(input: {
  operation: 'install' | 'update'; target: ApprovedTarget; profileIdentity: string;
}): Promise<void>;
```

guard 用官方解析器读取当前固定 format 1，不自己发明另一套 SemVer/索引解释器。
只接受索引明确列出且兼容认证基线的精确 version；source 必须 npm 且 source.registry 等于当前 descriptor.registryUrl。
禁用范围版本、裸 latest、Renderer 传入的任意 registry/URL/Git spec；目录 dist-tag 解析后仍冻结精确版本。
assertEnterpriseOperation从已初始化Host上下文重新核对target和当前Profile，不信任调用方自行构造的ApprovedTarget；cached或blocked状态拒绝新包操作。它不获取新channel、不创建第二个管理器队列。
Discover 选版确认沿用官方交互；Host 对接受目标重新执行 guard，再调用官方管理器实际 API。
官方“已安装”页 listVersions/updateBundle 若只读 registry：必须加 desktop-owned 适配先过滤到批准版本，并在执行前再次 guard。
若真实 API 没有可用 hook，不能只改前端：C01 记录最小 runtime patch 需求，未接通前企业模式禁用该更新入口及对应远程操作入口。
CLI 必须复用 createEnterpriseRuntime/guard 和官方 manager；首版未接通 CLI 时明确返回“不支持企业包操作”，不冒称受控。
恢复旧版仅由当前这次已受理官方 update 的真实恢复机制执行；guard 不把恢复目标重新宣传为可安装批准版本。
后台恢复所需旧包保留在固定快照；普通用户选装仍依据目录批准清单，不依据 npm packument 最高版本。
同一包的串行/互斥沿用 manager；不在本功能创建第二套包操作队列或 receipt 表。
结果读取 manager 的 ChangeResult/PluginUpdateResult/application；包下载成功、安装成功、插件 apply 成功分开呈现。
启用后 Agent 工具集在下一轮刷新；具体 Host 能力事件必须 C01/C07 验证，不在已有模型调用中改变工具合同。

## 9. C01 必须实测的真实入口与停止条件

C01 探针固定放 `enterprise-market/tests/probe-manager.mjs`；只用临时 Profile、临时 DSH_HOME 和空专用缓存。
从 Beta `src/host/index.ts` 对照其 Cordis Host 装配，提取最小 headless Host 启动；不要 import 会启动 Electron 的 `main.ts`。
复用实际 `NextProfiles` 配置产物和官方 manager 服务，不用 mock manager、不仅执行 pnpm add、不伪造 application。
入口 ESM 导出、服务 id、manager config 的 registry/空 fallback 类型、index source.registry 传递以真实加载结果记录到 `evidence/C01-api.json`。
探针不能根据猜测循环试各种配置直到静默成功；不匹配时清楚记录哪项 API 与设计不一致。
使用随交接包 fixtures 的 smoke 1.0.0/1.1.0/1.2.0 和 helper；1.2.0 apply 故意失败，不得删掉失败逻辑。
先证明 index 精确 1.0.0 安装及 helper 实际版本，再更新 1.1.0；记录 manifest、lock、bundle 和真实加载版本。
区分缺包失败与 apply 失败；没有 HMR 时重启 headless Host 验证加载，未执行 apply 不算通过。
断言所有目录、metadata、tgz、依赖请求仅到 fixture origin；强制失败后公共 fallback 仍为空且没有公网尝试。
fixture HTTP 是 C01 专用：policy.allowHttp=true；先导出真实 baseline，生成 fixture 时传 `--baseline-id <真实64hex> --node-version <真实Host版本>`，生产校验不得接受默认 synthetic marker。
若官方 registry 类型只接受枚举或无法传自定义 URL，C01 blocked，先设计最小受测兼容 patch；不另写安装器绕过。
若官方已安装页/CLI 可跳过批准清单，C01 明确列出；C07 接通 guard 或禁止该入口后才能验收通过。
若无法观察子进程/网络请求、恢复后旧版未实际可用、真实 baseline 不匹配，记录 blocked/failed，禁止写 passed。

## 10. 测试与门禁顺序

单元测试覆盖 policy personal/有效/无效三态、未知字段、错源/错快照、TTL、失败缓存、baseline 确定性、Profile 幂等与保留用户配置。
guard 测试至少包含 registry 有更高未批准版本、目录删除版本、Renderer 任意 URL、切 Profile、操作期间 channel 更新和恢复旧版。
集成测试必须使用官方 Host/manager 证据；单元 mock 只能测试本功能分支，不能代替 C01/C08。
新增企业模块先通过 Beta 对应检查；再按 AGENTS 和 `check:desktop-variants` 确定共享镜像范围与同步方向。
Stable 老 runtime 的接口差异不能靠复制 Beta 代码假装支持；必要时保留阻断/能力检测分支并补测试。
Next 不做新增企业业务，但共享文件如被门禁覆盖必须编译且保持原行为，不能直接关闭门禁。
官方 plugin-manager 或 market 的 patch 改动后，C01 的真实证据失效，必须重新验证受影响步骤。
新增配置模板通过现有 extraResources/installer 资源入口随包；普通安装器不默认设置企业环境变量或带公司地址。
打包验收检查模板存在、部署后的路径可被 Host 读取、企业 CA 对真实请求生效、普通安装保留个人模式。
公司内网构建用固定 vendored 制品；不得运行刷新公网 market/Agents Anywhere latest 的准备步骤。
完成后将已支持/被禁用/未实现的入口列表、真实命令与退出码、网络日志摘要写入 C07/C08 证据。
任何未实测入口都不能写成“全入口管控”；当前工具的 fixture 测试通过也不等于真实 StarMind 企业市场完成。

## 11. 企业安装配置的发现顺序

员工无需设置环境变量或执行脚本。公司构建/部署环节提供实际policy，普通安装包只附示例，不携带公司真实地址。

固定优先级：显式STARMIND_ENTERPRISE_POLICY路径 > 企业包resources/enterprise/enterprise-mode.json声明的固定policy路径 > personal。企业mode文件内容固定为{schemaVersion:1,mode:'enterprise',policyFile:'enterprise-policy.json'}，policyFile只允许这个固定相邻文件名，不接受任意路径。企业包还必须携带相邻enterprise-policy.json；真实配置从公司受控构建输入复制，不提交公开仓库。

mode文件存在但缺policy、任一JSON损坏或schema不符，均进入enterprise-invalid，不能当personal。普通包没有mode文件；测试模板命名enterprise-policy.example.json，不会被自动启用。主进程只确定配置入口并向Host传路径，descriptor仍由Host唯一读取。

C07资源白名单增加resources/enterprise/enterprise-mode.json、enterprise-policy.example.json及现有打包声明；实际企业policy是构建输入，不进入Git。安装/升级验收必须确认企业发行物持续携带mode标志和policy，不能用普通更新包把企业模式悄悄移除。

## 12. 本章类型补全与探针协议

RuntimeInput、BaselineExport、ApprovedTarget、EnterpriseProfilePatch等确定类型见contracts/client-api.d.ts；不要把文中的类型名当作已经存在于项目里的类型。C01探针输入输出及本机调用方式见contracts/service-api.d.ts和contracts/README.md。
