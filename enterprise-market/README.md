# StarMind 企业插件市场

公司内网可独立运行的插件市场。服务、网页和客户端连接不依赖公网 CDN、GitHub、公共 npm 或外部账号。服务使用 Node 内置模块和随源码附带的 `semver`，不需要执行 `npm install`。

本实现替代前期 `adt-cpd-workflow/enterprise-market-plan/` 中的实施设想；以本目录代码、测试和实际交付说明为准。客户端接入位于 **Beta / Next**，旧 Stable 客户端需要使用本次 Beta 安装包。

## 日常使用

- 浏览、搜索、分类、排序、收藏、查看使用说明和历史版本。
- 在 StarMind 内通过官方插件管理器安装、更新、启用、停用、卸载；网页独立使用时可下载离线包。
- 发布者使用管理员分配的令牌登录，自行上传插件 `.tgz` 和依赖包，或导入完整离线包；无需可写 npm 制品库。
- 用户管理自己的版本并撤回发布；已发布版本不能覆盖。同一个 npm 包名和版本在整个市场中只允许一种内容。
- 下载的离线包包含原始插件和依赖，可导入另一台隔离市场，不修改插件原始 tgz。

## 先在一台内网电脑部署

Windows 用户下载本分支 Actions 的 **StarMind-Market-Server-Windows-x64** 交付包，完整解压。它包含 Node 运行时、npm、网页和全部市场依赖源码，不需要联网安装。源代码 ZIP 不包含 Node 二进制。

1. 将 `market.config.example.json` 复制为 `market.config.json`。
2. 把 `host` 改为 `0.0.0.0`；把 `publicOrigin` 改为同事实际访问的地址，例如 `http://10.10.20.30:8787`。地址不带尾斜杠或路径。域名、IP、协议、端口需要与访问地址完全一致。
3. `dataDir` 指向本机持久化磁盘目录。市场包和用户记录保存在这里，升级时保留。
4. 双击 `Create-Publisher.cmd`，输入用户名，将一次显示的发布令牌私下交给该用户。可以为每名发布者分别创建账号。
5. 双击 `Start-Market.cmd`。保持服务进程运行，同事就能打开市场地址。正式部署可交给公司已有的进程管理/服务管理工具托管。

默认示例仅监听本机，适合首次验证。在已有 HTTPS 反向代理后部署时，`publicOrigin` 填最终 HTTPS 地址，代理保留原始 Host 并转发到本地 HTTP 监听端口。企业 CA 应导入受信环境或通过客户端 `caFile` 配置，不要关闭证书校验。内网 HTTP 部署需要在客户端明确勾选允许 HTTP；发布令牌的传输保护由部署网络提供。

Linux 或已有 Node 的 Windows 机器可直接使用源码，要求 Node >=22.19：

```sh
node src/cli.mjs create-user --config market.config.json --name alice
node src/cli.mjs serve --config market.config.json
```

## 连接 StarMind

安装本分支提供的 **2.0.21-beta.2** Windows 客户端，打开侧栏底部“企业市场”，进入“市场设置”。填写市场地址、启用企业模式，HTTP 服务勾选允许 HTTP。保存后选择“重启并应用配置”。

企业模式会停用公共市场 bundle，清空插件管理器的公共 fallback，并为包管理器固定企业 npm 地址。配置保存在当前 DSH_HOME 下的 `enterprise-market.json`；管理员可用 `STARMIND_ENTERPRISE_POLICY` 指定统一配置文件。一个 Host 运行期间使用固定配置，保存修改需要重启。

旧 Profile 的锁文件可能包含公网地址。客户端会保留旧数据、阻止在它上面继续安装，并提供“新建企业 Profile”入口。不要手工把旧锁文件中的地址批量替换为内网地址。已有插件卸载、停用和新企业 Profile 的创建是独立操作。

企业页面中的安装操作会再次由当前 StarMind Host 验证批准版本和来源，然后调用真实的 DSH 插件管理器。`npm / pnpm` 数据、启用状态、回滚与加载结果由该管理器拥有，市场没有第二份客户端安装数据库。

## 上传已有的 DSH 插件

