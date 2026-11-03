# 随交付附带的依赖源码

`semver/` 是 npm 官方 `node-semver` **v7.7.2** 的运行时源码。上游 Git tree：`281055e7716ef0415a8826972471331989ede58c`；来源：<https://github.com/npm/node-semver/tree/v7.7.2>。

许可证是 **ISC**，原始全文保存在 `semver/LICENSE`。本目录包含运行时的 classes/functions/internal/ranges、入口、原始 package.json、README 和许可证，没有修改算法。测试和开发工具不随附，也不需要安装。

StarMind 市场直接加载这些本地文件。**不要在本目录运行 npm install**；原始 package.json 中的 devDependencies 仅属于上游开发环境。市场运行和测试均不需要访问 npm 或任何 CDN。

离线打包工具使用 Node 发行包自带的 npm 解析依赖，npm 不属于市场服务的运行依赖；它仅在准备离线插件时使用指定的制品库。Windows 服务交付包另外附带原版 Node 运行时及其许可证。
