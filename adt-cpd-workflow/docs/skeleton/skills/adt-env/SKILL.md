---
name: adt-env
description: ADT 产品线的构建、背景包与启动参数事实。当任务涉及 ADT 代码的编译、启动、联调或环境诊断时加载。
whenToUse: 用户提到 ADT、adt_app、ADT 背景包，或需要在 ADT 工作区执行 devgate 时
user-invocable: true
---

# ADT 环境事实

## 机器选择

| 用途 | 查询 |
|---|---|
| 编译 / 单测 | `rw_machines(environment="build", tags="line:adt")` → 取第一台 → `rw_connect(machineId=…)` |
| GUI 冒烟 | `rw_machines(environment="qa", tags="line:adt")` |
| 上下位机联调 | `rw_machines(environment="bench", tags="line:adt")` |

保存机器 ≠ 激活；只有 `rw_connect` 才进入本会话的远程上下文。

## 固定路径

| 项 | 路径 |
|---|---|
| 工作区 | `/opt/ws/adt/adt-main` |
| Qt | `/opt/Qt/5.15.2/gcc_64` |
| 构建目录 | `build/`（Ninja） |
| 背景包缓存 | `/opt/bgpack/adt/<version>`（只读，禁止手工整目录改动） |
| 产出根 | `/opt/qtqa/adt/<commit>/` |

## 阶段推进

所有阶段一律通过 `devgate`，不要手写 cmake/ninja：

```bash
devgate env-check --line adt --workspace /opt/ws/adt/adt-main --json
devgate build     --line adt --workspace /opt/ws/adt/adt-main --json
devgate gui-smoke --line adt --workspace /opt/ws/adt/adt-main --json
```

退出码语义（务必遵守）：

| 码 | 含义 | 你的动作 |
|---|---|---|
| 0 | pass | 进入 `next` 阶段 |
| 1 | fail | 读 `evidence` 里的日志定位、改代码、重跑本阶段 |
| 2 | blocked | `ask_user_question`，不要自行绕过 |
| 3 | env-error | 修环境或换机器；**不要改代码** |

## 启动参数

- 标准启动：`./build/adt_app --config /opt/qtqa/adt/ci.conf --no-splash`
- 参数含义见 `docs/adt/launch.md`；该文件不存在时向用户确认，**不要猜测参数**。

## 禁止

- 不要在 `build/` 之外手工放置 `.so` 或修改 `LD_LIBRARY_PATH` 去"绕过"链接错误。
- 不要 `sudo artget`，不要修改 `/opt/bgpack` 的权限或内容。
- 不要修改仓库内的 `bgpack.lock.json`（由发布脚本维护）。
- 不要在未通过 `verify` 门时执行 `package` 或 `git push`。
- 不要在没有人工确认接线的情况下执行 `bench` 阶段（会向真实设备发命令）。
