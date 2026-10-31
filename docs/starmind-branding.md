# StarMind 客户端品牌资源

当前图标源自本机的 `StarMind-Logo-Assets.zip`，原始文件保存在 `assets/starmind/`。该素材包的说明标明：图案依据此前原型重建，并非精确提取的原始品牌资产。应用采用深绿色底与浅绿色四芒星；欢迎页使用透明四芒星轮廓。

统一源文件为 `assets/starmind-logo.svg`。更换 SVG 后执行：

```powershell
node scripts/export-starmind-icons.mjs
node scripts/export-app-icons.mjs --check
```

这会更新三个渠道的窗口、任务栏、安装器、macOS、Linux 图标、托盘、Composer 图层和前端嵌入资源。托盘的深浅主题原图来自 `assets/starmind/`。若品牌轮廓也改变，应一并替换该目录中的透明托盘 SVG 与多尺寸 PNG。

macOS PNG 与 ICNS 保留原有视觉安全区：1024 像素画板内居中放置 824 像素图案，四周透明留白各 100 像素；Windows 与 Linux 保持完整图案尺寸。

Desktop 自有客户端插件通过公开品牌槽位提供 StarMind 图标与字标。原生客户端在读取上游发布的静态 UI 脚本时替换产品名称、启动页名称与欢迎口号。聊天数据和 API 响应不参与文案替换；依赖包名、协议标识、真实模型厂商与模型 ID 保留原值。系统提示配置禁用上游 Harness 身份，并设置 StarMind 身份前缀。

StarMind 的发布与上游安装包独立。Beta 与 Next 的上游更新功能停用，不会请求检查、下载安装程序或上报安装标识；设置页显示本地构建说明。Stable 不加载上游桌面更新插件。
