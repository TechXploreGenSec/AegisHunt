#!/usr/bin/env bash
# run.sh — launch the AegisHunt binary with preflight checks.
# Everything this harness needs is verified BEFORE the session starts,
# so a broken layer fails here in seconds instead of silently mid-hunt.
#
# Usage:
#   bash run.sh [path/to/opencode] [-- extra args passed to opencode]
#   OPENCODE_BIN=./opencode bash run.sh
#   CONFIG_DIR default: ~/.config/opencode
set -euo pipefail

BIN="${OPENCODE_BIN:-./opencode}"
if [[ $# -gt 0 && "${1}" != -* ]]; then BIN="$1"; shift; fi
if [[ "${1:-}" == "--" ]]; then shift; fi
CONFIG_DIR="${CONFIG_DIR:-$HOME/.config/opencode}"
ENV_FILE="$CONFIG_DIR/.env.bb"
WANT_VERSION="${OPENCODE_VERSION:-1.18.33}"

fail() { printf '\033[1;31m[preflight]\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m[preflight]\033[0m %s\n' "$*"; }

# 1. binary present + executable + right stamp
[[ -x "$BIN" ]] || fail "binary not found/executable: $BIN (download the bb release asset first)"
VER="$("$BIN" --version 2>/dev/null | head -1)" || fail "binary would not start: $BIN --version failed"
[[ "$VER" == *"$WANT_VERSION"* ]] || fail "binary reports '$VER', harness expects '$WANT_VERSION' — wrong release?"
ok "binary $VER"

# 2. env file + required vars (presence only — values never printed)
[[ -f "$ENV_FILE" ]] || fail "missing $ENV_FILE — restore secrets per harness/config/SECRETS.md"
set -a; source "$ENV_FILE"; set +a
missing=()
for v in SUPABASE_URL SUPABASE_SERVICE_KEY NEO4J_URI NEO4J_USER NEO4J_PASSWORD TELEGRAM_BOT_GENERAL_TOKEN TELEGRAM_CHAT_ID; do
  [[ -n "${!v:-}" ]] || missing+=("$v")
done
[[ ${#missing[@]} -eq 0 ]] || fail "env vars unset in $ENV_FILE: ${missing[*]}"
ok "env $ENV_FILE (${#missing[@]} missing)"

# 3. config on disk (fatal); layer dirs (warn — degraded hunt, still starts)
[[ -f "$CONFIG_DIR/opencode.json" ]] || fail "missing $CONFIG_DIR/opencode.json"
[[ -d "$CONFIG_DIR/scopes" ]] || echo "[preflight] warn: no $CONFIG_DIR/scopes/ — seed scope files before hunting" >&2
[[ -d "$CONFIG_DIR/skills" ]] || echo "[preflight] warn: no $CONFIG_DIR/skills/ — run harness/scripts/fetch-methodology.sh" >&2
command -v jq >/dev/null || fail "jq required but not installed"
python3 -c "import json; json.load(open('$CONFIG_DIR/opencode.json'))" || fail "$CONFIG_DIR/opencode.json is not valid JSON"
ok "opencode.json parses"

# 4. methodology source present (index itself is verified in-session by harness_self_check)
SRC="${METHODOLOGY_SOURCE_PATH:-$HOME/hacktricks}"
[[ -d "$SRC/src" ]] || echo "[preflight] warn: $SRC/src missing — run harness/scripts/fetch-methodology.sh" >&2

ok "all preflight checks passed — launching"
exec "$BIN" "$@"
