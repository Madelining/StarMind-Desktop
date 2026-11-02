# 服务端、发布制品与内网依赖交付实施章节

本文是待实现的确定性设计，不代表仓库已经具备以下能力。代码放在 enterprise-market/；最终方案文档放在 adt-cpd-workflow/enterprise-market-plan/。实现者不得把本章里的首版失败条件改成静默回退。

## 1. 首版范围与固定决定

首版服务使用 Node 内置模块，包括 http、https、fs、path、crypto、stream 和 child_process；不新增需要部署时从 npm 安装的运行依赖。复用客户端随包提供的、版本固定的 Node/pnpm 做准备和验收。服务不是自制的 npm 依赖解析器。

首版提供：

1. 一个匿名、只读的公司内网市场，单一 stable 渠道。
2. 官方 format 1 索引；每个上架版本都指向同一个不可变快照内的 npm registry。
3. npm 包元数据、单版本元数据、原始 tarball、单独声明的运行时资源下载。
4. 本机管理员 CLI 的结构校验、导入、冷验、发布、撤下；没有 HTTP 上传、发布、删除或后台登录接口。
5. 同一个包名可以在快照内拥有多个精确版本。服务只返回已经导入的版本，由固定 pnpm 正常解析版本范围、optional 和 peer。
6. 为一个明确的 Windows x64 / StarMind / dsh / Node / pnpm 基线认证首批插件单装和首批集合共存。

以下不属于首版承诺：

| 情况 | 首版行为 |
|---|---|
| 任意 npm 公网代理、请求时临时补包 | 返回明确的快照缺包错误；管理员准备新快照 |
| 任意旧 Profile、任意插件组合完全可复现 | 只认证列明的基线和组合；其他组合报告未认证，不能声称测试通过 |
| 直接安装外网 Git、URL、目录、workspace、link、patch 等依赖 | 准备阶段拒绝；管理员先制成经过验证的公司 npm 包 |
| npm alias、需要改写名称才能安装的依赖 | 首版拒绝并给出依赖链，不由公司 Agent 临时设计转换器 |
| 从客户端 HTTP 发布插件 | 不支持；使用本机受控管理员导入目录 |
| 服务端自己解压 ZIP / 重新打包第三方 tarball | 不支持 |
| 在终端自动编译原生模块、自动下载 Electron、浏览器、模型或外部引擎 | 没有相应资源适配器就拒绝该插件上架 |
| 上架失败后继续发布部分目录 | 不支持；保持原 stable 指针 |
| 摘要证明作者身份 | 不成立；摘要只检查内容一致性 |

首版信任边界是：管理员控制准备目录、数据目录和发布操作；HTTPS/TLS 保护传输；manifest 和文件摘要检测损坏。能够同时修改 manifest 和制品的管理员可以替换内容，因此这不是作者认证系统。Ed25519 签名是后续独立增强，首版不要求密钥、签名文件或签名服务。

## 2. 目录和 CLI

建议固定目录如下，任务卡不得再产生第二套服务入口：

~~~text
enterprise-market/
  contracts/
    release-v1.schema.json
    verification-v1.schema.json
    channel-v1.schema.json
  src/
    cli.mjs
    contracts.mjs
    errors.mjs
    integrity.mjs
    import.mjs
    publish.mjs
    catalog.mjs
    registry.mjs
    server.mjs
    verify.mjs
    paths.mjs
  tools/
    prepare-release.mjs
    create-fixtures.mjs
    windows-reparse-check.ps1
  tests/
  examples/
    service.config.json
    prepare.config.json
~~~

上述 schema 文件用于文档、测试与开发期检查；服务使用手工编写的窄范围校验，不为了 schema 引入 Ajv。不得自己实现完整 SemVer、npm resolver 或另一份官方市场格式。准备工具使用与目标 dsh 同版本的官方索引校验器；真实 Host 冷验再次经过官方解析路径。

固定 CLI 及语义：

~~~text
node enterprise-market/src/cli.mjs verify --release <目录>
node enterprise-market/src/cli.mjs import --release <目录> --data-dir <目录> --expected-origin <Origin>
node enterprise-market/src/cli.mjs serve --config <service.config.json>
node enterprise-market/src/cli.mjs verify --snapshot <ID> --data-dir <目录> --runtime-config <JSON> --workspace <空目录>
node enterprise-market/src/cli.mjs publish --snapshot <ID> --verification <验收运行ID> --data-dir <目录>
node enterprise-market/src/cli.mjs unpublish --channel stable --data-dir <目录>
~~~

- verify --release 只做格式、文件、摘要、引用和包清单检查，输出 assurance: structural；不能把它称为真实离线安装成功。
- verify --snapshot 在运行中的内网服务上进行目标环境冷验，报告写到 data-dir/verifications/<snapshotId>/<runId>/；不会修改 release.json。
- import 不修改 stable，也不覆盖已有快照；成功表示管理员已接收完整的制品目录。
- imported 快照的精确地址可被读取，但不会出现在 stable 渠道中。首版把管理员导入视为信任操作，不以“别人猜不到快照 ID”作为访问控制。
- publish 必须找到同一 snapshotId、同一 Origin、匹配基线的通过报告。结构校验或示例报告不能替代它。
- unpublish 只撤掉渠道指针；已发布过的快照和 tarball 继续可读，以保留旧锁文件和恢复能力。
- tools/prepare-release.mjs 是外网准备工具，不是部署服务必须执行的命令。服务端永远不会自行启动它或访问公网。

