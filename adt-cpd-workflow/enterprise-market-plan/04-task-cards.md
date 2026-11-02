# 公司本地 Agent 实施协议与任务卡

本文件最终仓库位置：`adt-cpd-workflow/enterprise-market-plan/04-task-cards.md`。设计、接口与验收分别见同目录的 `01-design.md`、`02-client.md`、`03-server-offline.md`、`05-acceptance.md`。

2026-11-03 已核对 GitHub：`feat/adt-cpd-workflow-plan` 的代码基线仍为 `5d8fad25d136de2371c39f87a6013ffe441e3105`。公司拿到的 HEAD 可以比此提交更新，例如包含本交接文档的提交；必须检查该代码基线是当前 HEAD 的祖先，并核对影响本设计的源码是否另有变化。

## 一、如何让本地 Agent 执行

不要一次发“实现企业市场”并让模型自行拆解。向本地 Agent 提供本执行包，先执行 C00；之后每次只执行下一张满足前置条件的任务卡，按卡中的验证结果决定能否进入下一张。

运行依赖固定为当前项目已有工具链；`enterprise-market/` 服务使用 Node 内置模块，首版不新增 npm 运行依赖。客户端沿用官方 Discover 和 pluginManager。`dshmarket` 的独立界面兼容、登录系统、Web 管理后台、部门权限和强制更新不在本轮实现范围。

### 可以直接复制给本地 Agent 的总提示词

```text
你正在现有 StarMind 仓库实现企业插件市场。先读仓库 AGENTS.md，再依次读：
adt-cpd-workflow/enterprise-market-plan/00-START-HERE.md
adt-cpd-workflow/enterprise-market-plan/01-design.md
adt-cpd-workflow/enterprise-market-plan/02-client.md
adt-cpd-workflow/enterprise-market-plan/03-server-offline.md
adt-cpd-workflow/enterprise-market-plan/04-task-cards.md
adt-cpd-workflow/enterprise-market-plan/05-acceptance.md

这些文件规定了实现目标；公司无法访问外网，只有不保证完整的只读 npm 镜像。
本轮使用官方 format 1 索引、官方 Discover 和 pluginManager。
独立 enterprise-market/ 服务不得新增 npm 运行依赖，不得修改 deepseek-harness/ 子模块。
禁止重新设计另一套插件安装器、market index 格式或已安装状态数据库。

先读取 enterprise-market/work/progress.json；不存在则从 C00 开始。
每次只实施一张已满足前置条件的任务卡，完成卡中的全部必需断言后才标 passed。
不得跳过 C01 的真实管理器验证；mock、仅 HTTP 200、仅 pnpm add 成功均不能代替真实安装和加载。
每张卡只改白名单中的文件；如发现必须超出白名单，先给出具体冲突和最小变更建议，不自行扩大范围。
不要运行会访问公网或刷新 latest 的准备命令。缺少包或工具时，输出缺失清单，禁止临时更换版本或添加公网 fallback。
不要删除他人修改、reset、clean 或重写既有提交。每卡开始和结束记录 git 状态。
不要声称未运行的测试通过，也不要把测试跳过记成通过。随包工具的7项测试只证明fixture工具行为，不代表C01或真实DSH验收通过。

每卡结束更新 progress.json，写明修改文件、执行命令、退出码、关键断言、证据位置和未验证事项。
在回复中只说明：本卡结果、实际证据、阻塞原因或下一张卡。不要仅回复计划。
若工具或公司环境导致必需验证无法执行，当前卡记 blocked，列出所需输入；不要用虚假实现继续后续依赖卡。
仅在需要缺失信息或权限时请求用户处理；常规实现选择已由详设规定。
```

### 每次续接可以直接发送的提示词

