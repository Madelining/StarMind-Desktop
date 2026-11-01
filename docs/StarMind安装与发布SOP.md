# StarMind 安装与发布 SOP

本文是 StarMind 客户端从安装到交付的统一操作手册。目标用户是第一次拿到安装包的使用者，以及负责构建、品牌审计和发布版本的技术维护者。

## 1. 适用范围

- 产品名称：StarMind
- 产品口号：让专注成为一种习惯
- 当前发布通道：Beta
- 支持平台：Windows x64（本文以 Windows 为例）
- 数据目录：安装版默认位于 `%APPDATA%\StarMind Beta\home`，开发版默认位于仓库的 `.starmind\home`

底层兼容层、依赖包名、模型 provider 名称和环境变量保持上游兼容，不作为界面品牌名称展示。

## 2. 最终用户安装

1. 下载 `StarMind-Beta-<版本>-x64-Setup.exe`。
2. 双击安装包，选择当前用户或所有用户安装。
3. 可选择安装目录，安装完成后会创建桌面和开始菜单快捷方式。
4. 打开桌面上的 `StarMind Beta`。

首次运行会进入引导页：

1. 在“网关配置”页填写 Base URL 和 API 密钥。
2. 点击“获取可用模型”，等待模型列表返回。
3. 选择默认模型，保存并进入主界面。

配置保存后会同步到整个客户端。进入主页面后，可在“设置 → 模型”和“设置 → 桌面设置 → StarMind 网关”中查看或修改同一份配置。

## 3. 常用验证

安装完成后按以下顺序验证：

1. 启动时不应再出现 DeepSeek 账号登录弹窗。
2. 欢迎页显示 StarMind 和“让专注成为一种习惯”。
3. 网关页能拉取模型并自动填充。
4. 任务栏、托盘、开始菜单和桌面快捷方式显示 StarMind 四芒星图标。
5. 询问模型“你是谁”，回答应自称 StarMind，不应把上游框架名当作自己的身份。

## 4. 开发环境准备

在源码目录执行：

```powershell
git submodule update --init --recursive
corepack yarn install --immutable
```

开发启动：

```powershell
corepack yarn starmind:dev
```

构建当前 Beta 客户端：

```powershell
corepack yarn workspace dsh-plugin-desktop-beta build
```

类型检查和功能测试：

```powershell
corepack yarn workspace dsh-plugin-desktop-beta typecheck
corepack yarn workspace dsh-plugin-desktop-beta test
```

## 5. 构建 Windows 安装包

在 Windows x64 环境执行：

```powershell
corepack yarn workspace dsh-plugin-desktop-beta dist:win
```

该命令会先执行 Windows 打包检查，再生成 NSIS 安装向导。产物位于：

```text
dsh-plugin-desktop-beta\dist\StarMind-Beta-<版本>-x64-Setup.exe
dsh-plugin-desktop-beta\dist\win-unpacked\StarMind Beta.exe
```

当前源码版本对应的安装包为：

```text
dsh-plugin-desktop-beta\dist\StarMind-Beta-2.0.21-beta.1-x64-Setup.exe
```

便携版构建：

```powershell
corepack yarn workspace dsh-plugin-desktop-beta dist:win-portable
```

便携版产物：

```text
dsh-plugin-desktop-beta\dist\StarMind-Beta-<版本>-x64-Portable.zip
```

## 6. 图标和品牌替换

统一图标源文件为 `assets\starmind-logo.svg`。换 Logo 后执行：

```powershell
corepack yarn icons:export
corepack yarn icons:check
```

品牌文字替换集中在三个渠道的 `src/starmind-branding.ts`，以及 Agent 身份层的 `src/host/starmind-identity.ts`。修改后必须同步检查：

1. Stable：`dsh-plugin-desktop`
2. Beta：`dsh-plugin-desktop-beta`
3. Next：`dsh-desktop-next`

统一品牌测试：

```powershell
corepack yarn workspace dsh-plugin-desktop-beta test tests/starmind-branding.spec.ts tests/starmind-identity.spec.ts
corepack yarn workspace dsh-desktop-next test tests/starmind-branding.spec.ts tests/starmind-identity.spec.ts
```

## 7. 发布前检查

- 三个渠道的 `build`、`typecheck` 和品牌测试通过。
- Windows 安装包和便携版 PE 校验通过。
- 安装后的应用名、快捷方式名、窗口标题、托盘和任务栏图标一致。
- 网关保存、模型拉取、密钥引用解析和设置页同步可用。
- 启动时无 DeepSeek 登录提示，Agent 自我介绍为 StarMind。
- 不提交 `node_modules`、构建产物、密钥、`.starmind` 和 `work` 中的本地数据。

## 8. 常见问题

- 任务栏按钮显示 “Electron” 或默认原子图标：Windows 把应用的 AppUserModelID（Beta 为 `ai.starmind.desktop.beta`）解析到了某个残留的 `.lnk` 快捷方式，通常是测试时手工创建的 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Electron.lnk`，其目标是 `node_modules\electron\dist\electron.exe`。删除该快捷方式并重启 explorer 即可，必要时重启 StarMind。安装包生成的快捷方式已通过 NSIS 的 `WinShell::SetLnkAUMI` 写入正确 AUMID，全新安装不受影响。开发版请通过 `Start-StarMind.cmd` 启动，不要直接运行 `node_modules\electron`。
- 任务栏按钮名与图标不正确时的自检：先确认安装目录里的 `StarMind Beta.exe` 图标是绿色四芒星（`Get-Item` 查看图标或 `ExtractAssociatedIcon`），再检查开始菜单是否残留指向 `electron.exe` 的快捷方式。
- 获取模型失败：检查 Base URL、API 密钥、网络代理和网关服务状态。
- 模型仍自称上游框架：更新到包含 `starmind-identity.ts` 的版本后重启应用。
- Windows 提示未知发布者：本地构建未签名，正式对外分发前需要配置代码签名证书。

## 9. 发布注意事项

当前本地构建为未签名产物。分发给其他用户前，维护者需要配置 Authenticode 代码签名证书并重新打包，否则 Windows 会显示 Unknown publisher 或 SmartScreen 警告。签名配置不写入本手册；证书和密钥必须留在本机，不得提交到 Git 仓库。
