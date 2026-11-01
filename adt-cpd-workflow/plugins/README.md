# 插件与安装包

本目录解决一个问题：**同事装完 StarMind 之后，怎么得到和这里一模一样的能力。**

## 目录

```
plugins/
├── manifest.json      # 权威清单：包名、版本、许可证、vendor 路径、用途
└── vendor/            # 离线副本（npm 不可达时用）
    ├── dsh-remote/
    ├── dsh-mnemon/
    ├── @tt-a1i/archify-dsh/
    ├── @liustack/modlens/
    └── dsh-plugin-save-token/
```

`dsh-univer-office` 不在 `vendor/` 里——它 186.9 MB（含 Univer 运行时与 puppeteer-core），提交进仓库不划算，安装时从 npm 拉取。

## 当前安装的 6 个插件

| 插件 | 版本 | 作用 | 少了它会怎样 |
|---|---|---|---|
| `dsh-remote` | 0.8.67 | SSH 远程工作区、22 个 `rw_*` 工具、端口转发、远程 DSH 界面、审计日志 | **ADT/CPD 方案的环境层直接失效** |
| `dsh-mnemon` | 0.5.37 | 分层记忆：Documents 检索 + Memory Spaces + 每轮热记忆 | 跨会话经验不沉淀 |
| `@tt-a1i/archify-dsh` | 1.0.0 | 架构/流程/时序图的可交互 HTML 生成 | 出不了评审用的图 |
| `dsh-univer-office` | 0.3.9 | Office / 表格 / 演示 / PDF 的创建与编辑（Univer 引擎） | 做不了 PPT/Word/Excel 交付物 |
| `@liustack/modlens` | 3.27.2 | 给纯文本模型加视觉桥（图片 → 结构化证据） | 看不了截图，GUI 冒烟验证只剩文本日志 |
| `dsh-plugin-save-token` | 2.4.1 | 压缩冗长工具输出 | 上下文烧得更快，大日志吃不消 |

均为 MIT / Apache-2.0 许可，可随仓库分发；各自的 LICENSE 已在 `vendor/<包名>/` 内保留。

## 不属于「第三方插件」的部分

`manifest.json` 的 `productBundles` 列了 StarMind 发行版自带的组合层（`dsh-base`、`dsh-web-app`、`dsh-bridge-next`、`dshmarket`、`dsh-experimental-subagent-oar`）。这些随客户端提供，**不需要也不应该**由本仓库安装；其中 `dsh-experimental-subagent-oar` 是默认关闭的实验层，需要时在「设置 → 插件」里开启。

## 三种安装方式

### A. 一键脚本（推荐给新同事）

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\install-plugins.ps1

# 先看它要做什么，不动系统
powershell -ExecutionPolicy Bypass -File scripts\install-plugins.ps1 -DryRun

# 内网/npm 不可达时，用仓库里的离线副本
powershell -ExecutionPolicy Bypass -File scripts\install-plugins.ps1 -Offline
```

```bash
# Linux / macOS
./scripts/install-plugins.sh
./scripts/install-plugins.sh --offline
```

脚本做三件事：定位 DSH home → 用客户端自带的 node/pnpm 装包 → 把包登记进 `profile/package.json` 的 `dsh.profile.bundles`。

### B. 应用内插件页

StarMind 侧栏 →「插件」→ 搜索包名安装。适合只补某一个插件的时候。

### C. 手工（排障兜底）

```powershell
node <StarMind>\resources\runtime\x64\primary-runtime\dependencies\pnpm\bin\pnpm.mjs `
  add dsh-remote@0.8.67 --dir $env:USERPROFILE\.dsh-beta\profiles\desktop
```

然后确认 `profiles\desktop\package.json` 的 `dsh.profile.bundles` 里有这个包名。**顺序有意义**，按 manifest 里的排列来。

## 为什么不用「把 node_modules 整个提交」

本机 `profiles/desktop/node_modules` 是 **510 MB / 4672 个文件**（含 `dsh-univer-office`），其中绝大部分是 `.pnpm` 硬链接库和第三方依赖（zod、react、ssh2、univer…）。
真正值得提交的只有 5 个包体、**约 14 MB / 664 个文件**，本仓库提交的是后者：

- 体积可控，diff 可读
- 依赖由 pnpm 按 `package.json` 重新解析，不会把宿主机上的坏状态一起搬过去
- 例外：`dsh-remote` 声明了 `bundleDependencies`（ssh2 等），它的 `node_modules` 是**必要**的，必须保留

## 已知限制

- 这些是**第三方插件**，不是 StarMind 本体。StarMind 升级后若插件与新的 `engines.dsh` 不兼容，需要跟着升版本。
- `install-plugins.ps1` 只做过 `-DryRun` 验证（本仓库成稿时的环境已经装好这些插件），**没有在干净机器上跑过真实安装**。首次给同事用之前，请先在一台干净机器上验证并记录结果。
- `-Offline` 只解决「包体本身下载不到」，**不解决依赖**：`dsh-mnemon` 的 providers、`dsh-remote` 的 ssh2 等仍需要能解析。真正纯离线要配内网 npm registry 或预置 pnpm store。
- `modlens` 还需要本机可用它的引擎（`npx @liustack/modlens doctor` 自检），插件装上不等于视觉能力可用。
- `dsh-remote` 装上后仍是空的机器列表，需要在「设置 → 远程工作区」里逐台添加。
- `dsh-univer-office` 首次使用会拉取运行时，内网环境要确认它不依赖外网 CDN。