```text
继续企业插件市场实施。读取 enterprise-market/work/progress.json 和
adt-cpd-workflow/enterprise-market-plan/04-task-cards.md。
从第一张未通过且前置条件已满足的卡继续；本轮只做该卡。
先核对当前工作区，不重复已通过的验证，除非新修改影响其结论。
按该卡的白名单实施并给出真实证据，更新进度；遇到必需环境缺失则列明阻塞，不绕过门槛。
```

## 二、统一记录规则

工作产物放 `enterprise-market/work/`，该目录加入 `.gitignore`；不得提交员工 Profile、凭据、私钥、真实公司配置或完整本机日志。可以提交的证据摘要放 `adt-cpd-workflow/enterprise-market-plan/evidence/`，使用脱敏配置和测试 Profile。

`progress.json` 最小格式如下，时间用带时区的 ISO 8601；不要把以下示例中的 `pending` 改成 `passed` 来代替执行。

```json
{
  "schemaVersion": 1,
  "codeBaseline": "5d8fad25d136de2371c39f87a6013ffe441e3105",
  "taskStartHead": "实际git rev-parse HEAD输出",
  "activeCard": "C00",
  "target": { "os": "未确认", "arch": "未确认", "channel": "beta" },
  "toolchain": { "node": "实际输出", "yarn": "实际输出", "pnpm": "实际输出", "dsh": "实际读取" },
  "cards": {
    "C00": {
      "status": "pending",
      "changedFiles": [],
      "checks": [],
      "evidence": [],
      "blockers": []
    }
  }
}
```

每项 `checks` 至少记录 `command`、`cwd`、`exitCode`、`assertions`、`result`。`result` 只取 `passed`、`failed`、`not-run`；`not-run` 不是通过。卡状态只取 `pending`、`in-progress`、`passed`、`blocked`。

缺失依赖记录到 `enterprise-market/work/missing-artifacts.json`：记录包/工具名、确切版本、系统架构、在哪里被需要、现有离线材料中是否找到。下载地址如尚未验证要写 `unverified`，不能编造 URL。该清单交回外网准备环境处理；本地 Agent 不尝试公网下载。

每卡通过后可创建独立本地提交；推送公司 Git 由公司既有权限与流程决定。提交使用明确文件路径，不执行包含整个工作目录的暂存命令。C02建立忽略规则前，C00/C01的work记录也不能提交。每次续接检查已有证据和提交，避免重复安装、重复发布或覆盖数据。

## 三、任务依赖关系

```text
C00 环境与基线
  -> C01 真实管理器技术验证
  -> C02 合同、配置校验与错误约定
  -> C03 不可变快照读取与只读分发
  -> C04 导入、完整性验证与发布指针
  -> C05 发布准备与离线认证
  -> C06 客户端企业配置与 Profile 初始化
  -> C07 企业模式完整接入与安装器交付
  -> C08 跨组件验收与失败恢复
  -> C09 离线交付和最终检查
```

每张卡内部按 A、B、C 子步骤实施。一个子步骤先验证再进入下一个；不要在尚未确认输入合同的情况下同时改所有模块。各卡中的新增模块名称以 `01-design.md` 至 `03-server-offline.md` 的文件树为准；若详设没有定义一个必需入口，返回设计缺项，而不是补出一套自己的架构。

## C00：核对代码基线、工具链和公司环境

**前置条件**：已收到完整仓库与本执行包；本卡不要求能访问 GitHub。

**修改白名单**：`enterprise-market/work/progress.json`、`enterprise-market/work/environment.json`、`enterprise-market/work/missing-artifacts.json`。本卡不得修改源码或锁文件。

**操作**：

1. 记录工作目录、`git rev-parse HEAD`、`git status --short`、submodule 状态；检查设计代码基线是 HEAD 祖先。HEAD 更新时对照影响市场的文件，记录漂移，不自动重置。
2. 阅读根 AGENTS.md、root package.json、upstream.json、Beta package.json 和仓库自带 Yarn 入口；记录实际 Node/Yarn/pnpm/DSH 版本。检查内网包缓存、vendored runtime、submodule、已构建 client 资源是否齐全。
3. 确认目标员工系统和架构、市场服务器运行系统、部署 origin。未知值记录为缺失，不用当前开发机值冒充全公司兼容矩阵。
4. 核对已有公司开发依赖是否可用。禁止运行 root `market:prepare`、`aa:prepare-release`、`upstream:install` 或任何 `latest` 刷新。不要把复制来的普通用户 pnpm store 当作完整依赖证明。