CLI 错误输出同时包含简短中文说明和机器可读 JSON。固定 exit code：0 成功；2 参数/配置错误；3 制品格式或摘要错误；4 依赖/兼容性/冷验失败；5 并发写锁占用；6 文件系统/空间/监听失败。错误中不得输出 token、完整环境变量或用户凭据。

## 3. 服务配置与部署 Origin

~~~json
{
  "schemaVersion": 1,
  "marketId": "starmind-company",
  "listenHost": "127.0.0.1",
  "listenPort": 8787,
  "publicOrigin": "https://starmind-market.company.example",
  "dataDir": "D:/StarMindMarket/data",
  "maxReleaseBytes": 4294967296,
  "maxJsonBytes": 16777216,
  "minimumFreeBytes": 2147483648,
  "logDir": "D:/StarMindMarket/logs"
}
~~~

示例域名仅为配置占位，正式部署必须换成公司可解析、可访问的地址。生产建议由现有内网反向代理终止 TLS，Node 监听回环地址；TLS 的证书、代理与公司 CA 由运维提供。无现成反向代理时，可以显式采用直连内网 HTTP 试运行，但必须把该部署的传输可信性限制写进报告，不能把 HTTP 描述为防篡改通道。

publicOrigin 必须为一个规范 http/https Origin：没有用户名密码、路径前缀、query、fragment；非默认端口必须保留。首版不支持部署在 /some/subpath/ 下。启动时通过 WHATWG URL 规范化后检查，不接受隐式公网默认值。使用 HTTPS 时，客户端与 pnpm 必须信任公司 CA；严禁用关闭 TLS 校验作为修复办法。

所有绝对分发 URL 都由已配置 publicOrigin 生成，绝不从 Host、Origin、X-Forwarded-Host、X-Forwarded-Proto 等请求头拼接。直接入口的 Host 必须与配置 authority 一致；反向代理必须保留该 Host。错误 Host 返回 421。release.json 的 marketId、deployment.expectedOrigin 必须与服务配置相同，否则导入/发布失败。

迁移域名、协议或端口会改变旧 lock 中的 URL。首版要求重新准备/物化目录、冷验并发布新快照；旧 Origin 应继续服务旧快照。不能只改服务配置而声称旧 lock 仍可用。

## 4. 发布目录格式

首版输入只能是已经解压的目录。ZIP 只是传输容器：运维使用系统工具将其解压到受控、隔离的临时目录，再执行 verify/import。服务自己不接 ZIP、不调用通用解压器、不实现 ZIP 库。解压后的目录仍需通过完整的路径与 reparse 检查。

~~~text
release-2026-11-initial/
  release.json
  catalog.json
  packages/
    YGNvbXBhbnkvZHNoLWRlbW8/
      1.0.0/
        metadata.json
        package.tgz
  resources/
    browser-runtime-win32-x64/
      electron-win32-x64.zip
  evidence/
    preparation-summary.json
    acquisition-log.jsonl
    acquisition-lock.yaml
~~~

文件名 YGNvbXBhbnkvZHNoLWRlbW8 只是 base64url(name) 的格式示意，工具必须实际编码，不能手写映射。packages 数组中的路径才是权威位置，服务不通过包名直接拼接磁盘路径。

release.json 的确定字段如下。下例摘要是类型示意，真实文件必须填满实际的 64 位小写十六进制摘要；校验器不得接受占位值：

~~~json
{
  "schema": "starmind.enterprise-market.release",
  "schemaVersion": 1,
  "marketId": "starmind-company",
  "releaseName": "2026.11-initial",
  "createdAt": "2026-11-03T00:00:00.000Z",
  "deployment": {
    "expectedOrigin": "https://starmind-market.company.example"
  },
  "runtime": {
    "baselineId": "<客户端基线导出的摘要>",
    "dshVersion": "0.2.2-alpha.2",
    "nodeVersion": "<实际完整版本>",
    "pnpmVersion": "<实际完整版本>",
    "platform": "win32",
    "arch": "x64"
  },
  "catalogPath": "catalog.json",
  "packages": [
    {
      "name": "@company/dsh-demo",
      "version": "1.0.0",
      "publishedAt": "2026-11-01T00:00:00.000Z",
      "metadataPath": "packages/<编码名>/1.0.0/metadata.json",
      "tarballPath": "packages/<编码名>/1.0.0/package.tgz",
      "integrity": "sha512-<原始tgz的SRI>"
    }
  ],
  "packageTags": {
    "@company/dsh-demo": { "latest": "1.0.0" }
  },
  "resources": [],
  "files": [
    {
      "path": "catalog.json",
      "size": 1234,
      "sha256": "<实际摘要>",
      "role": "catalog"
    }
  ],
  "verification": {
    "requiredCaseIds": [
      "baseline",
      "single:@company/dsh-demo@1.0.0",
      "combined:initial"
    ]
  },
  "preparedWith": {
    "toolVersion": "1",
    "nodeVersion": "<准备工具实际版本>",
    "pnpmVersion": "<与目标一致的实际版本>"
  }
}
~~~

