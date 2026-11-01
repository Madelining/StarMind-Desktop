# 安装器预置插件（B 方案）

目标：让同事**装完客户端就有插件**，而不是装完再想起来去跑一遍脚本。

## 现状：脚本就位，还没接进安装器

| 环节 | 状态 |
|---|---|
| `bootstrap-plugins.mjs`（预置脚本） | ✅ 已写好，支持 `--dry-run`、幂等 |
| `plugin-kit.json`（预置清单） | ✅ 8 个插件，含 1 个默认排除项 |
| 接入产品安装器（NSIS `customInstall`） | ❌ 未做——StarMind 客户端安装器不由本仓库构建 |
| 出内部分发包 | ❌ 未做 |
| 干净机器上验证 | ❌ 未做 |

**所以：现在拿到这个分支的人，仍然需要手动跑 `scripts/install-plugins.ps1`。**

## 两个文件

### `plugin-kit.json`

交给安装器用的清单，和 `plugins/manifest.json` 的区别是它只保留"装哪些、从哪装"：

- `required: true` 的会被装；`excluded` 里的明确不装（例如 `@perrylink/dsh-github`，按需单独装）
- `vendorDir` 指向随包分发的副本；为 `null` 时走 npm（`dsh-univer-office` 187 MB，不进安装包）

### `bootstrap-plugins.mjs`

```bash
node bootstrap-plugins.mjs --home <DSH_HOME> --kit <plugin-kit 所在目录> \
     [--profile desktop] [--node <node.exe>] [--pnpm <pnpm.mjs>] \
     [--exclude a,b] [--dry-run]
```

它只做四件事，且刻意做得很保守：

1. **profile 骨架**——不存在才创建（`package.json` + `cordis.yml` + `pnpm-workspace.yaml`），已存在一律保留
2. **装包**——有 vendor 副本走 `file:`，没有走 npm 版本号
3. **登记 `dsh.profile.bundles`**——只追加缺失项，并强制 `dsh-base` 排在 `dsh-web-app` 之前
4. **写标记**——`profiles/desktop/.plugin-kit.json` 记录本次装了哪些、是否失败

不启动应用、不改应用目录、失败不阻断安装（写日志 + 非零退出码）。

## 接入安装器需要做什么

在 NSIS 脚本的 `customInstall` 段里，安装完成后调一次：

```nsis
; 伪代码：路径按实际打包布局调整
nsExec::ExecToLog '"$INSTDIR\resources\runtime\x64\primary-runtime\dependencies\node\bin\node.exe" \
  "$INSTDIR\resources\app.asar.unpacked\adt-cpd-workflow\installer\bootstrap-plugins.mjs" \
  --home "$APPDATA\StarMind\home" \
  --kit "$INSTDIR\resources\app.asar.unpacked\adt-cpd-workflow\installer" \
  --pnpm "$INSTDIR\resources\runtime\x64\primary-runtime\dependencies\pnpm\bin\pnpm.mjs"'
```

要点：

- `--home` 必须指向**用户实际使用的 DSH home**（本机是 `%USERPROFILE%\.dsh-beta`，不同渠道可能不同，装在安装器里要取准）
- `--kit` 目录要与 `plugin-kit.json` 同级；vendor 副本按 `plugin-kit.json` 里的 `vendorDir` 解析，可以放在 kit 目录内，也可以放在 `../plugins/` 下
- 这一步**失败不应当让安装失败**——插件缺失只影响能力，不该阻止客户端可用
- 升级安装时本脚本会保留用户已有 profile 与插件，只补缺

## 内网前置条件（不满足就别指望"装完就有"）

1. **`dsh-univer-office` 必须能解析**——它不在 vendor 里，装的时候要访问 npm 或内网镜像
2. **依赖也要能解析**——`dsh-mnemon` 的 providers、`dsh-remote` 的 ssh2 等都走 registry；`--prefer-offline` 只是优先用本地缓存
3. 想完全离线：预置 pnpm store，或搭内网 npm registry 把 8 个插件连同依赖一起镜像

## 装上了 ≠ 环境就一样了

预置脚本搬的是**包**，不搬**状态**。以下仍需每人自己配：

| 不随安装包迁移 | 怎么补 |
|---|---|
| `dsh-remote` 的机器列表与凭据 | 设置 → 远程工作区（或 `~/.ssh/config` + 系统密钥库） |
| 模型 provider 与 API Key | 首次启动时填写 |
| `dsh-mnemon` 的记忆库 | 本机数据，不迁移 |
| `modlens` 引擎 | 单独安装后跑 `doctor` 自检 |
| settings / 权限预设 / 主题 | 重新配置 |
