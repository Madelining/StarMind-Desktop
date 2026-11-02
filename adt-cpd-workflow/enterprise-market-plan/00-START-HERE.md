# 从这里开始：公司本地 Agent 实施包

日期：2026-11-03。代码基线：`feat/adt-cpd-workflow-plan` 的 `5d8fad25d136de2371c39f87a6013ffe441e3105`。

本包的目标是让公司本地 Agent 按已经确定的设计实施企业插件市场。产品路线固定为官方 Discover + 官方 format 1 + 官方 pluginManager；首版增加内网发布与分发能力，不重写插件市场页面或安装器。

## 交付状态

| 内容 | 当前状态 |
|---|---|
| 文件级详设、执行任务卡、合同和验收矩阵 | 已提供 |
| 零 npm 依赖的测试制品生成器和本机只读测试市场 | 已提供，随附 7 项工具测试已通过 |
| 真实插件 tgz，含传递依赖、升级和故意加载失败版本 | 可由工具在离线环境生成 |
| 生产 `enterprise-market/` 服务及 StarMind 客户端改造 | 待按 C00–C09 实施 |
| 公司机器上的真实 DSH 安装、加载、更新、恢复验证 | 尚未执行，C01/C08 必做 |
| 整仓开发环境与全部历史依赖的离线构建缓存 | 本包未打包；C00 核对公司现有材料并列出缺失项 |

不要把测试市场工具当成已经完成的生产功能，也不要把 `verification.json` 的 `not-run` 修改为 `passed` 来代替验收。

## 阅读与使用顺序

1. 读仓库根 `AGENTS.md`，保留当前工具链、变体边界和 pinned upstream。
2. 读 [01-design.md](01-design.md)：架构决定、边界与统一约定。
3. 根据任务读 [02-client.md](02-client.md)、[03-server-offline.md](03-server-offline.md)。
4. 使用 [04-task-cards.md](04-task-cards.md) 的总提示词，从 C00 开始，每次实施一张卡。
5. 按 [05-acceptance.md](05-acceptance.md) 交付实际证据。
6. 按 [06-offline-materials.md](06-offline-materials.md) 核对本包已附带和仍需准备的离线材料。

`contracts/contracts.ts` 是本设计的数据合同，不是已接入客户端的代码；实现时放到各组件自己的边界校验模块。`examples/` 的 `.example` 域名和磁盘路径需要改成公司实际值。

## 第一轮直接发给本地 Agent

```text
请实施 StarMind 企业插件市场。
先读 AGENTS.md 和 adt-cpd-workflow/enterprise-market-plan/00-START-HERE.md，
再读 01-design.md、04-task-cards.md、05-acceptance.md。
本轮只执行 C00，按白名单记录代码基线、目标环境、工具版本及离线材料。
不要修改源码、更新依赖、刷新 latest 或访问公网。
完成后给出真实检查结果，更新 enterprise-market/work/progress.json；
缺少材料就生成 missing-artifacts.json，不用假数据或替代版本继续。
```

以后发送“继续企业插件市场实施，按 progress.json 执行下一张满足前置条件的任务卡”，不需要重复描述整个需求。C01 不通过，不能把后续正式集成当成已完成。

## 自带工具怎样使用

在仓库根目录执行：

```powershell
node --test adt-cpd-workflow/enterprise-market-plan/tools/fixtures.test.mjs
node adt-cpd-workflow/enterprise-market-plan/tools/create-fixtures.mjs --output enterprise-market/work/fixture-release --origin http://127.0.0.1:18765
node adt-cpd-workflow/enterprise-market-plan/tools/serve-fixtures.mjs --release enterprise-market/work/fixture-release --port 18765
```

工具要求 Node `^22.19.0` 或 `>=24.0.0`；本次实际运行版本为 Node `24.14.1`。没有新增需要公司 npm 镜像提供的第三方包。测试服务只绑定 `127.0.0.1`，Ctrl+C 停止，具体故障注入见 [tools/README.md](tools/README.md)。

## 如何判断本地 Agent 做对了

每张任务卡必须交付修改文件、实际命令、退出码、关键断言、证据位置和未验证事项。仅生成代码、返回 HTTP 200、mock 测试通过或 `pnpm add` 成功，都不能证明插件已经加载并可用。

首版支持矩阵先固定到公司实际的一套 Windows x64 / Beta 运行时；其他版本只有通过同样验收才能声明支持。准备工具能运行的系统不等于插件运行目标已被认证。

发生未规定的架构选择、缺少服务接口或需要新依赖时，本地 Agent 应报告具体缺项与最小修改建议。它不应自行更换市场协议、写第二个安装器或替公司选择新的大型框架。