**通过证据**：代码基线关系、工具版本、目标环境、可用离线材料清单完整；工作区修改已识别且不会被覆盖。

**失败停点**：源码缺失、关键 runtime 包缺失、版本与设计不一致、白名单内已有用户修改会冲突。缺失与漂移写清楚；没有完整环境时不进入 C01。

**发送给 Agent 的短提示词**：

```text
执行 C00，只做只读环境核对和进度记录。按任务卡检查代码基线、工具链、submodule、vendored runtime、目标平台和部署地址，不安装、不改锁文件、不访问公网。给出可执行 C01 或具体缺失清单的证据。
```

## C01：真实官方管理器的最小内网安装验证

**前置条件**：C00 通过；所需官方 runtime 和客户端依赖已在本地。

**修改白名单**：`enterprise-market/tests/probe-manager.mjs`、`enterprise-market/tests/fixtures/`、`enterprise-market/work/`、交接目录 `evidence/C01-*`。可直接运行交接包 `tools/create-fixtures.mjs`；不得修改 fixture 来规避其预期失败。

**操作**：

1. 使用交接包脚本生成 `@starmind/enterprise-market-smoke` 的 1.0.0、1.1.0、1.2.0 及 helper 依赖包。1.2.0 的 apply 故意抛错。生成物不是认证报告。
2. 使用交接包 `tools/serve-fixtures.mjs` 托管 npm 元数据、原始 tgz、format 1 索引和 channel descriptor。它仅是127.0.0.1测试服务，不能作为生产服务部署。先运行 `node tools/create-fixtures.mjs --output <dir> --origin http://127.0.0.1:18765`，再运行 `node tools/serve-fixtures.mjs --release <dir> --port 18765`（tools路径相对交接目录）。fixture 中 verification 的 `not-run` 不能当作认证通过。
3. 按 `02-client.md` 指定入口启动真正的 headless Cordis Host 与 pluginManager，使用全新临时 DSH_HOME/Profile 和空专用缓存。从 channel descriptor 解析本次启动固定的 snapshot，index 与 registry 必须来自同一快照。不得启动 Electron，不使用员工 Profile。
4. 从索引记录安装 1.0.0，核对实际 manifest、lock、包版本、helper 版本及 bundle 加载结果；再更新 1.1.0 并验证实际加载版本。
5. 分别制造缺包/下载失败与 1.2.0 的加载失败，记录管理器的真实 `application`、操作结果和当前可用版本。若测试 Host 没有 HMR，必须重启加载探针，不能把未执行 apply 的 CLI 安装视为加载成功。
6. 记录并断言所有索引、检查、包、依赖请求都落在指定测试服务。公共 fallback 为空；发生失败后也不得请求 npmjs、npmmirror、GitHub、jsDelivr 等公网服务。

**通过证据**：真实管理器成功安装/更新；精确版本和依赖可核对；包失败和加载失败分别有实际结果；恢复成功只能在原版本重新可用后报告。请求日志不含公网尝试。

**失败停点**：官方 Host 无法启动、管理器配置与详设不符、索引选错版本、实际请求公网、失败后状态未知。先记录 API/行为差异，不复制另一套安装器补洞；需兼容 patch 时提交最小设计修订建议。

**短提示词**：

```text
执行 C01。使用执行包的真实 tgz fixture，运行真实 headless Host/pluginManager，在临时 Profile 和空缓存中验证索引固定版本安装、更新、依赖解析、下载失败及 apply 失败。保留管理器实际结果和请求日志；禁止 mock、Electron、员工 Profile，也禁止把未加载的 CLI 安装成功当作加载成功。
```