约束：

- release.json 采用 UTF-8 无 BOM；snapshotId 是其原始文件字节的 SHA-256。任何换行、字段值或格式修改都会产生新 ID。
- files 必须完整列出 catalog、全部 metadata、全部 tarball、全部资源及需随包保留的许可证文件；重复路径、重复 name+version、路径大小写冲突均拒绝。
- ReleaseFile.role 固定为 catalog、metadata、tarball、resource、license、media；media 用于允许的索引位图等静态展示文件，不得混作可执行资源。
- release.json 自身不列入 files，避免自引用。evidence 是准备证据，不参与 snapshotId；最终部署冷验的报告也不写回 release.json。
- catalog.json 是官方 format 1。首版只收 source.type 为 npm 的版本，输入 source 不带 registry；导入时根据 snapshotId 和 expectedOrigin 确定性补入快照 registry。
- 官方索引允许多个发布版本；每一个可见版本都必须能在 packages 找到相同 name+version，并且声明 dsh.bundle 和合法 engines.dsh。
- 顶层目标必须是精确版本。catalog.plugins[].dist-tags 的目标必须在该插件 versions 中；packageTags 的目标必须在快照 packages 中。不得把“最大版本”自动写成 latest。
- 同名不同版本可以并存，且必须各有原始 tgz、元数据和完整性记录。
- publishedAt 保存原始 npm packument 的 time[version]；新公司包填写真实公司发布时间。不能用导入时间替换，也不能伪造旧日期绕过安装器的 release-age 策略。
- 原始元数据中的依赖版本范围、optional、peer、peerDependenciesMeta、engines、os、cpu、libc、scripts、bin 等都保留。不得为了让安装通过而删改 peer、降格兼容要求或删掉生命周期脚本声明。
- metadata.json 是 npm 的单版本 manifest 对象，含 name/version/dist 等，不是包含所有公网版本的完整 packument。原始整份 packument 若需审计，放 evidence，绝不直接作为服务响应。
- 首版索引图标仅允许省略、合规内联位图或同源快照位图资源；禁止公网图片 URL，避免列表加载时访问外网。SVG 清洗、远程截图和 README 图片代理不在首版范围。

服务导入后产生的物化索引位于 /snapshots/<snapshotId>/dsh-index.json。对每个 source，唯一物化结果为：

~~~json
{
  "type": "npm",
  "registry": "https://starmind-market.company.example/npm/snapshots/<snapshotId>/"
}
~~~

服务只能补入 registry，不能重写包名、版本、兼容范围和 dist-tag。官方索引校验器必须对物化后的完整索引运行一次。

## 5. 资源条目与生命周期边界

资源是 npm tarball 之外的真实文件，不能用“npm 包已镜像”代替。资源数组每项至少为：

~~~json
{
  "id": "browser-runtime-win32-x64",
  "kind": "electron-runtime",
  "version": "<精确Electron版本>",
  "platform": "win32",
  "arch": "x64",
  "path": "resources/browser-runtime-win32-x64/electron-win32-x64.zip",
  "size": 123456,
  "sha256": "<实际摘要>",
  "consumer": {
    "package": "dsh-builtin-browser",
    "version": "0.5.2",
    "adapter": "builtin-browser-electron-v1"
  }
}
~~~

adapter 必须对应仓库内有名称、有实现、有测试的适配器。首版不得实现“执行 manifest 给出的任意命令”的通用 hook。资源适配器只允许：下载、校验、解压到固定受控目录、验证文件/运行时版本、把确定路径交给指定插件。没有已实现适配器的资源应标为 unavailable，该插件不能通过 publish 验收。

服务不解压上述资源，也不会在请求时安装它。资源解压由消费者的特定适配器使用已存在的系统工具完成；路径和内容检查属于适配器验收。

## 6. 依赖闭包：如何准备，什么叫“完整”

完整闭包表示该快照拥有被认证安装过程中所需的全部包元数据、原始制品和额外运行时资源。它不表示任意现有 Profile 或任意插件组合都会得到同一依赖图。

准备工具必须采用以下顺序，不允许用“拿到顶层 tgz”替代：

