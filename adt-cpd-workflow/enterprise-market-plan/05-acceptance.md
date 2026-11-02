# 验收与证据要求

## 当前实际验证范围

2026-11-03，在 Node 24.14.1 下执行 `node --test adt-cpd-workflow/enterprise-market-plan/tools/fixtures.test.mjs`，7 项通过。覆盖：真实 tgz 的 tar 头与包身份/依赖、SHA 校验、确定性及拒绝覆盖、descriptor/index 快照绑定、scoped npm 路由与确切版本下载、只读与 Host 限制、下载失败注入、内容变更拒绝。

这不是生产服务验收；没有在本次工作中运行真实 DSH Host、公司 Profile 或安装版。C01/C08 的实际结果待公司 Agent 执行。示例 verification.json 中 status:not-run 是正确初态。

## 1. 验收环境

- 独立测试用户或隔离虚拟机，使用临时 DSH_HOME 和专用包缓存，不动员工日常 Profile。
- 记录 StarMind、DSH、Host Node、pnpm、Yarn、系统、架构、快照 ID、目标 Origin 和根 package/lock 摘要。
- 冷缓存必须是新建的专用 store/cache，不是打包机已经装过的普通缓存。
- 禁止公网 DNS 和公网直连，保留测试内网 Origin；通过实际网络观测、请求记录或可复核的隔离环境证明。只看应用日志里没写公网 URL 不足以证明没有请求。
- Host 子进程、pnpm、安装脚本和必要的插件运行资源均纳入验证；不能只监控 Renderer。

## 2. 功能与故障矩阵

| ID | 场景 | 必须断言 |
|---|---|---|
| A01 | 首次企业启动 | 自动选择公司索引和认证快照，三个公共市场不被默认启动 |
| A02 | 正常浏览 | 中文标题、描述、图标、精确版本、兼容信息均来自内网 |
| A03 | 插件 1.0.0 冷安装 | 真实管理器成功，helper 1.0.0 存在，bundle 实际加载 |
| A04 | 更新到 1.1.0 | 精确版本与 helper 1.1.0 正确，启用状态和实际加载正确 |
| A05 | 停用、启用、卸载 | 管理器事实与界面一致；卸载后无活跃 bundle，不误删其他插件 |
| A06 | tarball 故障 | 元数据可读、下载返回503；旧版保留/恢复结果有实际证据 |
| A07 | apply 故意抛错 | 用真实加载 Host 触发；清楚报告加载失败，不写成安装可用 |
| A08 | registry 缺依赖 | 返回可定位的包名和版本，不回退公网、不静默改版本 |
| A09 | 公司镜像缺包 | 完整导入的快照可以独立完成已认证安装 |
| A10 | 平台/Node/DSH不匹配 | 新包操作在变更 Profile 前拒绝；本地已安装插件仍可管理 |
| A11 | 市场不可达 | StarMind 可启动，缓存时间与错误清楚；不会切公共源 |
| A12 | 错误证书、外部重定向 | 拒绝；正确企业 CA 在 Host 和 pnpm 都生效 |
| A13 | imported但未publish | 固定快照可用于管理员冷验，stable仍指向旧版本 |
| A14 | publish中断/并发 | 读到完整旧指针或完整新指针，没有半写 JSON |
| A15 | 文件损坏、同版本不同内容 | import失败，stable保持不变，错误含文件/包定位 |
| A16 | scoped package、多个依赖版本 | npm请求可解析，原tgz完整性不变，pnpm实际依赖满足目标 |
| A17 | 旧Profile含公网lock/Git | 预检明确拒绝并给出迁移或新Profile路径，不静默删锁 |
| A18 | 发布新快照 | 运行中Host仍用旧快照；下次明确刷新才采用新快照 |
| A19 | 撤下stable | 旧快照与制品仍可读取，已有lock和恢复路径不被破坏 |
| A20 | 官方已安装页、Discover、CLI入口 | 逐一确认实际registry、版本来源与企业边界；未接通入口不算完成 |
| A21 | 首批插件集合共存 | 对声明支持的每个认证组合做冷安装与加载；未知组合不虚报 |
| A22 | 日志/配置输出 | 不包含凭据或员工完整Profile，诊断足够定位快照和操作 |
| A23 | 企业配置损坏 | 不退回personal后联网；显示市场修复原因，其他可用功能可启动 |
| A24 | 离线构建与交付 | 固定现有制品构建，无latest刷新；缺失材料有清单 |

## 3. 每次验证的记录

证据目录：`enterprise-market/work/evidence/<runId>/`。可提交摘要复制到本详设包的 `evidence/`，不得提交真实员工信息。

```text
environment.json      实际版本、平台、Origin、基线和快照
commands.json         命令、cwd、退出码、开始/结束时间
assertions.json       对应A01-A24与C01-C09的逐条结果
network-summary.json  所访问主机与被阻止请求，说明观测方式
manager-results.json  实际管理器结果，保留application/outcome/error
profile-before.json   脱敏的根依赖和bundle选择摘要
profile-after.json    同上；不是员工完整配置
artifact-digests.json 制品、lock及关键证据的摘要
limitations.md        未运行、未覆盖、失败和支持矩阵限制
```

不能用截屏代替实际 package/lock/bundle 断言；也不能只靠断言文件自报通过。验证脚本应在断言失败时返回非零退出码。

## 4. 发布门槛

结构验证通过后可以 import；import 不进入 stable。使用最终服务 Origin 的固定快照完成目标冷验，再生成独立 verification report。报告必须引用同一 snapshotId、Origin、宿主基线和实际证据摘要；所有 requiredCaseIds 为 passed 才能 publish。

报告中的 requiredCaseIds 由准备工具针对本快照产生；生成测试报告和服务端写一个 passed 字符串都不能代替认证。服务端只验证报告结构、绑定和证据文件存在/摘要，管理员对验收真实性负责。V1 没有远程可信执行或硬件证明功能。

## 5. 仓库检查

服务代码用 Node 内置测试器；Beta/Stable 客户端按变体要求执行受影响测试、typecheck 和 check:desktop-variants。完整检查见根 AGENTS.md；在公司运行前，先确认相关入口没有公网刷新步骤。

不要修改仓库门禁来掩盖失败。内网构建需要显式固定制品入口，应保留非企业发布的既有新鲜度规则，并对离线入口的固定版本/摘要校验做验证。

最终交付报告逐项标记 passed、failed、blocked、not-run。只有全部首版必需场景通过，才可以对外描述“企业市场已实现”；未通过的插件或平台不出现在已支持清单中。
