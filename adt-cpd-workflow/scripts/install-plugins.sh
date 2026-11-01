#!/usr/bin/env bash
# 一键安装插件（Linux / macOS）
#
# 与 scripts/install-plugins.ps1 等价，按 plugins/manifest.json 安装到 StarMind 的 profile。
#
# 用法：
#   ./scripts/install-plugins.sh                  # 从 npm 安装
#   ./scripts/install-plugins.sh --offline        # 用 plugins/vendor 离线安装
#   ./scripts/install-plugins.sh --dry-run        # 只打印命令
#   DSH_HOME=~/.dsh ./scripts/install-plugins.sh  # 显式指定 home
set -euo pipefail

PROFILE_NAME="${DSH_PROFILE:-desktop}"
OFFLINE=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --offline) OFFLINE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$REPO_ROOT/plugins/manifest.json"
[[ -f "$MANIFEST" ]] || { echo "找不到 $MANIFEST" >&2; exit 1; }

# 最小 JSON 解析：只取 name / version / vendorDir / bundle，够用即可
parse_plugins() {
  node -e '
    const m = require(process.argv[1]);
    for (const p of m.plugins) console.log([p.name, p.version, p.vendorDir, p.bundle ? "1" : "0"].join("\t"));
  ' "$MANIFEST"
}

DSH_HOME="${DSH_HOME:-}"
if [[ -z "$DSH_HOME" ]]; then
  for c in "$HOME/.dsh-beta" "$HOME/.dsh"; do
    [[ -d "$c" ]] && DSH_HOME="$c" && break
  done
fi
[[ -n "$DSH_HOME" && -d "$DSH_HOME" ]] || { echo "未找到 DSH home，请设置 DSH_HOME" >&2; exit 1; }

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"
[[ -d "$PROFILE_DIR" ]] || { echo "profile 不存在：$PROFILE_DIR（先启动一次 StarMind）" >&2; exit 1; }

echo "DSH home : $DSH_HOME"
echo "profile  : $PROFILE_DIR"
echo

INSTALLER=""
if command -v dsh >/dev/null 2>&1; then
  INSTALLER="dsh"
elif command -v pnpm >/dev/null 2>&1; then
  INSTALLER="pnpm"
else
  echo "需要 dsh 或 pnpm 之一在 PATH 中" >&2
  exit 1
fi
echo "installer: $INSTALLER"
echo

while IFS=$'\t' read -r name version vendor_dir is_bundle; do
  if [[ "$OFFLINE" == "1" && -n "$vendor_dir" && "$vendor_dir" != "null" ]]; then
    spec="file:$REPO_ROOT/plugins/$vendor_dir"
    [[ -d "$REPO_ROOT/plugins/$vendor_dir" ]] || { echo "离线目录缺失：$vendor_dir" >&2; exit 1; }
  else
    spec="$name@$version"
  fi

  if [[ "$INSTALLER" == "dsh" ]]; then
    cmd=(dsh plugin --profile "$PROFILE_NAME" add "$spec")
  else
    cmd=(pnpm add "$spec" --dir "$PROFILE_DIR" --prefer-offline)
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] ${cmd[*]}"
  else
    echo "→ 安装 $name@$version ..."
    "${cmd[@]}"
  fi
done < <(parse_plugins)

echo
echo "完成。重启 StarMind 后在「设置 → 插件」确认插件已启用。"
echo "若用的是 pnpm 路径，请再手工确认 profile/package.json 的 dsh.profile.bundles 含下列条目："
parse_plugins | cut -f1,4 | awk -F'\t' '$2=="1"{print "  - "$1}'