1. 从目标客户端导出经过脱敏的 host baseline：StarMind/dsh/Node/pnpm 完整版本、系统架构、宿主包名与版本、随包 tarball/patch 的摘要、构建脚本策略及影响安装的受控配置。不得导出 API Key、SSH 配置、用户记忆或原始 .npmrc token。
2. 用同一 Node/pnpm，在空目录、空 store 和明确的外网 registry 取得基线及精确的首批插件目标。不得复用准备机器的用户 Profile、用户 node_modules、默认 pnpm store 或用户 lock。
3. 对每个真实取得的包，保存上游单版本 manifest、原始 dist.integrity、原始 tarball 和时间。上游 tgz 原样下载，先校验上游 integrity，再计算本制品的 SHA-256。不得从 node_modules 重新 pack 第三方包来冒充原始下载。
4. 依赖发现由真实 pnpm 安装结果和请求记录驱动；准备工具可以使用仅运行于准备机的 Node 采集代理记录包元数据及 tarball 请求，但必须把响应中的 tarball 指向采集器后再运行，不能漏掉绕过 registry 的直接下载。非 npm 下载另列 resources；无法归类的出网请求即准备失败。
5. 保留所有认证用例实际需要的依赖版本、peer 所需版本和目标平台 optional 包。不能只看顶层 package.json，也不能假定 dev/optional/peer 都不需要。devDependencies 不作为生产运行时闭包，但插件必须在准备端先构建，不能把尚待公司终端编译的源码当运行制品。
6. 构造只含已取得版本的快照 registry，再以同一 Node/pnpm 对最终快照重新冷安装。公网首次安装成功仅证明能采集，不证明内部快照完整。
7. 最终内网 Origin 上再跑真实管理器认证。缺少任一包、版本或资源就阻止该版本 publish，报告完整依赖链；不能把用户机器上的缓存作为通过理由。

npm 元数据同时存在多个版本是正常情况。pnpm 可以选择其中不同的合法版本；服务不改写依赖范围，也不做手工 SemVer 匹配。顶层精确版本、快照内可见版本集合、固定 pnpm、固定基线共同界定求解环境。实际求解结果由官方 manager 保存的 lock 和验收报告记录，不能把“制品集合完整”宣传为“所有组合完全可复现”。

准备端如果发现 npm alias 或任何 Git/URL/file/workspace/link/patch 来源，首版必须明确失败并报告 package -> dependency -> spec。宿主发行版自身经过 hash 认证的本地 tarball 是唯一例外：它由 host baseline 显式登记并映射到客户端随包资源，不接受用户任意文件路径。

## 7. Host、peer、旧 Profile 和 lock 的处理

宿主依赖不能被市场当作普通第三方依赖随便升级：

- host baseline 中的 @deepseek-ai、Cordis、React、桌面桥接等宿主关键包，要记录实际版本及随包制品摘要。相同 name/version 的公网包不自动等价于客户端经过 patch 的包。
- 准备机必须使用该发行版的真实宿主制品/patch，不能联网下载一个同名版本就当作宿主基线。
- 必需 peer 应由宿主或显式列出的插件满足；不兼容 peer、缺失必需 peer、同名核心包多版本导致的服务身份冲突，均让对应认证用例失败。不得自动升级 dsh、Cordis 或 React 来迁就插件。
- optional peer 只在被明确启用和认证的组合中要求存在；不得把所有远端 provider 都说成已具备可运行能力。
- 首版对基线、每个首批插件单装、首批整体集合分别验收。新增组合先报告未认证，不替用户默默选择另一套依赖。

旧 Profile 预检由客户端执行；服务必须提供检查需要的快照版本清单和 baselineId：

1. 对比实际 host baseline 与 descriptor.baselineId。不符即拒绝本次企业安装。
2. 检查已有顶层依赖、会参与求解的 lock，以及安装配置。含公网/Git URL、未覆盖版本、未登记 file/link、patch/override、会越过快照的 scope registry 或不明身份的核心包，即报告 PROFILE_EXTERNAL_REFERENCE，并在 details 中列出不覆盖原因。
3. 不自动删旧 lock、不自动改写旧 Profile、不静默回落公网。引导创建新的企业 Profile，保留原 Profile 供用户恢复；清理迁移是单独任务。
4. 同 Origin、仍被保留的旧企业快照 URL 可以作为恢复来源；它不能让新安装未经检查地混用不同快照。当前安装新取得的依赖必须来自本次 Host 固定的 registry。
5. 新企业 Profile 只使用发行版基线和明确目标生成求解状态，不复制用户历史 lock/store。.npmrc、scope registry、proxy、Git rewrite、pnpm hook 等配置必须由受控执行环境处理；仅传一个 --registry 并不能证明所有包都走内网。
6. lock 文件仍由官方 manager 拥有，服务不把自己的模板直接写进用户 Profile。保留 manager 原有锁、备份、失败恢复、构建脚本审批与应用结果。服务的发布原子性不能被描述为客户端安装原子性。

受控冷验环境应清理会影响 pnpm 源选择的用户/项目配置，并使用专用 home/store/config；保留运行 Windows/Node 所需系统环境和明确批准的公司 CA。不得把“清空环境”写成一个会破坏 SystemRoot、TEMP 等必需变量的粗暴实现。

## 8. 内网数据目录与原子导入

~~~text
data/
  writer.lock/
    owner.json
  staging/<uuid>/
  snapshots/<snapshotId>/
    release.json
    catalog.json
    packages/...
    resources/...
    derived/dsh-index.json
  verifications/<snapshotId>/<runId>/
    verification.json
    cases/<caseId>/pnpm-lock.yaml
    cases/<caseId>/installed-graph.json
  channels/stable.json
~~~

导入流程固定为：

