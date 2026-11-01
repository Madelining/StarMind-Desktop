# ADT / CPD 软件开发流程 × StarMind 一体化设计方案

**版本** v0.1（草案，待评审）  
**日期** 2026-11-01  
**适用** ADT 产品线、CPD 产品线的日常开发、联调、验证与交付  
**客户端** StarMind（Desktop，profile = `desktop`）  
**状态** 设计稿：用于技术评审，未包含 artget 的具体命令（待补）

---

## 0. 一页纸结论

把"开发-测试-运行"整条链重新切成 **5 个可判定的阶段（stage）** 和 **5 个门（gate）**，然后按下面的分工把它们装进 StarMind：

| 层 | 归谁 | 关键决定 |
|---|---|---|
| **执行环境** | StarMind 原生远程能力（`dsh-remote`）+ 机器矩阵 | 三种姿态：本地会话 / 远程镜像会话 / **远程 StarMind 界面**（在 Linux 机上跑整个客户端，Windows 只开一个标签页） |
| **确定性动作** | `devgate` CLI（独立程序，与 AI 解耦） | 编译、跑测、起 GUI 截图、校验背景包、打包——全部是脚本，输出结构化 JSON |
| **决策与解释** | 模型 + Skill | 选路、看日志定位、改代码、写报告；**不负责判断"过没过"** |
| **流程编排** | StarMind 会话/子 agent/定时任务 为主，LangGraph 通过 MCP 保留 | 不把 langgraph 搬进 StarMind；它变成"人工闸口服务" |
| **证据** | git commit + `bgpack.lock.json` + `devgate` receipt | 门的结论绑定 commit SHA 与背景包版本，可复算、可审计 |

**一句话**：把"C++/Qt 的确定性"下沉到脚本，把"判断与写作"交给模型，把"跨机器"交给远程工作区，把"什么时候停"交给门。

**最小可行路径**：一台 Linux 测试机 + 一条 `artget → cmake → 起界面 → 截图` 的链路，一周内能跑通，就能证明整件事成立。

---

## 1. 目标与非目标

### 1.1 目标

1. **一站式**：开发者不离开 StarMind 就能完成拉背景包、写码、编译、跑测、看界面、联调、打包、出报告。
2. **环境无感**：Windows 写码 / Linux 写码两种习惯都支持，且**同一个项目、同一套流程、同一份产物**。
3. **阶段自动流转**：阶段推进由可判定的门驱动，人不做"传话"和"手工搬文件"。
4. **可复算**：任何一次"跑通了"的结论，都能用同一 commit + 同一背景包版本重新算出来。
5. **可治理**：危险动作（烧写、发布、切背景包版本）有人工闸口；全部命令有审计。

### 1.2 非目标（本期不做）

- 不重写 LangGraph 图，不把节点逻辑迁进 StarMind 会话。
- 不做浏览器版团队协作平台，不做多人共享会话。
- 不做 Qt 代码的自动生成式重构（模型可以改，但不是流程的一部分）。
- 不做硬件在环的自动化夹具（测试台仍是人接、脚本驱动）。

---

## 2. 约束与既定事实

| # | 事实 | 对设计的影响 |
|---|---|---|
| F1 | 两条产品线 ADT / CPD，本质都是 **Qt + 上下位机** | 流程可以共用一套引擎，差异只在"产品参数"（构建目标、背景包名、联调协议） |
| F2 | 两种编码习惯：Windows 写 → Linux 测；Linux 写 → Linux 测 | 必须有"远程工作区"与"远程整机"两种姿态，不能只支持一种 |
| F3 | 程序拉起必须有**背景包**，通过 `artget` 从内网托管服务器拉取 | 背景包是环境的第一类公民：必须版本化、校验、缓存、**不进代码镜像** |
| F4 | 全流程在公司内网 | 模型通道必须先确认；凭据、密钥不能进工作区 |
| F5 | 已有 opencode 的 ADT Skill 与 CPD 工作流（子 agent + langgraph） | 资产可复用（提示词/经验），**编排要重新选型** |
| F6 | 客户端为 StarMind Desktop（Electron，profile 名 `desktop` 由应用保留） | 插件经侧栏「插件」页或内置命令安装；`dsh` CLI 拒绝直接启动 desktop profile |

---

## 3. 设计原则

1. **确定性下沉**：凡是"对/错"能由程序判定的，一律写成脚本；模型只读结论。模型判断"编译过没过"是本设计明确要消灭的失败模式。
2. **环境即数据**：机器、路径、背景包版本、显示方式，全部写成可读的文件（`env.json` / `bgpack.lock.json`），而不是散落在人的记忆和聊天记录里。
3. **门绑定证据**：门的通过凭证 = `(commit SHA, bgpack 版本, stage, 时间, 运行者)`。改代码即失效。
4. **一个真相源**：代码真相在 git，环境真相在 `bgpack.lock.json`，运行真相在 receipt。三者之外不设第二份状态。
5. **可降级**：没有 StarMind 时，`devgate` 仍能手工跑；没有 langgraph 时，人工闸口用 `ask_user_question` 顶上。
6. **最小机制**：能用一个 skill 说清的事，不写插件；能用一个脚本判定的事，不建服务。

