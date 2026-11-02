# 随详设提供的可运行接入工具

这些工具只用于 C01 的真实 DSH 接入验证，不是生产市场服务。它们使用 Node 内置模块，没有需要安装的 npm 依赖。要求 Node ^22.19.0 或 >=24.0.0。

在仓库根目录执行：

```powershell
node adt-cpd-workflow/enterprise-market-plan/tools/create-fixtures.mjs --output enterprise-market/work/fixture-release --origin http://127.0.0.1:18765
node adt-cpd-workflow/enterprise-market-plan/tools/serve-fixtures.mjs --release enterprise-market/work/fixture-release --port 18765
```

第二条命令持续运行，在另一个终端访问 http://127.0.0.1:18765/channels/stable.json 获取快照索引与 registry URL。把它们交给 C01 的临时 Profile/真实管理器，不修改日常使用的 Profile。

生成器拒绝覆盖非空目录。再次生成时使用新的工作目录。--node-version 可以记录目标 Host 的真实 Node 版本，不能据此假装已经运行该版本。

C01 接入真实企业配置前，应先按02-client.md导出真实baselineId，再加 --baseline-id <导出的64位摘要> 生成fixture；未传该参数时的beta-*是合成标记，只能用于工具自身测试。实际Node版本也用 --node-version 记录。不能关闭正式基线校验来迁就示例。

生成内容有五个真实 npm tarball：

- @starmind/enterprise-market-smoke 1.0.0，依赖 helper 1.0.0，可加载。
- 同插件 1.1.0，依赖 helper 1.1.0，可加载。
- 同插件 1.2.0，apply 故意抛错，用于加载失败验证。
- @starmind/enterprise-market-smoke-helper 1.0.0 与 1.1.0。

加载失败测试必须使用实际加载 bundle 的 Host。仅执行 CLI add 不一定运行 apply，不能把它当成激活测试。

包下载失败可以单独注入：停止上述测试服务，再用以下参数启动：

```powershell
node adt-cpd-workflow/enterprise-market-plan/tools/serve-fixtures.mjs --release enterprise-market/work/fixture-release --port 18765 --fail-artifact-version 1.2.0
```

此时 1.2.0 元数据仍可读取，但 tarball 请求返回 503；1.1.0 的包仍可用。测试时要确认专用缓存没有已经下载的 1.2.0，否则不会触发故障。是否保留/恢复旧版必须读取真实管理器结果并检查实际依赖和 bundle 状态。

运行随附工具测试：

```powershell
node --test adt-cpd-workflow/enterprise-market-plan/tools/fixtures.test.mjs
```

已验证的范围：tar 结构、包身份与依赖、摘要、确定性、scoped npm 路由、确切版本、内部 URL、下载故障注入、只读边界和内容变更检测。

未验证的范围：真实 DSH 安装/加载/更新/恢复、官方索引解析器、生产市场的导入/上架/证书、公司机器上的实际体验。verification.json 明确生成 status:not-run，不能用于批准上线。

示例域名 .example 不是真实服务。prepare-input.example.json 的目标版本和路径必须改为公司实际信息；示例包是本工具生成的合成包，不在公网 npm 发布，不能用 sourceRegistry 从公网下载它们。
