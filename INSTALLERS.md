# StarMind Windows 安装包

> **企业市场新版已交付（2026-11-04）。** **StarMind Beta 2.0.21-beta.2 / Windows x64** 安装器和独立市场服务器 ZIP 已上传 [enterprise-market-7 预发布](https://github.com/Madelining/StarMind-Desktop/releases/tag/enterprise-market-7)。[本轮构建、完整检查和发布](https://github.com/Madelining/StarMind-Desktop/actions/runs/41692960572)全部通过。

新版来自独立分支 [`feat/enterprise-plugin-market`](https://github.com/Madelining/StarMind-Desktop/tree/feat/enterprise-plugin-market)，包含企业插件市场客户端接入；原 `feat/adt-cpd-workflow-plan` 分支保持原样。完整下载、三步部署、离线插件准备及验收范围见 [企业市场交付说明](enterprise-market/DELIVERY.md)。

新版提供以下文件：

- `StarMind-Beta-2.0.21-beta.2-x64-Setup.exe`：Windows x64 客户端安装器。
- `StarMind-Market-Server-Windows-x64.zip`：含 Node、npm 及全部服务运行依赖的内网市场部署包，解压后无需联网 `npm install`。
- `SHA256SUMS.txt`、`client-build-info.json`：产物摘要与实际来源提交；服务器自身的构建信息和文件摘要位于其 ZIP 中。

在能访问 GitHub 的电脑下载，再传入公司内网。客户端安装器未签名，属于 Beta 测试构建。普通源码 ZIP 不包含安装器或服务器 Node 二进制。

## 历史构建：2.0.21-beta.1

以下旧安装器仍可在 Actions 产物保留期内下载，**没有本次企业市场服务或客户端接入**：

- [旧安装包（需登录 GitHub，产物保留 90 天）](https://github.com/Madelining/StarMind-Desktop/actions/runs/41500673402/artifacts/13167764526)
- [旧构建及检查](https://github.com/Madelining/StarMind-Desktop/actions/runs/41500673402)
- 旧来源提交：`9367c6187e678662786c0b5a790e4d1ff2c93db9`。

旧 ZIP 约 335 MB，内含 `StarMind-Beta-2.0.21-beta.1-x64-Setup.exe`、`SHA256SUMS.txt` 和 `build-info.json`。旧构建已通过其桌面边界、平台打包及运行时检查，未执行全新机器上的交互安装测试。它不能作为企业插件市场实现的交付凭据。

企业市场完整交付使用 `.github/workflows/enterprise-market.yml`；先前的 `.github/workflows/windows-installer.yml` 仍保留原有安装器构建用途。始终根据随包构建信息核对来源，不能将旧安装包当作新提交的构建。