在网页或客户端内的市场右上角选择“发布者登录”，粘贴令牌，然后选择“发布插件”。

已有完整离线包时选择“导入离线包”。只有原始 npm `.tgz` 时，一次选中主插件和所需依赖，先上传读取包信息，再选主插件、填写说明并发布。原始包应包含 `package/package.json`、已构建代码和声明的 `dsh.bundle.patch`。

市场在发布前重新解析原始 tgz，检查包路径、摘要、版本、依赖范围、npm alias、必需 peer、optional dependency 和 bundle 文件。缺失依赖会给出包名、版本范围和具体来源，补齐后重试即可。服务从不执行上传代码或安装脚本。

插件没有声明 `engines.dsh` 时会保留“兼容范围未声明”的提示，不替作者虚构兼容性。预编译 `.node` 模块可以上传，但仍需符合目标系统和 Node ABI。

需要 `preinstall/install/postinstall`、隐式 node-gyp 编译、内嵌 `node_modules` / 非空 `bundleDependencies`，或 Git/URL/file/workspace 依赖的包会被拒绝。请先由插件维护者制作不需要安装脚本、依赖独立发布的离线预构建版本。插件运行时调用的外部 API、模型、浏览器引擎或 Python 服务，需要另行提供内网替代或离线资源；npm 包完整并不意味着这些服务也已准备好。

## 在可下载依赖的电脑上准备完整离线包

使用交付包中的 `runtime/node.exe`，或已有 Node + npm；制品库地址必须显式指定。以下过程**不执行插件安装脚本**。

```sh
node tools/prepare-offline.mjs --plugin dsh-plugin-save-token@2.4.1 --registry https://registry.npmjs.org/ --output save-token.dshbundle.json

node tools/prepare-offline.mjs --tarball downloaded-plugin.tgz --registry https://你的只读npm镜像/ --output plugin.dshbundle.json
```

Windows 交付包可将命令中的 `node` 换为 `runtime\node.exe`。npm 从指定镜像生成真实锁文件，工具按锁下载并校验原始 tgz，并在写出 JSON 前运行与市场相同的发布检查。如果某个平台的 optional 依赖没有被 npm 收集齐，准备过程会报出缺失项，不会生成看似完整的交付包。

准备工具使用空的 npm 用户和全局配置，并清除继承的 `npm_config_*`，避免个人的 scoped registry 覆盖指定镜像。镜像需允许匿名读取；需企业 CA 时可设置 `NODE_EXTRA_CA_CERTS` 指向 CA 文件。若镜像把制品重定向到另一可信域名，可显式增加 `--allow-origin https://制品域名`；制品下载不会自动跟随未知外部地址。npm 求解本身仍需能读取插件声明所需的元数据；不支持的 Git/URL 等依赖应由作者先改为镜像中的 npm 包。

将生成的 `.dshbundle.json` 复制进公司，在市场“发布插件 → 导入离线包”上传。npm 镜像缺包时，需要在可以下载这些包的机器准备完整包；隔离市场不会替用户访问公网补齐。

## 存储、恢复与接口

详见 [OPERATIONS.md](OPERATIONS.md)，实现与维护说明见 [ARCHITECTURE.md](ARCHITECTURE.md)。服务为单机单写者设计，数据目录应位于本地磁盘；不支持多个进程共享 NFS/SMB 目录。没有后台公网同步、自动 npm fallback 或数据库安装要求。

## 验证

在仓库根目录运行：

```sh
node --test enterprise-market/test/*.test.mjs enterprise-market/tests/*.test.mjs
```

客户端真实 Host 检查需要已安装原仓库依赖并完成 Beta 构建：

```sh
yarn check:desktop-variants
yarn workspace dsh-community-market build
yarn workspace dsh-plugin-desktop-beta check
yarn workspace dsh-desktop-next check
node dsh-plugin-desktop-beta/scripts/verify-enterprise-market.mjs
```

本分支 `Enterprise Plugin Market` Actions 执行服务跨系统测试、两个客户端检查、真实 Host 安装/更新/失败恢复/重启卸载和 Windows 打包，再提供带来源与校验值的产物。运行失败时不能将该次产物视为通过交付。