## C02：冻结数据合同、配置校验和错误约定

**前置条件**：C01 通过，官方能力与配置形式已被实际证据确认。

**修改白名单**：`enterprise-market/contracts/`、`enterprise-market/src/contracts.mjs`、`enterprise-market/src/errors.mjs`、`enterprise-market/tests/contracts.test.mjs`、`enterprise-market/examples/`、`enterprise-market/package.json`、根`.gitignore`中仅`enterprise-market/work/`与市场运行数据的忽略条目。合同字段以交接目录 `contracts/` 和服务端详设为准。

**操作**：

1. 建立独立的私有服务目录，运行入口为 Node 内置模块；没有npm运行dependencies，不加入根Yarn workspaces，不生成独立锁文件。不要改官方index schema的字段含义。
2. 落实 release manifest、verification 报告、服务配置、企业客户端配置的版本化校验。`release.json` 使用 `schema: starmind.enterprise-market.release`、`schemaVersion: 1`；字段和完整性校验方式按 `03-server-offline.md`。
3. 将 snapshotId 定义为 `release.json` 原始 UTF-8 字节的 SHA-256。认证报告单独引用该 ID，避免 lock/report 中包含 snapshotId 后产生自引用哈希。V1不引入签名与密钥管理，信任来自受控管理员输入、文件摘要、认证证据和TLS；摘要不能证明作者身份。
4. 区分输入包身份、部署 origin、批准目录和实际验证结果。不得用界面描述字符串替代服务器/Host 策略。
5. 实现确定的错误码与脱敏输出；相同错误不因调用入口不同而换成模糊 `unknown error`。packument的dist-tags来自manifest中明确的packageTags，不按最高版本自动生成latest。

**通过证据**：错误 schema 版本、重复 package@version 冲突、非法相对路径、错误 origin、缺失认证、未列版本的dist-tag、哈希不一致均被拒绝；有效最小样例通过。验证器不联网。

**失败停点**：发现官方索引不接受设计字段时停止该输入，不在 reader 中偷偷忽略必需字段；合同变更先在设计中补版本规则。

**短提示词**：

```text
执行 C02，只实现合同、配置校验和错误约定，禁止扩展业务。按详设固定字段、schemaVersion、原始字节snapshot哈希及分离认证报告。V1不实现签名体系。运行有效/无效输入测试，给出具体错误码；不得新增 npm 运行依赖。
```

## C03：实现不可变快照读取与只读分发服务

**前置条件**：C02 通过；先使用手工放置的受测 fixture 快照，不要求管理导入已实现。

**修改白名单**：`enterprise-market/src/server.mjs`、`enterprise-market/src/registry.mjs`、`enterprise-market/src/catalog.mjs`、`enterprise-market/src/paths.mjs`、`enterprise-market/src/cli.mjs`、对应 `enterprise-market/tests/`、`enterprise-market/examples/service.config.json`。

**操作**：

1. 实现只读 `serve --config`，按 `03-server-offline.md` 提供 health、`/channels/stable.json`、`/snapshots/<id>/dsh-index.json`、`/npm/snapshots/<id>/`包元数据、tgz及resources读取。descriptor的indexUrl与registryUrl指向同一个不可变snapshot，客户端不读一个会随发布改变内容的current registry。
2. 固定快照源数据不修改；对外 npm 元数据中的 dist.tarball 指向相同快照的内部包 URL，保持对应原始 tarball 的 integrity。官方索引物化 `source.registry` 为该快照 npm 基址。
3. scoped 包按已定义的编码规则解析；同名多个版本保留。未知包/版本返回明确 404，不向公司镜像或公网代理。
4. 实现流式文件响应、HEAD、长度和详设要求的缓存/ETag 语义；二进制下载不走目录 JSON 大小限制。只读服务不得暴露导入、发布、上传或执行命令的 HTTP 接口。
5. 拒绝路径穿越、符号链接逃逸、非法方法和错配 origin；只读取当前快照路径内部的已登记文件。