1. 参数规范化、Origin/marketId 检查、磁盘剩余空间检查。
2. 在 data-dir 内用 mkdir 独占取得 writer.lock；记录 PID、主机、开始时间、操作和随机 owner ID。锁被占用返回 busy，不并行执行两个导入/发布/撤下。
3. 输入目录必须为普通目录。递归检查全部项，拒绝 symlink、junction、Windows ReparsePoint、设备文件和非普通文件。Windows 使用仓库内的固定 PowerShell 检查脚本，参数通过 argv 传递，不能拼接命令字符串；它发现 reparse 后先拒绝，再停止深入该目录。
4. files.path 必须是规范 POSIX 相对路径：拒绝空段、点、双点、反斜线、冒号、NUL、绝对路径、驱动器/UNC、大小写冲突、过长路径和解析后越界。对真实路径做 root containment 检查。未知未列入 files 的运行制品拒绝；evidence 只作为明确区分的非运行证据处理。
5. 把输入复制到同一卷的 staging/<uuid>，在复制过程中做大小上限和流式 SHA-256；按拷贝后的字节核对 manifest，不能仅核对源文件再无检查地复制。输入文件变化、缺失、摘要不符即失败。
6. 校验每个 metadata 的 name/version、dist.integrity、文件映射；校验 tgz 字节匹配其 integrity 和 release.files 摘要；校验 catalog 与包/版本一一可对应。
7. 生成物化索引与只读 registry 所需内存/缓存结构；调用与目标 runtime 匹配的官方格式校验器。冷验仍需真实 Host 再读一次。
8. 所有检查通过后，原子 rename staging/<uuid> 为 snapshots/<snapshotId>。同名已存在时，核对 release 原始字节和全部文件；相同为幂等成功，任一不同视为损坏，禁止覆盖。
9. 释放本进程拥有的 writer.lock。异常中断只留下 staging 或旧渠道，不能留下被 stable 引用的半个快照。

导入者应对源目录具有排他控制。摘要能发现复制损坏，不能取代对可同时改 manifest 的本机用户的权限管理。服务账户只需读 snapshots/channels，管理员 CLI 账户负责写入；不要给普通客户端共享盘写权限。

锁不按固定时间自动过期，避免大包导入时另一个进程抢锁。进程崩溃后的残留锁由管理员在确认同主机记录的 PID 不存在、没有其他写操作后按文档恢复。不得无条件删除未知锁；不得清理 staging 时递归删除未经解析检查的路径。

首版单进程服务、单数据目录；不支持多个服务器通过共享盘同时写入。不新增数据库或分布式锁。

## 9. 渠道发布、Host 冻结与恢复

GET /channels/stable.json 返回：

~~~json
{
  "schemaVersion": 1,
  "marketId": "starmind-company",
  "channel": "stable",
  "snapshotId": "<64位小写SHA256>",
  "indexUrl": "https://starmind-market.company.example/snapshots/<ID>/dsh-index.json",
  "registryUrl": "https://starmind-market.company.example/npm/snapshots/<ID>/",
  "baselineId": "<host基线ID>",
  "publishedAt": "2026-11-03T00:00:00.000Z"
}
~~~

publish 在 writer.lock 下完成：验证完整快照和指定通过报告 -> 生成新 descriptor -> 写同目录临时文件并 fsync -> 原子 rename 替换 stable.json。不能先删旧指针再写新文件。Windows 文件占用导致替换失败时，保留旧指针并报失败。

descriptor 的 marketId、Origin、snapshotId、indexUrl、registryUrl、baselineId 必须相互一致。服务不能让客户端提交任意地址让它代为读取。既有 stable 不存在时返回明确的 no-published-channel，而不是自动挑目录名最大的快照。

Host 启动时依本地管理员 policy 绑定的 channelUrl、marketId 和 expectedOrigin 读取一次 descriptor，验证后冻结 snapshot。一次预检/安装/重试都使用该冻结值。发布新版本不改变正在运行 Host 的 registry；下次启动或明确刷新 Host 才切换。服务必须保留旧 descriptor 指向的快照和所有旧制品，首版不实现 GC。

撤下 stable 不删除旧制品，也不能让一个已运行 Host 的旧快照突然 404。恢复上一版本就是管理员重新 publish 已保留且通过验收的旧 snapshot；不能覆盖旧 snapshot 的内容实现回滚。

## 10. HTTP 路由、metadata 和 integrity

只支持 GET/HEAD。所有写方法返回 405，Allow: GET, HEAD；不实现 CORS 写接口、管理 REST API 或请求时外网转发。

| 路由 | 内容 |
|---|---|
| /healthz | 服务可响应、marketId、是否有 stable；不做公网探测 |
| /channels/stable.json | 原子渠道 descriptor |
| /snapshots/<ID>/dsh-index.json | 物化后的官方 format 1 索引 |
| /snapshots/<ID>/release.json | 原始 release manifest |
| /npm/snapshots/<ID>/-/ping | 简单只读可达性响应 |
| /npm/snapshots/<ID>/<package> | 只含快照版本的 packument |
| /npm/snapshots/<ID>/<package>/<version> | 单个精确版本 manifest |
| /snapshots/<ID>/tarballs/<sha256>.tgz | 原始 tarball 字节 |
| /snapshots/<ID>/resources/<resourceId>/<文件名> | 已登记的资源字节 |

