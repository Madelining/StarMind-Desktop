# StarMind-Desktop

把公司 ADT / CPD 的 **开发 · 测试 · 运行** 流程，重新组织成可在 StarMind 客户端里一站式完成的工作流；并把支撑这套工作流的插件环境固定下来，让每个同事装完客户端就能直接开工。

> 现状：设计方案已定稿，门禁骨架与插件清单已落地，`artget` 与具体构建参数待补。详见下方「状态」。

## 这个仓库里有什么

| 目录 | 内容 |
|---|---|
| [`docs/`](docs/) | 设计方案全文、评审用 PPT、可运行的 `devgate` 门禁骨架、示例 `SKILL.md` 与 `bgpack.lock.json` |
| [`discussion/`](discussion/) | 完整对话记录（方案是怎么一步步定下来的，含每次工具调用的入参与结果） |
| [`plugins/`](plugins/) | 当前环境已装插件清单 `manifest.json`、离线副本 `vendor/`、一键安装脚本说明 |
| [`scripts/`](scripts/) | 插件安装（Windows / Linux）与会话存档导出脚本 |

## 核心主张

一句话：**把确定性下沉到脚本，把判断交给模型，把跨机器交给远程工作区，把「什么时候停」交给门。**

拆开是四个判断：

1. **执行环境三态**——Windows 写码用远程镜像会话；Linux 写码用远程整机界面（SSH 隧道，不开外部端口）；偶尔看一眼用本地会话 + 远程执行。一套流程，三种姿态。
2. **确定性动作全部脚本化**——编译、跑测、起 GUI 截图、校验背景包、打包，统一走 `devgate`，输出结构化 JSON。
3. **门的结论由程序给**——`devgate` 用 4 种退出码区分「过了 / 代码问题 / 要人 / 环境问题」；模型负责修，无权改结论。
4. **LangGraph 不搬进来**——图保留在 Python 侧，通过 MCP 挂成 4 类操作（查状态 / 推进 / 提交结论 / 等人批准）。

## 快速开始

### 1. 装齐插件环境

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-plugins.ps1 -DryRun   # 先看要做什么
powershell -ExecutionPolicy Bypass -File scripts\install-plugins.ps1           # 实际安装
```

细节与离线安装方式见 [`plugins/README.md`](plugins/README.md)。

### 2. 读方案

- 想快速了解：打开 [`docs/ADT-CPD_StarMind_评审_3页.pptx`](docs/ADT-CPD_StarMind_评审_3页.pptx)（3 页，带演讲者备注）
- 要看细节：[`docs/ADT-CPD_StarMind_开发流程设计方案.md`](docs/ADT-CPD_StarMind_开发流程设计方案.md)（15 章 + 3 附录）

### 3. 试跑门禁

```bash
bash -n docs/skeleton/devgate          # 先做语法检查
cp docs/skeleton/devgate /opt/devgate/bin/devgate && chmod +x /opt/devgate/bin/devgate
devgate env-check --line adt --workspace /opt/ws/adt/adt-main --json
```

## 状态

| 项 | 状态 |
|---|---|
| 设计方案 | ✅ 定稿 v0.1（待评审） |
| 评审材料（3 页 PPT） | ✅ 已产出，含演讲者备注 |
| `devgate` 门禁骨架 | ⚠️ 三段可用（env-check / build / gui-smoke），**未在 Linux 上实测**；verify / bench / package / handoff 为占位 |
| 插件清单与安装脚本 | ⚠️ 清单准确；安装脚本**未在干净机器上端到端验证** |
| 架构图 | ✅ `docs/architecture/adt-cpd-architecture.html`——archify `finalize` 四道门全绿（validate / deliver / check / browser-check）；源文件为同名 `.candidate.json`。**视觉观感未经人眼确认**，自动检查只覆盖几何与可读性阈值 |
| `artget` 集成 | ❌ 待补（命令格式 / 版本来源 / 落地路径未定） |
| CMake / Qt 具体参数 | ❌ 待补（目标名、生成器、Qt 版本、ctest 现状） |

## 待确认（阻塞推进）

1. **内网模型通道**——客户端能否访问模型 API；不通则整案不成立。
2. **`artget` 契约**——命令格式、版本号来源、落地路径、能否离线、并发行为。
3. **CMake / Qt 细节**——最低版本、生成器、Qt 版本与模块、`ctest` 是否已有。
4. **GUI 冒烟现状**——人工怎么验界面、关键路径清单。
5. **下位机协议**——串口 / telnet / 自定义，是否有现成联调脚本。
6. **发布流程**——谁打包、产物位置、签名与版本号规范。

## 许可

本仓库自有内容（方案、脚本、门禁骨架）随项目使用。
[`plugins/vendor/`](plugins/vendor/) 下为第三方 MIT 许可插件副本，各自 LICENSE 已保留在对应目录内。