---

## 4. 总体架构

```
┌──────────────────────────── Windows（开发者本机） ────────────────────────────┐
│                                                                              │
│  StarMind Desktop  ── 会话A：远程镜像工作区（cwd = 本地镜像）                 │
│      │                rw_connect / rw_sync / rw_exec / rw_push                │
│      │  ── 会话B：远程 StarMind 界面（SSH 隧道 + token，整机在 Linux 上）      │
│      │                                                                        │
│      └── 内置零件                                                             │
│          · Skill（adt-* / cpd-* / qt-verify）                                 │
│          · 工具（read/write/edit/pwsh/grep/present/schedule/subagent）        │
│          · 远程工具（22 个 rw_*，仅远程会话全量暴露）                          │
│          · MCP 客户端 → cpdflow（LangGraph 包装）                              │
│          · 自动化任务（夜间构建 / 周报）                                       │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ SSH（内网）
┌───────────────▼──────────── Linux 构建机 / 测试机（按机器矩阵分组）───────────┐
│                                                                              │
│  /opt/ws/<line>/<repo>        代码工作区（git）                                │
│  /opt/bgpack/<line>/<ver>/    背景包缓存（artget 落地，只读）                  │
│  /opt/devgate/bin/devgate     ★ 门禁 CLI（确定性）                            │
│  /opt/qtqa/                   截图/日志/报告产出根                              │
│  Xvfb :99 + Qt(xcb)           GUI 冒烟                                         │
│  dsh --profile headless       CI/无人值守入口                                  │
│  dsh --profile acp            LangGraph 反驱入口（可选）                        │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ 串口 / telnet / 专用协议
┌───────────────▼──────────── 上下位机测试台（硬件在环）───────────────────────┐
│  设备 + 联调脚本（协议层校验、时序断言）                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

**关键点**：StarMind 既是"操作员"（会话内调用工具），也是"被操作对象"（在 Linux 上跑一份自己）。后者是本方案里最省事的答案——**同一套 skill、同一套门禁，在 Windows 会话里和在 Linux 整机上跑的是同一份**。

---

## 5. 执行环境模型

### 5.1 三种姿态（按开发者习惯自动选）

| 姿态 | 场景 | 机制 | 代价 |
|---|---|---|---|
| **A. 本地会话 + 远程执行** | Windows 写码，Linux 编译测试 | `rw_connect` → `rw_pick_workspace` → `rw_exec` / `rw_sync` / `rw_push` | 每步一次 SSH 往返；镜像有界（默认深度 8、2000 文件） |
| **B. 远程镜像会话** | 同上，但希望 `read`/`edit`/`grep` 这些内置工具直接对项目生效 | 会话 cwd 落在一个远程镜像工作区；`rw_*` 全量可用 | 大仓首次 `rw_sync` 慢；`@` 引用与内置工具看的是镜像 |
| **C. 远程 StarMind 界面** | Linux 写码，或长时间无人值守（整夜回归、GUI 巡检） | 在 Linux 上起 `dsh web`，通过 SSH 隧道搬到本机一个 loopback 端口，浏览器标签即那台机器的完整界面 | 需要在 Linux 上装一份 StarMind；两端版本要一致 |

**推荐默认**：日常开发用 **A/B**（一台客户端、一个会话、一个上下文）；**C** 用于"测试机常驻"和夜间任务。

> 注意两个已知边界：① 本地会话只暴露 `rw_machines / rw_connect / rw_pick_workspace`（`localTools: bootstrap`），想做文件操作要走远程会话；② 内置 `read` 看到的是**本地镜像**，要读远端真实内容用 `rw_read_file`，或先 `rw_sync`。

### 5.2 机器矩阵

用远程机器注册表的**环境 / 标签 / 位置**三组元数据，把"该连哪台"变成一次查询，而不是靠人记 IP：

| environment | 标签 | 用途 | 权限预设 | 允许的危险动作 |
|---|---|---|---|---|
| `build` | `line:adt`, `line:cpd` | 编译、单测、静态检查 | 工作区写入 | 无 |
| `qa` | `line:adt`, `gpu:no` | GUI 冒烟、集成测试 | 工作区写入 | 无 |
| `bench` | `line:adt`, `hw:serial-1` | 上下位机联调 | 工作区写入 + 每次命令审批 | 允许串口/协议写入，禁止烧写 |
| `release` | `line:*` | 打包、产出发版 | 只读 + 人工审批 | 打包需二次确认 |

落地方式：`rw_machines(environment="build", tags="line:adt")` → 取 id → `rw_connect(machineId=...)`。**保存 ≠ 激活**，只有 `rw_connect` 或界面「连接」才进入会话的 remote context。

### 5.3 环境自检：把"为什么我这儿跑不起来"变成一次查询

每个环境提供一份机器可读的事实，agent 第一步永远读它：

```json
// /opt/devgate/env.json（部署时生成，随机器走）
{
  "schema": 1,
  "line": "adt",
  "os": "Ubuntu 22.04",
  "qt": { "root": "/opt/Qt/5.15.2/gcc_64", "cmake": "/usr/bin/cmake", "generator": "Ninja" },
  "display": { "mode": "xvfb", "display": ":99", "platform": "xcb", "geometry": "1920x1080x24" },
  "bgpack": { "cacheRoot": "/opt/bgpack", "artget": "/opt/bin/artget", "server": "artget://intranet/adt" },
  "bench": { "kind": "serial", "device": "/dev/ttyUSB0", "baud": 115200 },
  "workspaces": { "adbMain": "/opt/ws/adt/adt-main", "cpdMain": "/opt/ws/cpd/cpd-main" },
  "dsh": { "node": "/usr/bin/node", "profiles": ["headless", "acp"] }
}
```

`devgate env-check` 只做三件事：读 `env.json`、验 `bgpack.lock.json` 与磁盘实际安装是否一致、验显示与工具链可用。**任何一项不一致，立刻以"环境错误"退出码结束，而不是让模型去猜。**

---

## 6. 流程模型：阶段与门禁

### 6.1 阶段表

ADT 与 CPD 共用同一张骨架，差异在括号里的产品参数。

| # | 阶段 | 输入 | 动作 | 产物 | 门（通过条件） | 谁批准 |
|---|---|---|---|---|---|---|
| S0 | **env-check** | `env.json`、`bgpack.lock.json` | 校验工具链、显示、背景包、磁盘 | `receipt-00-env.json` | 全部 `ok:true`，背景包 sha256 与锁文件一致 | 自动 |
| S1 | **sync** | commit / 分支 | `git fetch` + `checkout` + 干净度检查 | `receipt-01-sync.json` | 工作区无未提交改动，HEAD == 目标 commit | 自动 |
| S2 | **build** | 源码 + 背景包 | `cmake -S -B … && cmake --build … --target all` | 可执行文件 + 编译日志 | 退出码 0，**零新增 warning**（阈值可配） | 自动 |
| S3 | **verify** | 可执行文件 | `ctest` + 静态检查（Qt 相关：`clazy`/`clang-tidy` 可选） | 测试报告 + 覆盖率 | 通过率 100%，新增静态问题 0 | 自动 |
| S4 | **gui-smoke** | 可执行文件 + 显示 | Xvfb 起界面 → 等首帧 → 关键路径点击/输入 → 截图 → 断言 | 截图集 + 控件树 dump | 进程存活 N 秒、无 crash 日志、关键控件可见、截图与基线差异在阈值内 | 自动（首次基线需人工确认） |
| S5 | **bench** | GUI + 上下位机 | 联调脚本：握手、命令序列、时序断言 | 协议日志 + 断言结果 | 全部断言通过 | **人工闸口**（设备接线确认） |
| S6 | **package** | 构建产物 | 打包、签名、产物清单 | 交付包 + `manifest.json` | 产物可解包、版本号符合规范 | **人工确认** |
| S7 | **handoff** | 全部 receipt | 生成变更说明 + 证据包 | 报告（Markdown/HTML） | 报告齐备 | 自动 |

> 阶段可跳过（例如只改界面文案不必跑 S5），但**跳过要留记录**：`devgate skip S5 --reason ...`，写进 receipt。

### 6.2 门的契约：`devgate`

单一 CLI，所有阶段同一套出入参。**这是整个方案的地基，必须先做。**

```bash
devgate <stage> --line adt --workspace /opt/ws/adt/adt-main --json
```

```jsonc
// 输出（stdout，单行 JSON）
{
  "schema": 1,
  "stage": "build",
  "line": "adt",
  "status": "pass",            // pass | fail | blocked | env-error
  "commit": "3f9c1ab…",
  "bgpack": { "id": "adt-bg-2026.10", "sha256": "…" },
  "startedAt": "2026-11-01T02:11:03Z",
  "durationMs": 482310,
  "artifacts": [{ "kind": "binary", "path": "/opt/ws/adt/adt-main/build/adt_app" }],
  "evidence":  [{ "kind": "log", "path": "/opt/qtqa/adt/3f9c1ab/build.log", "bytes": 90211 }],
  "metrics":   { "warnings": 0, "testsPassed": 142, "testsFailed": 0 },
  "blockers":  [],
  "next": "verify"
}
```

**退出码语义**（模型据此决定行为，这是设计里最容易省掉、也最不该省的一环）：

| 码 | 含义 | 模型该做什么 |
|---|---|---|
| 0 | pass | 继续下一阶段 |
| 1 | fail（代码/测试问题） | 读证据、定位、改代码、重跑本阶段 |
| 2 | blocked（需要人） | `ask_user_question`，不自行绕过 |
| 3 | env-error（环境问题） | 修环境或换机器，**不要改代码** |

这条约定消灭了最常见的浪费：把"环境坏了"当成"代码错了"，让模型白改半小时。

### 6.3 门凭证与"过门后改代码"

过门时写 `receipt-<NN>-<stage>.json`，并更新 `.devstate/gates.json`：

```json
{ "schema": 1, "line": "adt", "gates": {
  "build":  { "commit": "3f9c1ab", "bgpack": "adt-bg-2026.10", "at": "2026-11-01T02:19:05Z", "status": "pass" },
  "verify": { "commit": "3f9c1ab", "bgpack": "adt-bg-2026.10", "at": "2026-11-01T02:31:40Z", "status": "pass" } } }