npm 包名路由必须兼容普通名，以及 @scope%2Fname、@scope%2fname、@scope/name。对各段最多 decode 一次；拒绝双重编码、NUL、反斜线和任何不能精确命中 manifest 包名表的值。版本从已导入精确版本表取值，不做路径拼接或模糊匹配。不存在的包或版本返回 404；不去公司镜像、npmjs 或 GitHub 现查。

packument 由 packages 记录组成，字段至少包括 name、versions、dist-tags、time：

- versions 只包含当前 snapshot 导入并校验过的版本，不能暴露上游其他版本。
- 每个 version 对象保留上游依赖、peer、engines、os/cpu/libc、scripts、bin 等事实。
- time 保留各版本真实 publishedAt；created/modified 可以由所含版本时间计算，不使用当前请求时间。
- dist-tags 只来自 packageTags；过滤悬空标签，不能凭 SemVer 最大值自行补 latest。
- metadata.json 中原始 dist.tarball 只保留在原始制品/审计信息中，服务响应必须换成该快照的 tarball 路由。
- dist.integrity 必须原样保留，并已核对原始 tarball 字节。dist.shasum 若原有则原样保留并验证；不得解包、重新压缩或修改换行后还保留旧 integrity。
- 首版支持 npm 常见的单项 sha512 或 sha256 SRI。无法验证的多项/未知算法或只有弱校验的上游制品，准备工具明确报告，管理员补充经过受控取得的强校验制品；不能默默忽略 integrity。
- 新公司插件的 tgz 由作者/准备工具只 pack 一次，计算其 sha512 SRI；后续传输和服务均保存同一份字节。

不可变 JSON 采用确定性序列化后缓存；binary 使用 fs.createReadStream 和 pipeline 流式输出。不要把 187MB 的包或 Electron ZIP 读进 Buffer，不在 HTTP 热路径重复计算整个文件 hash。

缓存约定：

- channel 与 health：Cache-Control: no-store，避免反向代理让 Host 固定到意外的旧渠道。
- 快照 index/metadata/tarball/resource：Cache-Control: public, max-age=31536000, immutable。
- ETag 为响应字节的摘要。支持 If-None-Match -> 304；HEAD 使用与 GET 相同的 Content-Length/ETag，不发送 body。
- 不压缩 tarball/ZIP，不做内容变换。首版不支持 Range；带 Range 的 binary 请求返回 416 和清晰错误，不能伪造 206。
- binary 默认 application/octet-stream + attachment，tgz 可标 application/gzip；JSON 为 application/json; charset=utf-8，并加 X-Content-Type-Options: nosniff。
- 固定请求头上限、headersTimeout/requestTimeout 与日志长度；下载允许合理超时和背压，客户端断开即关闭文件流。

统一错误 JSON：

~~~json
{
  "error": {
    "code": "VERSION_NOT_FOUND",
    "message": "当前企业快照没有该依赖版本，请联系管理员准备新快照。",
    "details": {
      "snapshotId": "<ID>",
      "package": "example-package",
      "version": "1.2.3",
      "requestId": "<随机ID>"
    }
  }
}
~~~

用 400 表示路径/参数非法，404 表示渠道/快照/包/版本不存在，405 表示不支持的方法，416 表示不支持的 Range，421 表示错误 Host，503 表示数据损坏或存储不可读。存在但摘要不符的文件不得继续返回 200。tarball 流开始后出错就终止连接并记录 requestId，不能再向二进制尾部追加 JSON。

日志记录 snapshot、route kind、状态、字节数、耗时、requestId；不记录请求认证头、token、原始 .npmrc 或环境变量。可记录内部包名用于缺包排查。服务启动后不向公网发送日志或遥测。

## 11. 冷缓存与目标平台验收

最低认证矩阵：

1. baseline：无新增社区插件，企业 Host 能启动，官方 manager/Discover 可用。
2. 每个首批插件 name@version 的独立安装；从同一干净 host baseline 开始。
3. combined:initial：首批认证集合共存，检查 peer、重复核心包、实际加载和工具可用。
4. 下载中断/缺一个依赖版本/损坏 tgz/损坏 resource/错误 Origin/不兼容 host/旧公网 lock 等负例。

每个安装用例必须：

