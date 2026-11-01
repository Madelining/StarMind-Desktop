# 团队插件基线（离线分发）

解决一个很具体的问题：**内网连不上 npm，同事装完客户端没法自动装插件。**

做法是把当前一套插件打成「基线包」，放共享盘；同事双击 `import-bundle.cmd` 就装齐。**不依赖 npm、不依赖客户端代码改动。**

## 两个角色

### 管理员 / 打包机：生成基线

```powershell
# 在已经装好插件的机器上跑
powershell -ExecutionPolicy Bypass -File offline\make-bundle.ps1 -Baseline 2026.11 -Zip

# 内网完全不通 npm 时，连依赖一起带上（包会大很多）
powershell -ExecutionPolicy Bypass -File offline\make-bundle.ps1 -Baseline 2026.11 -IncludeStore -Zip

# 只挑几个（比如只想发必装的）
powershell -ExecutionPolicy Bypass -File offline\make-bundle.ps1 -Baseline 2026.11 -Ship dsh-remote,dsh-plugin-save-token -Zip
```

产出 `dist\starmind-plugin-baseline-<基线号>.zip`（默认 7 个插件约 **4.5 MB**，解开 16 MB）。

### 终端用户：双击安装

1. 从共享盘把 `starmind-plugin-baseline-2026.11.zip` 拷到本地任意目录
2. **双击 `import-bundle.cmd`**（zip 放同目录，或把 zip 拖到 cmd 上）
3. 等提示完成，重启 StarMind

不需要懂命令行，不需要管理员权限，不动 App 安装目录。

## 共享盘约定

```
\\fileserver\starmind\plugins\
├── 2026.11\
│   ├── starmind-plugin-baseline-2026.11.zip
│   ├── import-bundle.cmd          ← 和 zip 放一起，用户拷一整个目录
│   ├── import-bundle.ps1
│   └── README.txt                 ← 由脚本自动生成
├── 2026.12\
└── latest\  →  指向当前推荐版本的快捷方式
```

**基线号建议用 `yyyy.MM`**，跟插件版本解耦；用户只需要知道"装最新那个"。

> zip 里已经自带 `README.txt`（含插件清单与注意事项），所以共享盘上不会出现"只有一个孤零零的 zip"的情况。

## 它是怎么工作的

```
import-bundle.cmd
  → import-bundle.ps1
      1. 找到 zip（同目录 / 拖入 / -Bundle 指定）
      2. 解压到 <DSH_HOME>\starmind-kit\<基线号>\   ← 落地保留，不是临时目录
      3. 生成 plugin-kit.json
      4. 调 installer\bootstrap-plugins.mjs
           → 用客户端自带的 node + pnpm 安装（file: 指向落地目录）
           → 登记 profile 的 dsh.profile.bundles
```

### 为什么包体必须落地保留

pnpm 会把插件记成 `file:<路径>` 依赖。如果指向临时目录，用完一删，profile 下次 `pnpm install` 就报错。

所以插件包体落在 `<DSH_HOME>\starmind-kit\<基线号>\`，占 **约 16 MB/基线**。更新基线时旧目录会被同名替换；换基线号则新旧并存，可手工删旧目录。

## 已知限制（照实写）

| 限制 | 说明 |
|---|---|
| **不含 `dsh-univer-office`** | 187 MB，单独处理；需要时用 `scripts/install-plugins.ps1` 或客户端插件页装 |
| **不带个人状态** | SSH 机器列表、凭据、API Key、MEMORY/USER 记忆、settings 都不在包里 |
| **不带 store 时仍需解析依赖** | 7 个插件的传递依赖要走 registry；内网不通就得 `-IncludeStore` |
| **`-IncludeStore` 会很大** | pnpm store 是全量内容寻址库，可能几百 MB 到 1 GB+，共享盘要留空间 |
| **只在 Windows 上验证过 dry-run** | `.cmd` 用 GBK 编码（中文 Windows 不乱码）；`.ps1` 用 UTF-8 BOM（PS 5.1 必需） |

## 已验证 / 未验证

**已在本机实测通过：**

- `make-bundle.ps1` 生成基线：7 个插件、16.1 MB → zip 4.5 MB，`baseline.json` 无 BOM 且可解析
- `import-bundle.ps1 -DryRun` 从 zip 全流程走通：解压 → 落地 → 生成 kit → bootstrap 演练 7 个 `file:` 安装
- 编码修正：`.ps1` 带 BOM、`.cmd` 用 GBK

**未验证：**

- 真实安装（非 dry-run）——本机沙箱不能写 `%USERPROFILE%\.dsh-beta`，且会改动现有环境
- 全新机器（没装过 StarMind）上的首次导入
- 内网共享盘的路径长度、权限、杀软拦截

第一次正式发给同事前，**建议找一台干净机器完整走一遍**，把结果记到本文件里。
