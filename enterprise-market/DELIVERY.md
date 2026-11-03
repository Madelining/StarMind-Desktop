# 企业插件市场交付说明

> **已完成交付（2026-11-04）。** [第 7 轮检查与发布](https://github.com/Madelining/StarMind-Desktop/actions/runs/41692960572)全部通过。已核对 GitHub 预发布的四个文件均上传完成，下载的构建记录和校验文件与发布资产摘要一致。

代码分支：[`feat/enterprise-plugin-market`](https://github.com/Madelining/StarMind-Desktop/tree/feat/enterprise-plugin-market)。安装包与服务包来源提交：`fc8b14afb77527ec807d4a374b9dac0ac8118e33`。原 `feat/adt-cpd-workflow-plan` 分支保持原样。随附 `client-build-info.json` 和服务包内的 `build-info.json` 记录实际构建来源；后续交付文档提交不改变已发布二进制的来源。

## 下载并带入公司

发布入口：[StarMind 企业插件市场 Beta 预发布](https://github.com/Madelining/StarMind-Desktop/releases/tag/enterprise-market-7)。下载以下文件：

| 文件 | 用途 |
| --- | --- |
| [StarMind-Beta-2.0.21-beta.2-x64-Setup.exe](https://github.com/Madelining/StarMind-Desktop/releases/download/enterprise-market-7/StarMind-Beta-2.0.21-beta.2-x64-Setup.exe) | Windows x64 客户端，包含企业市场接入 |
| [StarMind-Market-Server-Windows-x64.zip](https://github.com/Madelining/StarMind-Desktop/releases/download/enterprise-market-7/StarMind-Market-Server-Windows-x64.zip) | 公司内网部署包，包含 Node、npm、市场网页、服务源码和全部服务运行依赖 |
| [SHA256SUMS.txt](https://github.com/Madelining/StarMind-Desktop/releases/download/enterprise-market-7/SHA256SUMS.txt) | 校验安装器、服务器 ZIP 和客户端构建信息 |
| [client-build-info.json](https://github.com/Madelining/StarMind-Desktop/releases/download/enterprise-market-7/client-build-info.json) | 客户端版本、来源提交和安装器摘要 |

已核对的发布资产 SHA-256：

```text
5463fc41045de26b3771de40cc7ae4ba93b6aa2596cac54617e36ecf290c4f8e  StarMind-Beta-2.0.21-beta.2-x64-Setup.exe
f100459b1b78041e1109cd42941de7185108c4b3fb129636a1b9feeee3b3b543  StarMind-Market-Server-Windows-x64.zip
```

在能访问 GitHub 的电脑下载，再通过公司允许的方式传入内网。服务器 ZIP 解压后应有完整的 `StarMind-Market-Server-Windows-x64` 目录，其中 `runtime/node.exe` 和 `runtime/node_modules/npm/` 都需保留。**服务器运行不需要 `npm install`，也不需要向公司 npm 镜像上传包。** GitHub 的自动生成源码 ZIP 不包含 Node 二进制或客户端安装器。

客户端为未签名 Beta 测试安装包。已安装的 `2.0.21-beta.1` 不含本次企业市场实现，需要使用这次的新安装器。该功能接入 Beta / Next，Windows 交付的客户端为 Beta。

本次没有新增客户端 npm 依赖；市场服务使用的 `semver` 源码及许可证已随仓库和服务包附带。上述交付包支持离线安装与运行；如果还要在公司重新编译整个客户端，仍需准备原项目既有的 Yarn 依赖、Electron 和打包工具缓存。服务 ZIP 与客户端安装器不是完整的离线开发环境。原项目依赖版本以根 `yarn.lock` 和各工作区清单为准，Electron 发行文件从其官方 [Releases](https://github.com/electron/electron/releases) 获取。

## 部署三步

1. **准备市场配置。** 在一台同事可访问的内网 Windows 电脑上完整解压服务器 ZIP，将 `market.config.example.json` 复制为 `market.config.json`。设置 `host: "0.0.0.0"`，将 `publicOrigin` 改为实际访问地址，例如 `http://10.10.20.30:8787`；协议、域名或 IP、端口需与访问地址一致，不带路径和尾斜杠。将 `dataDir` 指向需要保留和备份的本机磁盘目录。
2. **创建发布账号并启动。** 双击 `Create-Publisher.cmd`，输入用户名，保存仅显示一次的发布令牌并私下交给该用户。再双击 `Start-Market.cmd`，保持进程运行。同事访问配置的市场地址，即可浏览和下载；持有令牌的用户可登录上传。每名发布者可分别创建账号，市场记录包名所有者和发布审计。
3. **连接客户端并使用。** 安装新的 `.exe`，打开 StarMind 侧栏“企业市场 → 市场设置”，填写市场地址并启用企业模式；HTTP 服务勾选“允许 HTTP”，保存后“重启并应用配置”。旧 Profile 含公网锁文件时，使用界面提供的“新建企业 Profile”。进入市场后可搜索、收藏、查看说明和版本，登录发布插件；点击安装、更新或卸载后，由当前 Host 的真实官方插件管理器执行。

内网 HTTPS 与公司 CA 的接入、管理员统一策略、账号停用和备份恢复见 [README.md](README.md) 与 [OPERATIONS.md](OPERATIONS.md)。已有用户数据与市场 `dataDir` 在升级时均需保留。

## 只读 npm 镜像与离线插件

公司现有 npm 镜像可以继续保持只读。企业市场将用户上传的原始包保存在自己的本地数据目录，并提供固定的企业 `/npm/` 读取地址供 StarMind 安装。客户端在企业模式下固定这一地址，关闭公共市场及公网 fallback。

可以上传离线下载的 DSH 原始 `.tgz`：同时选中主插件及所需依赖包，读取信息后选择主插件并发布。市场要求已构建代码和有效的 `dsh.bundle.patch` 文件，并检查依赖、optional dependency、必需 peer 与 npm alias 的包集。缺失依赖会明确报出包名、范围和来源，不会在隔离环境自动访问公网补齐。

也可以在可读取完整依赖的电脑上，用随服务包提供的工具生成 `.dshbundle.json`，复制到公司后在“发布插件 → 导入离线包”上传。例如，在服务器解压目录运行：

```powershell
.\runtime\node.exe tools/prepare-offline.mjs --tarball C:\Downloads\plugin.tgz --registry https://你的只读npm镜像/ --output C:\Downloads\plugin.dshbundle.json
```

工具使用真实 npm 求解和校验原始制品，不执行插件安装脚本。镜像缺包时，需要在能够获取完整依赖的机器准备；已发布版本可从市场下载完整离线包，再导入另一台隔离市场。

以下发行方式需要插件维护者先处理：安装脚本或隐式本地编译、内嵌 `node_modules` / 非空 `bundleDependencies`，以及 Git、URL、file、workspace 依赖。预编译原生模块需匹配目标 Windows 和 Node ABI；没有声明 `engines.dsh` 的插件会显示兼容性未声明提示。插件自身所需的模型、外部 API、浏览器引擎或 Python 资源仍需另行准备内网替代，依赖包齐全不代表这些业务资源已经可用。

## 验证范围与结果

第 7 轮全部门禁成功：四组服务测试各 23 项通过，独立服务交付目录再次测试通过；Beta 970 项通过 / 29 项按平台等条件跳过，Next 873 项通过 / 34 项跳过；两端企业市场测试各 11 项通过。Windows 打包内容检查、安装器生成和预发布上传均成功。跳过项不是本次企业市场验收的替代。

| 范围 | 验证内容 |
| --- | --- |
| 市场服务 | Windows / Linux、Node 22 / 24：上传发布、账号权限、不可变版本、依赖闭包、撤回保留、导入导出、归档与 Windows 路径检查 |
| 独立服务器包 | 在复制后的交付目录运行全部市场测试和随附 npm，确认测试与准备工具不依赖仓库其他目录 |
| 客户端 | Beta / Next 镜像边界、类型检查、测试及构建；Windows 打包与运行时内容检查 |
| 真实 Host | 冷包存储安装两个插件，读取私有元数据与原始 tgz；执行 1.1 新代码和新依赖；实际执行故意失败的 1.2，并由官方管理器恢复 1.1；Host 重启后确认版本，再卸载 |
| 网络约束 | 验收 Host 与 pnpm 子进程加载本机网络拦截，并检查外部连接尝试和锁文件中的公网地址；验证直接官方 RPC 同样不能绕过企业安装来源 |
| 实际 DSH 包 | `dsh-plugin-save-token@2.4.1` 已完成准备、市场导入、npm 元数据、制品下载及离线包导出的原始字节校验；此项未执行该插件的业务代码 |

第 7 轮真实 Host 流程通过，网络拦截加载回执覆盖 2 个 Host 进程和 22 个 pnpm 进程，市场请求 31 次，未记录外部连接尝试。验收核对了实际执行的新插件和新依赖版本，并确认故意失败的新版真正执行后恢复旧版。该结果针对上述验收场景，不代表任意第三方插件业务功能均已验证。此处的网络拦截用于验收，不会替公司修改系统防火墙。

尚未执行全新公司电脑上的交互安装测试、公司模型与真实网络环境联调，也未做正式签名发布。部署后应先用公司实际要使用的插件及模型完成验收。实现细节与后续维护入口见 [ARCHITECTURE.md](ARCHITECTURE.md)。