- 在匹配目标的 Windows x64 与相同 Node/pnpm 上运行，不把 Linux 或另一台已有缓存的成功当作目标证明。
- 使用唯一空 workspace、空 store、专用 home/config；不复用 node_modules、锁文件或用户 pnpm cache。
- 首先在进程配置层将包源固定为 snapshot，清除 scope registry 与外网 fallback；同时在目标机器网络层禁止访问公网。只记录“我们传了 --registry”不算零外网证明。
- 通过最终内网 Origin、冻结的 snapshot 和真实官方 manager 执行预检/安装，记录 manager 的 applied/restart-required/failed 等真实结果。
- 用官方 Discover 读取物化索引，保证官方 format 1 校验没有漂移。
- 读取实际解包后的 package.json，把 name、version、dsh.bundle、engines 和依赖事实与相应 metadata 对照；不能仅因 metadata 声称是某版本就把另一个包体算作成功。记录实际依赖图，确认每一个所用版本都在当前快照或经过摘要认证的 host baseline 中。
- 保存实际 lock、结构化依赖图、资源准备结果、包/版本/完整性清单、请求目的地摘要、进程/工具版本、耗时和错误。报告脱敏，不保存凭据。
- 对 native/浏览器/office 类插件执行至少一个真实功能探针，不能只看 package.json 存在或插件条目显示已安装。
- 下载完整性失败时验证稳定渠道未改变；安装失败时验证官方 manager 的原有 manifest/lock 恢复行为。

verification.json 建议结构：

~~~json
{
  "schemaVersion": 1,
  "runId": "<运行ID>",
  "snapshotId": "<ID>",
  "marketId": "starmind-company",
  "expectedOrigin": "https://starmind-market.company.example",
  "baselineId": "<基线ID>",
  "assurance": "target-cold",
  "runtime": {
    "baselineId": "<基线ID>",
    "dshVersion": "0.2.2-alpha.2",
    "platform": "win32",
    "arch": "x64",
    "nodeVersion": "<实际版本>",
    "pnpmVersion": "<实际版本>"
  },
  "publicNetworkBlocked": true,
  "cases": [
    {
      "id": "baseline",
      "status": "passed",
      "evidenceFiles": [
        { "path": "cases/baseline/installed-graph.json", "sha256": "<摘要>" }
      ]
    }
  ],
  "status": "passed",
  "startedAt": "<ISO时间>",
  "finishedAt": "<ISO时间>"
}
~~~

报告及每条 case 的 status 枚举统一为 passed、failed、blocked、not-run。每条 case 的 evidenceFiles 数组元素固定为 path、sha256，可附 command 和 exitCode。不得使用 passed 布尔值或单个 evidencePath 字段形成第二套合同。顶层 baselineId 与 runtime.baselineId 必须相同，runtime 是完整 RuntimeBaseline。

报告不能由人工把 status 改成 passed 来代替执行。publish 检查 requiredCaseIds 全部存在且为 passed，重新核对证据文件摘要与工具/Origin/基线；assurance: structural、fixture-only 或缺少公网隔离证据的报告不可作为生产上架凭据。服务能检查本机报告的结构、绑定和证据文件，管理员对执行真实性负责；首版不提供远程可信执行或硬件证明。

fixture 工具可以生成简化的独立 not-run 报告，只含 schemaVersion、snapshotId、status、cases 和 note；该报告不属于可通过发布检查的生产 VerificationReport。不得给简化报告填写 passed，或通过省略 assurance/Origin/runtime 等字段绕过发布门槛。

因为实际 lock 含 snapshotId，报告及其 lock hash 不放回 release.json.files，否则会产生 snapshotId 的自引用。报告独立存储，引用已确定的 ID。快照运行内容保持不变；新增认证只增加一个验证运行，不改原始 snapshot。

## 12. 外网准备工具和下载交付清单

外网准备机可以联网；公司服务器和客户端不需要联网。tools/prepare-release.mjs 必须输出能搬运的 release 目录及以下信息：

- 准备配置：host baseline 来源、精确首批目标、目标系统/架构、精确 Node/pnpm、最终市场 Origin。
- 每个包的原始下载来源、精确版本、文件名、大小、sha256、上游 SRI、原始发布时间及许可证。
- 取得失败项及依赖链；未取得的依赖或资源不能被标为完整离线交付。
- 额外 runtime/引擎的下载来源、精确平台、校验方式、适配器名和验证探针。
- 全部原始 tgz、metadata、资源与必要许可证；以及 acquisition 阶段的 lock/请求摘要，供最终冷验核对。
- 一份面向操作员的步骤：外网准备 -> 运输 -> 系统解压 -> verify release -> import -> serve -> 目标冷验 -> publish -> Host刷新/重启。

examples/prepare-input.example.json 是准备工具的输入，不是 release.json。转换关系固定如下：

| 准备输入 | 发布目录输出 |
|---|---|
| marketId、releaseName | 原样进入 release 对应字段 |
| expectedOrigin | release.deployment.expectedOrigin |
| baselineId 和 target | 组成完整 release.runtime，准备工具核对实际工具版本 |
| plugins 中的精确 name/version 列表 | 要收录与采集的版本集合；展开依赖后形成 packages，并为顶层 bundle 形成 catalog.plugins[].versions |
| channels | 经目标版本存在性检查后成为 packageTags 和对应 catalog 插件的 dist-tags |
| resourceAdapters | 只选仓库中已实现的固定适配器；采集结果形成嵌套 consumer 的 resources 及 files |
| sourceRegistry | 仅供外网取得原始包，不能作为内网服务的 fallback |
| profileManifestPath、profileLockfilePath | 受控发行版基线的审计/构造输入；不能直接复制到最终冷验环境或用户 Profile |

