# StarMind Windows 安装包

当前可下载构建：**StarMind Beta 2.0.21-beta.1 / Windows x64**。

- [下载安装包（GitHub 构建产物，需登录 GitHub）](https://github.com/Madelining/StarMind-Desktop/actions/runs/41500673402/artifacts/13167764526)
- [查看成功的构建与检查](https://github.com/Madelining/StarMind-Desktop/actions/runs/41500673402)
- 来源提交：`9367c6187e678662786c0b5a790e4d1ff2c93db9`。

下载约 335 MB 的 ZIP，解压后运行 `StarMind-Beta-2.0.21-beta.1-x64-Setup.exe`。ZIP 同时包含 `SHA256SUMS.txt`、`build-info.json` 和说明文件。

安装器与来源信息保存在仓库的 GitHub Actions 构建产物中；普通源码 ZIP 不包含该安装器。当前产物保留 90 天，需长期保存请下载留存。公司无法访问 GitHub 时，在外网下载后把 ZIP 或解压后的安装器传入公司。

本次已通过桌面版本一致性检查、Windows 平台打包检查、前端检查、打包内容及随包运行时验证；没有执行全新机器上的交互安装测试。此安装器未签名，是当前源码的测试构建，并非正式签名发布。

**此安装包没有实现尚在详设阶段的企业插件市场服务、StarMind 企业市场接入或 dshmarket 界面兼容。** 它提供当前分支已有客户端功能。企业市场实施材料见 [实施入口](adt-cpd-workflow/enterprise-market-plan/00-START-HERE.md)。

构建流程位于 `.github/workflows/windows-installer.yml`。该分支更新 `.github/windows-installer-request.json` 可以请求新的安装包构建；产物内的 build-info 始终记录实际来源提交，不能把旧安装包当成新提交构建。