**通过证据**：用真实 pnpm 请求测试带 scope 的包及至少两个版本；下载文件字节与原 tgz 相同，integrity 对应；目录与 npm 地址全部为预期内网 origin；未知内容不会触发外部请求；只读服务无法修改存储。

**失败停点**：pnpm 请求形式与路由不兼容、URL 重写破坏 integrity、文件范围检查不成立时不进入导入发布流程。

**短提示词**：

```text
执行 C03，按服务端详设实现只读快照服务。用真实pnpm验证scoped包、多版本、元数据和原始tgz；检查registry及tarball URL均指向固定内网快照。缺包只返回404，不添加回源。禁止实现HTTP写接口和自定义依赖解析器。
```

## C04：实现管理导入、完整性核验和发布指针

**前置条件**：C03 通过；发布包来自受控的管理员输入目录。未认证fixture可用于导入与拒绝发布测试，不能作为真实上架证据。

**修改白名单**：`enterprise-market/src/import.mjs`、`enterprise-market/src/publish.mjs`、`enterprise-market/src/integrity.mjs`、`enterprise-market/src/cli.mjs`、对应测试与公开测试fixture。

**操作**：

1. 实现 `import --release --data-dir --expected-origin`。v1 输入为已解压发布目录；zip 只作为传输包装，服务端首版不实现归档解压。
2. import核验所有已声明文件大小和摘要、包身份与expectedOrigin，拒绝symlink/reparse point。允许未认证包导入为可读取但未发布的不可变snapshot，供最终URL冷验；它不能进入stable。publish才强制核验verification与snapshotId的绑定、认证证据摘要及必需用例通过。V1依靠管理员受控导入，不把摘要或人工填入的passed当作作者身份认证。
3. 导入写入同文件系统 staging，校验完成后原子迁移到不可变 snapshot。失败清理只允许操作本次 staging，不能删除现有快照。
4. 相同 snapshot 重复导入成功返回已存在；同 package@version 出现不同内容拒绝。并发导入与 publish 使用详设中的独占锁；中断后可识别未完成 staging，不能看到半个快照。
5. 实现`publish --snapshot <ID> --verification <验收运行ID> --data-dir <目录>`，只有认证通过才原子切换channel descriptor；`unpublish --channel stable --data-dir <目录>`按详设解除后续发现但保留旧快照。已运行Host保持本次启动的snapshot，直至下次启动或显式Host刷新；旧URL继续用于现有锁文件与恢复。发布时不得自动清理旧快照。首版匿名内网可读，未发布不是下载权限隔离，不能宣传未上架包对内网用户保密。

**通过证据**：篡改文件、错误origin、重复版本异内容、并发与中断导入均有确定结果；未认证快照可导入和按固定URL冷验，但publish拒绝not-run/failed或错误绑定的认证。发布模块单元测试中使用明确标记为synthetic的报告，不声称它是实际认证。读者只能看到旧完整descriptor或新完整descriptor；正在运行的Host不会半途切换快照。

**失败停点**：受控输入边界不明确、认证证据缺失、原子替换无法保证、同名版本冲突时禁止覆盖。不要用“最后写入优先”解决。

**短提示词**：

```text
执行 C04，实现命令行import/publish/unpublish。输入仅为管理员控制的已解压release目录，import验摘要和origin后原子提交可冷验快照；publish验认证绑定和证据通过后才切换channel descriptor。证明重复、冲突、并发和中断不破坏已发布快照，not-run认证不可上架，已运行Host保持固定snapshot，不清理旧版本。
```

## C05：实现发布准备与无公网认证流程

**前置条件**：C04 通过，准备与认证目标环境已按 C00 固定。