```

规则：**任何门凭证的 `commit` 与当前 HEAD 不一致即视为过期**。后续阶段（尤其 S5/S6）启动前必须复验。这样"过了门偷偷改一行再发布"在机制上不成立。

`.devstate/` 加入 `.gitignore`（它是本机状态，不是代码）。

### 6.4 自动流转 vs 人工闸口

| 阶段 | 流转方式 | 理由 |
|---|---|---|
| S0–S4 | 自动（模型连续推进，失败自愈） | 判定可程序化，失败可重试 |
| S5 | 自动执行 + 人工"接线就绪"确认 | 硬件状态不可观测 |
| S6 | 人工确认 | 不可逆、面向外部 |
| S7 | 自动 | 纯写作 |

"自动流转"不是"无限重试"：每个阶段带重试上限（默认 3 次）与预算（wall-clock），超限即 `blocked` 并交人。

---

## 7. 能力落点：StarMind 的哪个零件放在哪里

### 7.1 Skill：把"经验"写成可加载的说明书

StarMind 的 skill 是**目录 bundle + `SKILL.md`**，YAML frontmatter 必填 `name`（kebab-case）与 `description`，可选 `whenToUse`、`user-invocable`、`disable-model-invocation`。

发现根（按 rank）：

| rank | 来源 | 路径 |
|---|---|---|
| 100 | project-dsh | `<项目根>/.dsh/skills` |
| 200 | project-agents | `<项目根>/.agents/skills` |
| 300 | custom | 配置项 `customSkillDirs` |
| 400 | user-dsh | `<DSH_HOME>/skills` |
| 500 | user-agents | `<AGENTS_HOME>/skills` |

**只发现一层**：`<root>/<name>/SKILL.md` 或 `<root>/<name>.md`，嵌套不认。磁盘增删无需重启即可生效（会话目录有缓存，切换预设/操作插件页/重连后刷新）。

**公司级推荐的落法**：一个共享目录 `\\fileserver\dsh\skills`（或每台机器 `~/.dsh/skills` 由部署脚本同步），通过 `customSkillDirs` 指过去。项目特有的（分支约定、模块清单）留在 `<repo>/.dsh/skills`。

Skill 清单（建议 6 个，不要更多）：

| skill | 作用 | 关键内容 |
|---|---|---|
| `qt-dev-core` | 公共底座 | 三种环境姿态怎么选、`devgate` 用法、退出码语义、证据去哪看 |
| `adt-env` | ADT 环境事实 | 构建目标名、背景包名、Qt 路径、标准启动参数 |
| `cpd-env` | CPD 环境事实 | 同上，CPD 版 |
| `qt-gui-verify` | GUI 验证 | Xvfb、截图、控件断言、基线更新流程 |
| `bench-integration` | 上下位机联调 | 协议、时序断言、失败分类（设备侧/上位机侧） |
| `release-pack` | 打包交付 | 版本号规则、产物清单、审批话术 |

`SKILL.md` 骨架（以 `adt-env` 为例）：

```markdown
---
name: adt-env
description: ADT 产品线的构建、背景包与启动参数事实。当任务涉及 ADT 代码的编译、启动、联调或环境诊断时加载。
whenToUse: 用户提到 ADT、adt_app、ADT 背景包，或需要在 ADT 工作区执行 devgate 时
user-invocable: true
---