输入中同一插件的 1.0.0 和 1.1.0 表示市场同时收录两个版本，不能把同名包的两个版本同时写进一份顶层 dependencies。单装用例分别测试；combined:initial 按批准的渠道目标为每个顶层包选一个精确版本。若需要认证不同顶层版本组合，增加独立 case，不能让公司 Agent 自行猜测组合。

读取基线 lock 不等于允许沿用其中公网 tarball URL。准备端用它识别原始基线事实和制品身份，最终快照冷验必须在空 lock/store 的受控环境重新经过官方 manager；不能把 sourceRegistry 或历史锁泄漏为最终下载来源。

pnpm、Node、官方索引校验器等准备工具优先取目标 StarMind 随包版本。确实需要单独准备时，下载精确版本并附带来源与摘要；禁止公司电脑首次运行 Corepack/npx 时再联网拉工具。不要把 node_modules 整体或用户全量 store 当作唯一交付物。

采集代理或工具下载必须使用允许的 registry 列表，限制重定向目标并记录最终 URL；不能变成无约束公网代理。上游 registry 给出的 dist.tarball 可能是不同域名，需要明确列入准备策略。缺失、403、限流和不支持的下载行为都失败并列出地址，不能把半成品发布给同事。

## 13. 已知插件的具体资源适配边界

这些是当前仓库研究得到的风险，属于认证对象，不等于已经实现：

| 对象 | 已知事实 | 首版确定处理 |
|---|---|---|
| dsh-builtin-browser 0.5.2 | 声明 electron ^44.10.0；postinstall 调 Electron 安装器，缺运行时会下载 | 快照固化实际解析的精确 Electron；准备平台 binary 与校验文件；实现特定适配器使插件能找到它。仅设置跳过下载但没有可运行 binary 判为失败 |
| dsh-remote / ssh2 | ssh2 安装脚本尝试 node-gyp 可选 crypto binding；cpu-features 也有原生构建 | 首版优先认证不编译可选加速组件的 JS 回退路径；必须实际 SSH 探针。若插件需要必需 native binding，提供目标 ABI 制品，否则不上架 |
| modlens | 插件 npm 包之外仍需要可用引擎；包声明 Node >=22.19 | 明确引擎文件/服务依赖和网络去向；没有内部引擎或已实现适配器则不宣称视觉能力就绪 |
| dsh-mnemon | 有多个 provider/source/strategy 传递包 | 安装闭包与运行能力分开；只认证实际可在内网工作的 provider，不把外部 SaaS 凭据或服务纳入默认已就绪能力 |
| dsh-univer-office | 未放入现有 vendor，文档提示大包和首次使用运行时风险 | 单独准备原始包及运行资源，实际做一次文档生成/预览；任何 CDN/运行时出网无法消除则首版暂不上架 |

原生制品必须绑定 platform、arch、Node ABI/需要时 Electron ABI；N-API 包按其真实兼容声明验收。不得把准备机生成的 .node 直接复制到所有终端，也不得要求用户临时安装 Python/MSVC/Node headers 后自行试错。必须从源码构建时，在匹配环境的准备机完成、保留许可证和构建来源、生成独立且可核对的制品；无法完成就给出明确不支持原因。

生命周期脚本仍遵守官方 manager 的构建脚本策略。不能通过去掉 scripts、全局允许所有构建脚本、关闭完整性校验或关闭 TLS 来打通验收。需要的脚本与资源适配器必须逐包记录；没有策略即失败。

## 14. 必须覆盖的实现验证点

服务开发测试至少包含：同名多版本及 scope 编码；元数据不泄露未导入版本；URL 物化不信任 Host；original integrity 与字节保持；重复导入；两个 CLI 争锁；导入中断和发布失败保留旧指针；symlink/junction/路径越界；目录大小写冲突；HTTP GET/HEAD/304/405/404/421；大文件流式输出与中断；旧快照在 publish/unpublish 后仍可读取；缺依赖明确失败、不向外网回退。

最小 fixture 必须有真实、可被 pnpm 读取的 tgz，声明 name/version/dsh.bundle，并带实际 bundle patch；只有“文件名叫 package.tgz”的假字节不能验证安装路径。fixture-only 报告可以测试结构和HTTP，但不能冒充生产基线冷验。

交接时必须把验证结论分成：已实现并实际执行、已实现但未在目标环境执行、尚未实现/不支持。任何只做 dry-run 的流程不得写成“完全离线安装通过”。

## 15. 对照来源

- [官方 format 1、npm registry source、精确目标与图标规则](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md)
- [官方 Discover 和 Host 读取边界](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/.agents/notes/implemented/feature/2026-10-02-plugin-market-discover.md)
- [官方 registry 回退与 private registry 规则](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/.agents/notes/implemented/architecture/2026-09-18-plugin-install-registries.md)
- [当前仓库安装器和离线脚本](https://github.com/Madelining/StarMind-Desktop/tree/5d8fad25d136de2371c39f87a6013ffe441e3105/adt-cpd-workflow)：以提交 5d8fad25d136de2371c39f87a6013ffe441e3105 为研究基线；它们提供参考约定，不是本方案已完成的证据。

