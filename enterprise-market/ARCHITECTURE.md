# 实现与维护设计

本文件描述已经落地的企业插件市场。早期 `adt-cpd-workflow/enterprise-market-plan/` 供了解背景；实现、协议与限制以本目录、Beta / Next 代码及验收结果为准。

## 组成与边界

| 部分 | 代码 | 职责 |
| --- | --- | --- |
| 市场服务 | `src/server.mjs`、`src/store.mjs` | 发布权限、原始制品、不可变版本、目录、私有 npm 读取接口、导入导出 |
| 发布检查 | `src/archive.mjs`、`src/dependencies.mjs` | 安全读取 tgz，验证 DSH 入口与依赖包集，不执行插件 |
| 市场界面 | `public/` | 发现、详情、版本、收藏、上传、我的发布、当前 Profile 插件管理 |
| 离线准备 | `tools/prepare-offline.mjs` | 使用真实 npm 锁文件收集原始包和完整性值，生成可导入包 |
| 桌面适配 | 两个客户端的 `src/enterprise-market.ts`、`src/client/enterprise-market.tsx` | 固定企业来源、同源认证、隔离页面、管理器策略与加载适配 |
| 安装与恢复 | 官方 `pluginManager`、pnpm、Host / HMR | 组合求解、安装、Profile 状态、实际加载、失败恢复 |

市场不保存客户端的安装状态。网页“已安装”来自当前 Host 的真实管理器；独立浏览器只提供发现、发布和下载。Beta 与 Next 共享的改动必须遵守根目录 `AGENTS.md` 的镜像规则。此功能没有修改上游子模块，旧 Stable 未接入。

## 发布事务与数据

数据目录在本地磁盘，单机单写者。`state.json` 保存账号、暂存索引、发布和审计；原始包按 SHA-256 保存为 `artifacts/<sha256>.tgz`。令牌由管理员本机工具产生，只存摘要。界面登录只验证令牌，浏览器仅在内存保存它。

1. 发布者分别上传 `.tgz`。服务检查 gzip/tar 长度、路径、Windows 文件名、碰撞、链接、manifest、入口与限额，并返回主插件候选和 upload ID。
2. 发布请求指定主插件精确版本、本账号 upload IDs 和可选展示说明。
3. 在写事务中重新读取、校验制品和依赖声明，检查包名拥有者、发布版本与全局 npm name/version 的内容一致性。
4. 安全写入不可变制品，再原子替换状态。发布失败不会进入可安装目录。可能留下的无引用制品不能直接认作已发布内容。
5. 暂存文件有效期 24 小时，在启动、定时任务和上传前清理；已发布及撤回制品保留，用于锁文件与恢复。

同一 name/version 不能换字节，撤回也不能覆盖。发布者不能接管别人的包名；管理员操作保留审计。撤回移除新的目录发现与安装批准，历史 npm 元数据和原始制品继续可读。

## 目录与包来源

`/dsh-index.json` 使用官方 format 1，列出公司已发布的精确版本。客户端实际安装统一使用固定 `/npm/`，不在不同插件之间切换 release registry。原因是官方管理器和 pnpm 会校验 Profile 的仓库一致性；每次安装切到另一个 release 路径，会使多插件组合及重启后卸载失败。

全局 name/version 不可变约束使固定 npm 入口能够安全汇集依赖。`/npm/releases/:id/`、`/snapshots/:id/dsh-index.json` 用于追溯；离线包中包含原始 tgz，不重打包生产插件。元数据中的 tarball 指向本市场 `/artifacts/`，并包含原始 SHA-512 integrity。

依赖范围由随源码提供的官方 node-semver 处理，支持 SemVer 和 npm alias；要求所需 dependency、optional dependency 与必需 peer 均在发布包集中。缺省兼容范围与预编译原生模块给出提示，不冒充已经在目标环境验证。安装脚本、隐式编译、内嵌依赖、Git/URL/file/workspace 等不支持的发行方式在发布前明确拒绝。

声明齐全不等于任意插件组合都能运行。真正的组合求解与加载仍由 pnpm / Host 完成。插件运行时的模型、外部 API、浏览器与 Python 资源需要独立准备内网方案。

## 桌面连接与安装

每次 Host 启动读取一次 `DSH_HOME/enterprise-market.json`；`STARMIND_ENTERPRISE_POLICY` 可指定管理员配置。无效企业配置保持阻断状态。保存设置要求重启，不在正在安装时切换来源；普通界面编辑保留已有自定义 CA，管理员策略不能被界面覆盖。

企业模式在 Profile 合成前后过滤公共市场 bundle，覆盖官方管理器的 registry / fallback，并为包管理器固定内网 registry、隔离的用户/全局 npm 配置、脚本和证书策略。旧公网锁文件不会被自动改写：界面提供新建企业 Profile 的入口。

页面运行在独立的随机本机端口与随机路径下。代理仅转发到配置的市场 Origin，使用白名单路径、写请求标记和重定向限制，过滤 Host 凭据和上游 Cookie。它解决内网 HTTP 嵌入问题，同时保持主界面 RPC 与市场页面分属不同 Origin。

iframe 与父界面握手后使用带 request ID 的 `postMessage`。双方验证 origin 与具体窗口；修改插件前由父界面确认。父界面调用认证后的 `/api/enterprise-market/operation`。Host 再校验精确版本仍在公司批准目录中，随后调用官方管理器。直接使用官方 RPC 也受同一管理器策略约束，旧公共 README / 图片 CDN 入口在企业模式下关闭。

## 更新与失败恢复

pnpm 替换根包后，磁盘 manifest 版本改变并不证明新代码已加载。该基线的官方解析器没有跟踪 Profile 内部 pnpm 根包目录迁移；Node 对固定父位置的裸包解析可能继续指向旧物理目录。

桌面适配仅处理当前 Profile 明确声明的用户包导入：从当前 `node_modules` 找到真实物理包目录，再交给现有 Node 模块加载器处理原 specifier、exports 条件和依赖。内置模块和其他导入继续使用原路径。缺包或非法包必须失败，不能回退执行旧代码。

官方管理器继续拥有更新与恢复事务。新版本实际加载失败时使用它返回的恢复流程；客户端区分 applied、failed、cancelled 和 restart-required。界面不会把下载完成或 HTTP 200 显示成插件已成功运行。

## 交付与验收

Windows 服务包包含 Node、npm、市场源码、页面、vendor 及许可证，解压后无需 npm install。客户端使用仓库已有依赖，没有新增需要公司镜像补齐的客户端包。

流水线在 Windows / Linux、Node 22 / 24 验证服务与真实 npm 收集；在 Windows 检查两个客户端、真实 Host 冷包存储安装、多个插件、实际代码更新、故意失败版本恢复及重启卸载。Host / pnpm 的网络拦截有加载回执，不能把未安装拦截器时的空日志认作无公网请求。完整门禁通过后构建并上传客户端和服务器包，附来源及校验值。

部署、账号、备份和接口见 [OPERATIONS.md](OPERATIONS.md)，具体使用步骤见 [README.md](README.md)。