# ADT 环境事实

## 机器选择
- 编译/单测：`rw_machines(environment="build", tags="line:adt")` → 取第一台
- GUI 冒烟：`environment="qa"`
- 联调：`environment="bench"`（必须人工确认接线后才允许 S5）

## 固定路径
| 项 | 路径 |
|---|---|
| 工作区 | `/opt/ws/adt/adt-main` |
| Qt | `/opt/Qt/5.15.2/gcc_64` |
| 构建目录 | `build/`（Ninja） |
| 背景包缓存 | `/opt/bgpack/adt/<version>` |
| 产出根 | `/opt/qtqa/adt/<commit>/` |

## 必做前置
1. `devgate env-check --line adt --json`：`status != pass` 时**停止**，按 `status` 分支（env-error 不改代码）。
2. 背景包版本以仓库内 `bgpack.lock.json` 为准，**绝不允许手工指定其它版本**。

## 启动参数
- 标准启动：`./build/adt_app --config /opt/qtqa/adt/ci.conf --no-splash`
- 参数含义见 `docs/adt/launch.md`（若不存在，向用户确认，不要猜）

## 禁止
- 不要在 `build/` 之外手工放 `.so`
- 不要 `sudo artget`，不要改 `/opt/bgpack` 权限
- 不要在没有通过 `verify` 门时执行 `package`
```

> 每条 skill 都要写"**不要做什么**"。这是从 opencode 迁移时最容易被删掉、也最值钱的部分。

### 7.2 内部插件包：把"工具"变成一等公民

什么时候值得写插件：需要一个**带结构化的工具**（入参/返回值有 schema）、需要**权限策略按工具区分**、需要**客户端 UI**（面板、按钮、卡片）。

```jsonc
// package.json
{
  "name": "@corp/dsh-qt-dev",
  "version": "0.3.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./package.json": "./package.json", "./cordis.patch.yml": "./cordis.patch.yml" },
  "dsh": {
    "engines": { "dsh": ">=0.2.2 <0.4.0" },
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

工具面（**薄封装，逻辑仍在 `devgate`**，避免两处真相）：

| 工具 | 入参 | 出参 | 备注 |
|---|---|---|---|
| `qt_env_check` | `line` | 结构化 env 报告 | 只读 |
| `qt_bgpack_ensure` | `line`, `version?` | 安装后的版本 + sha256 | 写 `/opt/bgpack`，需审批 |
| `qt_stage_run` | `line`, `stage`, `workspace` | `devgate` 的 JSON | 主力工具 |
| `qt_gui_shot` | `line`, `commit`, `baseline?` | 截图路径 + 差异分 | 返回可 `present` 的图片 |
| `qt_bench_probe` | `line`, `device`, `sequence` | 断言结果 | 仅 bench 环境可用 |
| `qt_pack` | `line`, `commit`, `version` | 产物清单 | 需人工确认 |

> **P0 阶段不要写插件**。先用 `rw_exec` 调 `devgate` 跑通全链路，再决定哪些值得封成工具。过早写插件会让骨架绑死在第一个版本的假设上。

### 7.3 LangGraph：不搬，包起来

**决策：LangGraph 保留在 Python 侧，通过 MCP 暴露给 StarMind。**

理由：图状态、人工暂停、重试与超时是它的强项；StarMind 的强项是读代码、改代码、跨机器操作与解释。把图搬进来，等于用会话历史当状态机，**不可恢复、不可审计**。

```yaml
# 装进 desktop profile 的 cordis.patch.yml
- id: mcp-cpdflow
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: cpdflow
    transport: stdio            # 或 streamable-http
    command: /opt/cpdflow/bin/cpdflow-mcp
    args: ['--graph', 'cpd-dev']
    toolCallTimeoutMs: 600000   # 图可能等人工
    failOnStartupError: false   # 图挂了不影响本地开发
```

模型看到的是 `mcp__cpdflow__*`（例如 `mcp__cpdflow__next_stage` / `mcp__cpdflow__approve` / `mcp__cpdflow__state`）。

**接口设计要点**：MCP 侧只暴露"查询状态 / 推进 / 提交结论 / 等人批准"四类操作；**不要把整个图变成一堆细碎工具**，否则模型会在节点间迷路。图的每个节点在需要干活时，反过来调 `devgate` 或让 StarMind 干活——两边通过 receipt 文件交换事实，而不是通过对话。

反向通道（可选）：如果某些批处理希望 LangGraph **主动驱动** StarMind，用 ACP：在 Linux 上 `dsh --profile acp`，LangGraph 作为客户端创建会话、发任务、收事件。这条通道的定位是"CI 式的无人值守"，不用于交互式开发。

### 7.4 `AGENTS.md`：仓库级规矩

`dsh-agent-instructions` 默认加载 `$DSH_HOME/AGENTS.md` → `~/.agents/AGENTS.md` → 项目根到 cwd 的每一级 `AGENTS.md`（还有 `CLAUDE.md`、`*.local.md` 叠加层）。内容去重、按字节预算裁剪。

建议每个仓库根放一份**短**的（≤ 60 行）：

```markdown
# AGENTS.md（ADT 主仓）

## 构建与验证
- 所有构建/测试/启动一律通过 `devgate <stage>`，不要手写 cmake/ninja 命令。
- 门的退出码 3 = 环境问题：先 `devgate env-check`，不要改代码。

## 代码约定
- 新增 Qt 界面：不要引入新的第三方依赖，背景包不会带。
- 上下位机协议改动必须同步 `protocol/` 下的版本号，并在 PR 里说明兼容性。

## 禁止
- 禁止修改 `bgpack.lock.json`（由发布脚本更新）。
- 禁止把 `/opt/bgpack` 下的任何文件复制进仓库。
- 禁止在未通过 `verify` 门时提交 `git push --force`。
```

**注意边界**：仓库内容视为不可信输入（别人 PR 里的注释也可能是提示注入）。`AGENTS.md` 能约束行为，但**不能**当作安全边界。

### 7.5 配置样例（几条真正要动的行）

```yaml
# ~/.dsh-beta/profiles/desktop/cordis.patch.yml（团队共享片段）

# 1) 共享 skill 目录（公司级）
- id: skill-filesystem
  config:
    customSkillDirs:
      - '\\\\fileserver\\dsh\\skills'
      - 'C:\\ProgramData\\corp-dsh\\skills'   # 离线兜底

# 2) 远程工作区默认参数（超时适合 Qt 大仓编译）
- id: dsh-remote
  config:
    commandTimeoutMs: 120000
    connectTimeoutMs: 15000
    maxOutputChars: 400000
    auditLog: true
    hostKeyMode: accept-new
    localTools: bootstrap
    remoteSandbox: inherit

# 3) CPD 工作流（LangGraph）
- id: mcp-cpdflow
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: cpdflow
    transport: stdio
    command: /opt/cpdflow/bin/cpdflow-mcp
```

> 具体 id 以实际组合为准，改完重启客户端生效；`desktop` profile 由应用持有，请通过侧栏「插件」页或安装目录自带的命令运行时操作。

---

## 8. 会话与角色分工

**一次开发任务 = 一个会话**（会话标题写工单号，便于日后检索与统计）。

| 角色 | 由谁承担 | 职责 | 上下文 |
|---|---|---|---|
| **主导** | 主会话（默认模型） | 读需求、选环境、推进阶段、写报告 | 全程上下文 |
| **定位** | `subagent`（可换更强模型） | 长日志分析、编译错误归因 | 只吃日志 + 相关文件，不吃全程 |
| **并行改** | `subagent`（多个） | 多模块并行修改、ADT/CPD 双矩阵 | 各自独立，互不污染 |
| **复核** | `subagent_fork`（继承上下文） | 改完自审、写 PR 描述 | 带上文，省去重述 |
| **看守** | 定时任务 | 夜间回归、周报 | 到点投递回原会话 |

用法要点：

- 日志有几十 MB 时**不要**丢进主上下文。用子 agent + `grep`/`devgate` 的 `evidence` 路径，只回结论。
- 需要"扇出"（N 个模块 × 2 条产品线）时用 `workflow` 脚本（`pipeline`/`parallel`/`phase`），别在一个会话里串行做。
- 长任务（整夜回归、等硬件）用**定时任务**：到点把"跑回归"这条指令投递回原会话继续跑，人不用开着窗口。注意：**子 agent 会话不能创建提醒**，提醒只能由主会话建。
- 长目标（一个迭代的收尾）用 `/goal` 之类的目标机制，避免上下文漂移。

---

## 9. 双引擎问题：StarMind 编排 vs LangGraph

这是本方案唯一需要"拍板"的架构问题。三个选项：

| 选项 | 形态 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **① 纯会话编排** | 模型读 skill，依次调 `devgate` | 零额外服务；最灵活；当天能用 | 稳定性依赖模型；不可复算；换模型行为变 | P0 用它跑通 |
| **② 外部状态机（MCP）** | LangGraph 管阶段与人工闸口，StarMind 干活 | 状态可恢复、可审计、可暂停数天 | 要多维护一个服务；两边状态易不一致 | **P1 采用** |
| **③ 内置编排插件** | 把 stage 状态机写成 Host 插件 | 最贴产品；UI 可控 | 开发成本最高；与框架版本耦合 | P2 视需要 |

**推荐组合**：`devgate`（确定性）+ skill（知识）+ MCP 图（流程）+ 会话/子 agent（执行）。四条腿各管一件事，任何一条坏了都能降级。

判定标准：**这个阶段会不会"停在等人"超过 10 分钟，或者需要跨天恢复？** 会 → 进图（②）；不会 → 留在会话（①）。

---

## 10. 审批、权限与安全

### 10.1 权限预设（按角色）

StarMind 的权限选择器把"沙箱模式 + 审批策略"打包成一个下拉：**只读 / 工作区写入 / 完全访问 / 自动审查**。

| 角色 | 预设 | 说明 |
|---|---|---|
| 开发者（自己机器） | 工作区写入 | 超时改文件需审批 |
| 测试/联调 | 工作区写入 | 每次远程命令都弹审批更安全，但会打断自动化——折中：只审批 `bench` 机器 |
| 发布 | 只读 + 审批 | 打包写成单独工具，单独授权 |
| CI（headless） | `--permission-mode workspace-write --approval-policy never` | 无人在场，必须确定性拒绝而不是挂起 |

### 10.2 必须人审的动作清单

| 动作 | 为什么 | 机制 |
|---|---|---|
| `git push --force`、改主分支保护 | 不可逆、影响他人 | 审批 + 分支保护 |
| 背景包版本切换 | 全体环境同步变更 | 审批 + `bgpack.lock.json` 走 PR |
| 下位机烧写 / 固件升级 | 可能变砖 | 硬闸口：独立工具，仅 `bench` 环境 + 人工确认 |
| 发布打包 | 面向外部 | 审批 |
| 修改 `/opt/bgpack` 权限或内容 | 破坏全校环境 | 禁止；工具层拦截 |

### 10.3 安全边界（务必写进评审结论）

1. **凭据不落地**：SSH 密码进系统密钥库（`dsh-remote` 默认 `credentialFallback: refuse`，写不进密钥库就拒绝保存，绝不写明文 `machines.json`）；artget 账号用环境变量或机器侧配置，**不进 skill、不进 `AGENTS.md`、不进工作区**。
2. **沙箱是遏制不是边界**：`remoteSandbox: inherit` 只能把远端写入围在 workspace 根内；真正的隔离要在 Linux 侧做（专用账号、只读挂载、容器）。
3. **审计**：`auditLog: true`，命令追加到 `$DSH_HOME/remote-workspaces/audit.log`，按周归档。
4. **模型通道**：内网能否访问模型 API 必须先确认。不能 → 放行域名 / 内网网关 / 私有部署端点三选一。**同时确认代码出内网的合规口径**，必要时对 `devgate` 日志做脱敏。
5. **主机指纹**：生产/测试机用 `hostKeyMode: verify`，别图省事用 `off`。

---

## 11. CI 与"同一条流程两种跑法"

这是本方案最省成本的一点：**人跑和机器跑用同一套 skill、同一套 `devgate`**。

```bash
# 在 Linux 构建机上（CI 步骤）
dsh --profile headless \
    --permission-mode workspace-write --approval-policy never \
    --json - <<'EOF' > run.jsonl
按 adt-env 与 qt-dev-core 的约定，对 /opt/ws/adt/adt-main 跑 S0→S4，
全部通过后输出一句结论，并把截图路径列出来。
EOF
```

- 退出码 0 = 完成；1 = 中止/出错 → 直接当 CI 失败。
- `--json` 给按行事件流，CI 可抽取进度；`--session-id` 可续跑（例如"上次失败在第 3 阶段，接着修"）。
- headless **不开端口、跑完退出**，适合流水线；它默认不读 GUI 保存的凭据，需要时按文档恢复或用环境变量 / `.env`。

**推论**：只要 `devgate` 写对了，"AI 跑"和"人手跑"和"Jenkins 跑"结果完全一致。这是把 AI 引入生产流程时最需要的可回退性。

---

## 12. 落地路线

### P0（第 1 周）· 证明链路 —— 目标：一个人、一台机器、一条命令

| 任务 | 产出 | 验收 |
|---|---|---|
| 1. 连测试机 | 机器注册表里有一台 `build` + 一台 `qa` | `rw_exec` 能跑 `uname -a` |
| 2. 反向写 `env.json` | 手工跑通 `artget` → 落 `/opt/bgpack` | 能列出已装版本 |
| 3. `devgate` 只做 3 个阶段 | `env-check` / `build` / `gui-smoke` | 三个段都能返回 JSON |
| 4. 一个 skill | `qt-dev-core` | 会话里说"跑一下 ADT 构建"，模型能正确调 `devgate` |
| 5. 端到端 | 从 git clone 到看见截图 | **≤ 30 分钟，人工步骤 ≤ 3** |

> P0 的 `devgate` 允许粗糙（bash + jq 都行），但**JSON 契约必须先定死**。

### P1（第 2–3 周）· ADT 全流程 + CPD 复制

| 任务 | 说明 |
|---|---|
| 补齐 S3/S6/S7 | 单测、打包、报告 |
| `adt-env` / `cpd-env` / `qt-gui-verify` skill | 从 opencode 迁移正文，补"禁止事项" |
| 内部插件包 `@corp/dsh-qt-dev` v0.1 | 只封 4 个高频工具（见 7.2） |
| 共享 skill 目录 + 部署脚本 | 30 台机器一次装齐，版本可回滚 |
| 夜间回归 | 一条定时任务 + 一个汇总报告 |
| 基线截图入库 | GUI 差异比对才有意义 |

验收：**一名没参与开发的同事，照 README 独立完成一次"改文案 → 出截图 → 打包"**，全程只问一次问题。

### P2（第 4–6 周）· 编排与治理

| 任务 | 说明 |
|---|---|
| LangGraph → MCP | 四类操作接口，替代人肉传话 |
| 护栏插件 | 在工具执行前校验：无 `verify` 门凭证 → 拒绝 `push`/`pack` |
| CI 接入 | headless + `devgate`，与人工流程同源 |
| 度量看板 | 阶段通过率、平均循环时长、人工介入次数 |
| 多环境扩面 | bench、release 机器入矩阵；权限分角色 |

### 人力粗估

| 角色 | P0 | P1 | P2 |
|---|---|---|---|
| 平台/DevOps（`devgate`、机器、CI） | 3 人日 | 5 人日 | 5 人日 |
| AI 工程（skill、插件、MCP） | 1 人日 | 5 人日 | 5 人日 |
| 产品线对接（ADT/CPD 各自的环境事实） | 各 1 人日 | 各 3 人日 | 各 2 人日 |

---

## 13. 度量（只留 5 个，别搞仪表盘）

| 指标 | 定义 | 目标 |
|---|---|---|
| **人工介入次数 / 次迭代** | 一次"改代码到出可交付物"中间需要人回的次数 | ≤ 1（P1）→ ≤ 0.5（P2） |
| **首屏时间** | 改完代码到看见本次 GUI 截图 | ≤ 5 分钟（增量构建） |
| **环境类失败占比** | `devgate` 返回 3 的次数 / 总运行次数 | ≤ 20%，且每次都有明确下一步 |
| **门凭证命中率** | 发布时所有门的 commit 与 HEAD 一致的比例 | 100% |
| **新人上手时间** | 从拿到项目到独立跑通 P1 场景 | ≤ 1 天 |

采集方式：`devgate` receipt + 会话日志；用一条定时任务每周一早上汇总。

---

## 14. 风险登记册

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **模型通道不通**（内网） | 全案不成立 | P0 第一件事就验；准备私有部署端点 |
| R2 | **`artget` 行为不明**（缓存/校验/并发） | 环境不可复算 | 先摸清再写 `devgate`；锁文件 + sha256 兜底 |
| R3 | **GUI 自动化脆弱**（Qt 控件、无头渲染差异） | S4 误报/漏报 | 只断言"关键控件可见 + 进程存活 + 无 crash 日志"，不做像素级全量比对 |
| R4 | **Qt 大仓 `rw_sync` 超限** | 镜像不全 | 单仓镜像 + 排除 `build/`、`/opt/bgpack`；必要时改走姿态 C |
| R5 | **双写冲突**（两端同时改同一文件） | 代码丢失 | `rw_sync`/`rw_push` 三方比对，冲突不覆盖；主线永远走 git |
| R6 | **模型误判"过了"** | 假绿 | 门只看脚本结论；模型无权改门结果 |
| R7 | **客户端 beta 漂移**（插件 ABI、profile 变化） | 某天全线不可用 | 内部包锁 `engines.dsh`；保留"纯 `devgate` + 人工"降级路径 |
| R8 | **凭据泄露** | 安全事故 | 密钥库 + 禁写工作区 + 审计 |
| R9 | **`desktop` profile 被 CLI 拒绝管理** | 自动化装插件失败 | 走侧栏插件页或安装目录自带命令运行时 |
| R10 | **子 agent 不能建定时任务** | 夜间任务设计落空 | 定时任务只由主会话创建 |

---

## 15. 待你确认的 6 个问题

1. **`artget` 的确切契约**：命令格式、版本号来源、落地路径、是否支持离线包、并发/锁行为？（你后续提供）
2. **模型通道**：内网客户端能否访问 `api.deepseek.com`？还是需要网关/私有部署？
3. **构建系统细节**：CMake 最低版本、生成器（Ninja/Make）、Qt 版本与模块清单、是否存在预编译头/单元测试框架（`ctest` 是否已有）？
4. **GUI 冒烟的现状**：现在人工是怎么验界面的？有没有关键路径清单？能不能接受"无头 + 截图"作为准入门？
5. **上下位机协议**：串口/telnet/自定义？有没有现成的联调脚本可以给 `devgate` 调用？
6. **发布流程**：打包是谁执行、产物放哪、有没有签名与版本号规范？

---

## 附录 A：目录树全貌

```
公司内网
├── fileserver/dsh/skills/              ← 团队共享 skill（customSkillDirs 指向）
│   ├── qt-dev-core/SKILL.md
│   ├── adt-env/SKILL.md
│   ├── cpd-env/SKILL.md
│   ├── qt-gui-verify/SKILL.md
│   ├── bench-integration/SKILL.md
│   └── release-pack/SKILL.md
├── npm-registry/@corp/dsh-qt-dev/      ← 内部插件包（可选，P1）
├── git/adt/adt-main/
│   ├── AGENTS.md
│   ├── bgpack.lock.json                ← 背景包版本锁（PR 更新）
│   ├── .devstate/                      ← 门凭证（gitignore）
│   └── .dsh/skills/adt-module-map/     ← 项目特有 skill
└── git/cpd/cpd-main/（同上）

Linux 构建/测试机
├── /opt/devgate/
│   ├── bin/devgate
│   ├── env.json
│   └── stages/{env-check,build,verify,gui-smoke,bench,package,handoff}.sh
├── /opt/bgpack/adt/<version>/
├── /opt/ws/adt/adt-main/
└── /opt/qtqa/adt/<commit>/{build.log,tests.xml,shots/,report.md}
```

## 附录 B：opencode → StarMind 迁移对照

| opencode | StarMind | 迁移动作 |
|---|---|---|
| `SKILL.md`（ADT/CPD） | 相同格式 | 复制 + 补 `whenToUse` + 补"禁止事项" + 把 `bash` 改成 `pwsh`/`rw_exec` |
| subagent 定义 | `subagent` / `subagent_fork` | 提示词直接搬；工具白名单改为权限预设 |
| langgraph 图 | MCP server | 加一层薄适配（四类操作），不改图 |
| 自定义命令/脚本 | `devgate` CLI | 合并去重，统一 JSON 契约与退出码 |
| 项目规则文件 | `AGENTS.md` | 搬过来，压到 60 行内 |
| 手工 `artget` | `qt_bgpack_ensure` + 锁文件 | 加版本与校验，禁止手选版本 |

## 附录 C：一页速查

```bash
# 环境（在 Linux 上）
devgate env-check --line adt --json
devgate build     --line adt --workspace /opt/ws/adt/adt-main --json
devgate gui-smoke --line adt --workspace /opt/ws/adt/adt-main --json

# 自检（Windows 侧）
# 1. 连机器   rw_machines(environment="build", tags="line:adt") → rw_connect(machineId=…)
# 2. 选工作区 rw_pick_workspace("/opt/ws/adt/adt-main")
# 3. 跑阶段   会话里说"跑 S0–S4"，或直接 rw_exec("devgate build --line adt --json")

# CI（无人值守）
dsh --profile headless --permission-mode workspace-write --approval-policy never --json - < task.txt > run.jsonl

# 远程整机界面（Linux 写码 / 长值守）
# 设置 → 远程工作区 → 远程 DSH 界面 → 选机器 → 连接并打开
```

---

*本方案的所有 StarMind 机制描述基于本机 v0.2.2-alpha.2 安装的内置文档（`dsh-remote` 0.8.67、`dsh-skill-filesystem`、`dsh-mcp-client`、`dsh-headless`、`dsh-agent-instructions`、`dsh-permission-presets`、`dsh-schedule`）。`artget`、CMake/Qt 具体参数、下位机协议待补。*
