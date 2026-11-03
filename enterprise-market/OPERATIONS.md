# 部署与维护

## 数据与备份

`dataDir/state.json` 保存账号摘要、发布记录和审计；`artifacts/<sha256>.tgz` 保存原始包；`uploads/` 是用户上传暂存区，记录有效期 24 小时。发布通过本机写锁和原子替换 state.json 提交；失败的发布不会进入可安装目录。

备份时先正常停止服务，再整体复制 `dataDir`。恢复时把完整目录放回本地磁盘，用相同 `publicOrigin` 启动；域名改变后 metadata 与下载链接会以新配置生成，已有客户端锁文件仍可能引用旧域名，因此应保留原地址或为客户端创建新 Profile。不要只备份 state.json 或只备份 tarball。

撤回只从新的可安装目录隐藏版本，保留 npm 元数据和制品，供已安装 Profile 的恢复、卸载及锁文件读取。撤回不能覆盖旧版本；修复后发布新版本。当前没有自动删除历史制品的任务。

默认发布上限：单包 256 MiB、单次发布原始包合计 256 MiB、单用户有效暂存 1 GiB、每次 1000 个包；解压检查上限 512 MiB，离线 JSON 导入请求上限 384 MiB。可在 config.limits / maxImportBytes 调小。增大限额前应评估内存；解压检查和离线导出需要内存，不适合无限大文件。

## 账号与故障恢复

```sh
# 创建管理员或普通发布账号。返回令牌只显示一次，数据文件只存摘要。
node src/cli.mjs create-user --config market.config.json --name market-admin --role admin
node src/cli.mjs create-user --config market.config.json --name alice

# 停用账号，使旧发布令牌立即失效；既有发布内容仍保留。
node src/cli.mjs revoke-user --config market.config.json --id 用户UUID

# 查看记录数量。检查不等同于目标 DSH Host 的加载验证。
node src/cli.mjs check --config market.config.json

# 仅在进程已退出、存在残留锁时使用。仍存活或来自其他主机的锁不会被解除。
node src/cli.mjs unlock --config market.config.json --lock server
node src/cli.mjs unlock --config market.config.json --lock writer
```

账号令牌丢失时停用旧账号并创建新账号。管理员可发布、撤回已有包名的新版本；原拥有者记录保持可追溯。发布者只能使用自己的暂存文件，不能接管别人已发布的包名或撤回别人版本。

服务退出前使用 Ctrl+C，让服务锁正常清理。异常中断后不要直接删除所有锁或数据文件；先确认原进程状态，再使用 unlock。检查报 STORE_CORRUPT 时保留现场并从备份恢复对应制品，禁止用新内容覆盖同名旧版本。

## HTTP 接口

接口均同源；写接口使用 `Authorization: Bearer <token>`，只接受 POST，禁止跨源写请求。浏览和下载默认向内网访问者公开。部署网络应限制服务可达范围。

| 接口 | 用途 |
| --- | --- |
| `GET /healthz`、`GET /api/config` | 健康与市场信息 |
| `GET /api/auth/me` | 验证 Bearer 发布令牌及当前发布者 |
| `GET /api/releases/mine` | 当前用户可管理的发布版本 |
| `GET /api/catalog?q=&category=&sort=newest` | 搜索插件目录（sort 也支持 name） |
| `GET /api/plugins/:encodedName` | 插件详情和版本 |
| `GET /api/plugins/:encodedName/versions/:version` | 精确发布详情与批准状态 |
| `POST /api/uploads?filename=plugin.tgz` | 原始 application/octet-stream 分阶段上传 |
| `POST /api/releases` | 使用本用户 uploadIds 发布并校验闭包 |
| `POST /api/import` | 导入 `starmind.enterprise-market.bundle` JSON |
| `GET /api/releases/:id/download` | 下载完整离线 JSON 包 |
| `POST /api/releases/:id/withdraw` | 所有者或管理员撤回 |
| `GET /api/audit` | 管理员审计 |
| `GET /dsh-index.json` | 官方 format 1 目录 |
| `GET /npm/…` | 固定企业 npm 元数据入口 |
| `GET /npm/releases/:id/…` | 单发布包集合追溯入口 |
| `GET /artifacts/:sha256.tgz` | 原始 tgz，SHA-512 integrity，支持 HEAD/ETag |

StarMind 使用稳定的 `/npm/`，使多个插件组合安装与重启后卸载遵守官方插件管理器的仓库一致性要求。任意发布所带依赖的 name/version 在全市场不可变；不能用另一插件发布偷偷替换它。独立 release ID 用于溯源和离线导出，不在每次安装之间切换 pnpm registry。

上传包的语义版本范围由随附 npm 官方 node-semver 处理；闭包检查只检查原始包的声明。真正的组合求解、安装及加载由实际 npm/pnpm 和 DSH Host 完成，服务不会把“声明齐全”宣称为任意插件组合一定能加载。

## 企业策略边界

桌面配置固定市场 Origin，拒绝跨源重定向、外部 URL/Git/动态版本安装，官方插件管理器入口也受企业策略限制。旧公共市场 bundle 不会在企业 Profile 启动。市场网页不从 GitHub 读取 README、评论或图片，不依赖外部脚本、字体或第三方登录。

这是客户端和服务的分发策略。插件本身以用户权限运行，仍可调用本机网络和外部程序；需要强制隔离时，应由公司的现有网络策略实施。企业市场不会修改系统防火墙或替插件模拟外部服务。
