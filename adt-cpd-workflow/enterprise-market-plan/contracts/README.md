# 实现合同的使用规则

contracts.ts 定义跨组件 JSON 对象；service-api.d.ts 固定生产服务模块的导出函数和真实 Host 探针输入输出。它们是设计资料，不是已实现、已编译或已安装的运行模块。

实现对应 C02-C07 时，把类型落实到各组件源码，并在进程/文件/HTTP边界执行实际校验。服务不用第三方 schema validator，但必须实现本文确定字段的窄范围检查；不要为了“零依赖”自己实现完整 SemVer、YAML 或 npm 解析器。

官方 format 1 必须交给目标发行版的官方校验器。Profile/YAML/lock 解析复用客户端已有的解析库，或由真实固定 pnpm/Host 探针输出结构化事实；独立服务不手写 YAML 解析器。

运行时配置的 hostProbeEntry 指向受控本地文件 enterprise-market/tests/probe-manager.mjs。verifySnapshot 通过固定 Node 以 argv 传入 --request <JSON文件> --result <JSON文件>；不得使用 shell 字符串，也不得从远端 catalog 取得可执行入口。测试日志可以写 stdout/stderr，但探针结果放专用 JSON 文件，避免把插件日志混成 JSON。

C01 建立探针，C05复用它。探针必须启动真实Cordis/DSH管理器并加载bundle；managerResults保留实际结果，不合成application。loaded状态、依赖图、lock摘要和网络目的地证据需要实测产生。

verifyReleaseDirectory 的 expectedOrigin 在结构校验时可以取发布目录声明的值以验证格式；import时必须与服务管理员配置再次比较，不能把“包自己声称的Origin”视为授权。sha256File等使用流式读取，生产HTTP请求不每次重新缓冲或散列整个大包。

TargetVerificationReport 必需字段完整且 assurance=target-cold，才进入publish判断；FixtureVerificationReport仅允许fixture-only/not-run，绝不能被升级为生产报告。案例状态使用status，证据使用evidenceFiles，不能另建一套passed布尔字段协议。

RuntimeResource 的consumer是固定的包、版本及本地adapter名，不能包含远端脚本或命令。size/sha256必须与files中的同一路径记录一致。

真实baselineId由02-client.md规定的导出和摘要算法产生。测试工具中的beta-0.2.2-alpha.2-win32-x64仅为合成测试标记；examples/prepare-input.example.json的该值也须替换为真实导出值。示例不能直接当生产认证。