**修改白名单**：`enterprise-market/tools/prepare-release.mjs`、`enterprise-market/src/verify.mjs`、`enterprise-market/src/cli.mjs`、`enterprise-market/tests/prepare.test.mjs`、`enterprise-market/tests/verify.test.mjs`、`enterprise-market/examples/prepare.config.json`、`enterprise-market/work/`。

**操作**：

1. `node enterprise-market/tools/prepare-release.mjs --config <file> --out <dir>` 按详设从固定输入和锁定环境收集插件、依赖、包元数据及资源。CLI只含verify/import/publish/unpublish/serve，准备工具单独提供。网络准备阶段与内网认证阶段显式分开；只有配置明确允许的外网准备环境才下载，内网 Agent 不执行联网准备。
2. 不自写 semver/peer solver。使用绑定的 pnpm 在实际目标 Profile/基线中解析；包含安装过程实际要查询的宿主、peer、optional 和所有平台所需制品。区分“文件齐全”和“兼容认证通过”。
3. 生成release.json并固定expectedOrigin，先import为可读取的未发布snapshot，再在最终快照URL下冷缓存验证，认证通过后才publish。相同版本多套包共存时，不承诺未测集合；记录已认证的单装/组合、平台与工具链。
4. `verify --release <目录>`仅做结构检查，输出`assurance: structural`。`verify --snapshot <ID> --data-dir <目录> --runtime-config <JSON> --workspace <空目录>`才使用临时Home、空专用store、固定内网快照和真实管理器进行目标冷验；报告写到`data-dir/verifications/<snapshotId>/<runId>/`，生成`assurance: target-cold`的独立verification.json及evidenceFiles摘要，不能把status改为passed代替执行。发布命令为`publish --snapshot <ID> --verification <验收运行ID> --data-dir <目录>`。
5. 首版常规 JS 插件为基本支持范围。遇到 Git/URL依赖、原生编译、Electron或运行脚本额外下载时，按详设资源适配支持名单处理；没有受测适配器就明确失败并输出缺失清单，不临时关闭脚本/全局跳过校验。

**通过证据**：完整 fixture 可准备、冷验、导入和发布；缺失传递依赖/目标资源被认证发现；认证报告引用最终 snapshotId 与真实用例证据；修改 origin 或静态输入使原认证失效。

**失败停点**：公司环境缺制品、实际闭包无法解析、必需原生资源无适配、要求证据未运行。不得把热缓存成功转换成离线认证。

**短提示词**：

```text
执行 C05。按详设实现独立prepare-release工具和verify命令，区分允许联网的外网准备与禁止公网的内网认证。用固定pnpm解析真实闭包，在最终快照地址和空缓存下验证并生成独立认证报告。缺包/原生/Electron无适配时明确失败，禁止假认证或自写solver。
```

## C06：接入客户端企业配置与 Profile 初始化

**前置条件**：C05 通过；C01 的实际管理器配置事实仍有效。

**修改白名单**：`02-client.md`中列出的企业配置模块、Profile初始化/patch模块及其测试。先在`dsh-plugin-desktop-beta/`开发，公共文件按仓库规则同步Stable；Next本轮不新增企业业务接入，只保留门禁要求的兼容适配和原行为。不得改`deepseek-harness/`或直接编辑生成的vendor文件。

**操作**：

1. 实现唯一企业配置解析入口，按详设确定配置来源、优先级、字段和错误行为。企业地址由本地管理员配置，远程索引不能更改信任策略。
2. 本地policy绑定channelUrl、expectedOrigin和marketId。Host启动解析descriptor并冻结该次snapshot，新建企业Profile使用其中匹配的indexUrl和registryUrl，显式把fallbackRegistries设为空。精确使用C01证实的服务id与字段名，不搜索一个相似名字后猜测。
3. 非企业模式保持现有行为；已有普通 Profile 不自动重写或删除用户索引。检测旧 lock 中的公网地址、scope registry、Git及本地路径，按详设阻止直接标成“企业模式已就绪”。
4. 对配置错误显示可诊断状态；已有本地插件管理仍能使用。不得因市场暂时离线而阻断整个 StarMind 启动。

**通过证据**：企业/非企业、新建/既有 Profile、重复初始化、配置失效、用户自定义 patch 等场景通过；descriptor错配marketId/origin/index与registry快照时拒绝；发布新descriptor不改变当前Host的安装源；企业patch幂等且不触碰不归本功能管理的配置。

**失败停点**：实际 Profile 合成顺序覆盖了企业 registry、无法识别 managed override、现有用户配置冲突。返回具体冲突，不通过大段替换整个 YAML 解决。

**短提示词**：

```text
执行 C06，严格按02-client.md的模块和函数实现企业配置及Profile初始化。先Beta再按规则同步。Host解析channel descriptor并固定本次snapshot，匹配的index/registry和空fallback必须真正生效；保留普通模式和用户配置，初始化可重复，旧公网lock要显式识别，禁止修改upstream子模块。
```

## C07：贯通企业模式、安装入口与安装包配置

**前置条件**：C06 通过，至少有一个已认证发布快照。

**修改白名单**：`02-client.md` 指定的 Host 启动、企业模式插件组合、CLI 入口、安装包资源及相关测试；Beta/Stable 镜像按仓库规则同步。根 package.json/锁文件只有详设明确要求时才能改，不能刷新无关版本。

**操作**：

1. 用现有官方 Discover 显示公司目录，不增加第二个企业市场 UI。企业模式按详设排除会独立访问公网的 dshmarket/公共 Community Market 路线；普通模式保留。
2. 官方 UI、Host 和受支持 CLI 使用同一企业策略。客户端无法通过选择其他 registry、索引内任意URL或记住的旧选项跳过本地策略；详设允许的入口范围要明确测试。
3. 加入企业证书配置时同时覆盖 Host 与实际 pnpm 请求栈；不关闭 TLS 检查。凭据如首版未实现就保持配置不接受该功能，不能把明文 token 交给Renderer。
4. 企业安装包携带无秘密的配置模板与说明；部署端将公司具体地址和信任材料落到指定位置。普通安装包不意外进入企业模式。
5. 保留管理器真实结果与失败诊断，按需显示需配置、需重启和加载失败；Agent 的工具清单在下一轮刷新，不在运行中途假定新工具已可用。

**通过证据**：从全新企业安装配置进入插件页、安装、启停、卸载与更新可完成；实际请求不走公共源；普通模式回归通过；重启或加载错误没有被界面伪装成已启用。

**失败停点**：某个可见入口无法受企业策略约束、公共插件仍发请求、安装器资源路径不一致。具体列出入口与流量，不笼统声称“全局断网”。

**短提示词**：

```text
执行 C07，贯通企业模式的官方Discover、Host、受支持CLI和安装包配置。以真实流量证明统一内网策略，普通模式回归通过。首版不开发dshmarket兼容页面、SSO或Web管理后台；不要只隐藏按钮却保留后台公网行为。
```

## C08：跨组件验收、恢复与网络边界验证

**前置条件**：C07 通过。首次执行按 `05-acceptance.md` 运行全量；以后只有受新修改影响的项目需要重跑。

**修改白名单**：`enterprise-market/tests/integration/`、`enterprise-market/scripts/`、详设指定的客户端集成测试、交接目录 `evidence/`。修复实现缺陷时回到对应卡白名单，并重跑被影响的下游验证。

**操作**：

1. 在匹配目标的无公网环境，用空专用缓存和全新 Profile 完成安装、更新、停用、启用、卸载、重启加载。监听请求或使用环境网络策略，覆盖子进程；仅 mock fetch 不够。
2. 测试镜像缺包、传递依赖缺失、错误CA、错误包摘要、缺少认证或认证绑定错配、错误部署origin、下架、旧快照保留、服务中断及安装中断。
3. 确认固定版本选择不受 registry 的高版本/latest 变化影响；更改当前目录指针不改变已经固定快照URL的包内容。
4. 测试 Profile 切换、已有公网 lock 的迁移拒绝/显式处理、普通模式保留，以及 C01 中分别定义的包失败与 apply 失败。
5. 提交脱敏验收矩阵：用例ID、目标版本、实际结果、证据路径、是否通过。未知或没运行的矩阵格写未验证。

**通过证据**：必需验收矩阵全部通过，认证对应最终代码与最终制品，不依赖任何开发机热缓存。恢复成功有实际包与加载证据，不只有日志文案。

**失败停点**：任一必需用例失败或未运行，都不能标记整体验收通过。不要通过删用例、减少平台声明或自动跳过失败来“通过”。可以明确缩小支持范围，但必须由设计修订记录解释。

**短提示词**：

```text
执行 C08，按05-acceptance.md跑跨组件真实验收。无公网、空缓存、全新Profile是前提，网络观测覆盖pnpm子进程。逐项记录实际版本、错误与恢复证据，没运行写未验证，失败回对应卡修复，不删用例。
```

## C09：离线开发交付、仓库检查与交接收尾

**前置条件**：C08 通过；最终目标平台支持范围已明确。

**修改白名单**：`enterprise-market/README*`、部署与离线准备说明、`enterprise-market/scripts/`、交接目录证据摘要；必要的 `.gitignore`、根脚本和双语文档改动仅按仓库规则最小添加。不得修改默认联网发布的 freshness 规则来伪装离线构建成功。

**操作**：

1. 整理市场服务运行包，包含 Node版本要求、配置模板、启动/停止/备份/恢复/导入/发布步骤。运行包不得要求在公司重新下载 npm 运行依赖。
2. 整理 StarMind 开发和构建离线材料清单：Yarn、固定 runtime包、submodule、开发依赖缓存、Electron/打包器/平台工具等分别列明。未随包提供的明确写出缺失，不声称市场服务零依赖等于整个 StarMind 构建零依赖。
3. 若交接要求新增离线构建入口，只消费固定制品，缺失即失败；禁止从普通 build 间接调用公网 market/AA 准备任务。保留正常发布流程现有策略。
4. 运行根 AGENTS.md 要求且适用于本修改的类型检查、单测、变体同步和打包检查。因环境无法运行的检查要在最终报告明确列出，不标通过。
5. 检查提交内容不含真实公司地址以外的秘密、管理员私钥、用户 Profile、缓存大目录和未脱敏日志。输出最终实现清单、未实现项、支持范围和操作手册。

**通过证据**：公司可从说明启动只读服务、导入认证发布包、安装目标插件；源码检查和平台检查的通过/未验证状态可追溯；交付文件摘要与实际文件一致。

**失败停点**：缺少必需离线构建工具、平台验收未完成、包内含秘密、检查失败。保留已完成交付并列明剩余项，不把整个功能标成已完成。

**短提示词**：

```text
执行 C09，完成运行部署和开发构建的离线交接、适用仓库检查与最终报告。分开写市场服务运行依赖和StarMind构建依赖；缺失工具准确列出，不联网刷新latest、不削弱现有发布策略、不提交密钥或用户数据。所有未运行检查明确标注。
```

## 四、每卡给人的结果模板

```text
任务卡：Cxx，状态：passed / blocked
代码基线与当前提交：...
本卡修改：文件及目的，最多列关键项
实际验证：命令、退出码、断言、证据位置
未验证事项：没有则写无；不能写“应该没问题”
阻塞：具体缺少什么、在哪一步需要、谁能提供
下一张卡：只有本卡passed且前置条件满足时给出
```

本执行包用于减少模型的架构推断，并不能替代真实环境验证。必需的依赖、接口或验证条件缺失时，正确产物是可定位的缺项报告，而不是一套看似完整、无法在内网运行的实现。
