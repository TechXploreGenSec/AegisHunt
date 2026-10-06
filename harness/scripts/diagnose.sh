#!/usr/bin/env bash
# diagnose.sh — pin down WHY tools are denied/unreachable on this machine.
# Run from anywhere:  bash /path/to/diagnose.sh [path/to/opencode]
# Exits 0 with a diagnosis table; every FAIL line names the exact cause.
set -uo pipefail

BIN="${1:-./opencode}"
CONFIG_DIR="${CONFIG_DIR:-$HOME/.config/opencode}"
FAIL=0
say()  { printf '%s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '\033[1;31m[FAIL]\033[0m %s\n' "$*"; }
good() { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }

say "== 1. binary identity (stale binary = #1 cause of phantom denials)"
if [[ -x "$BIN" ]]; then
  VER="$("$BIN" --version 2>/dev/null | head -1)"
  say "version: $VER"
  for marker in browser_get_page_content browser_click_and_download tool_call_audit_get harness_self_check bot_notify_hold; do
    if grep -q "$marker" "$BIN" 2>/dev/null; then good "bundled: $marker";
    else bad "NOT bundled: $marker — this binary predates the fix, download bb.6+ release"; fi
  done
else
  bad "binary missing/not executable: $BIN"
fi

say "== 2. config (opencode.json)"
if python3 -c "import json,sys; d=json.load(open('$CONFIG_DIR/opencode.json')); sys.exit(0 if isinstance(d.get('mcp',{}).get('temp-mail-mcp-server'),dict) else 1)" 2>/dev/null; then
  good "temp-mail-mcp-server entry present"
else
  bad "temp-mail-mcp-server missing from opencode.json mcp section"
fi
python3 -c "
import json
d = json.load(open('$CONFIG_DIR/opencode.json'))
print('default_agent:', d.get('default_agent'))
for n in ['coordinator','verification','recon','reporting']:
    print(' ', n, '->', (d.get('agent',{}).get(n) or {}).get('model', '(default)'))
" 2>/dev/null || bad "opencode.json unreadable"

say "== 3. MCP server connection states (unconnected server = tools invisible)"
if [[ -x "$BIN" ]]; then
  OUT=$(timeout 150 "$BIN" mcp list 2>/dev/null || true)
  echo "$OUT" | grep -E "✓|✗|failed|connected" | head -20
  for s in temp-mail-mcp-server memory gh-runner mitmproxy playwright; do
    if echo "$OUT" | grep -A 1 "$s" | grep -q "connected"; then good "$s connected";
    else bad "$s NOT connected — check network/npx/package on this machine"; fi
  done
else
  bad "skipped (no binary)"
fi

say "== 4. temp-mail MCP handshake (proves the server speaks, not just connects)"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | timeout 60 npx -y @pragyanm/temp-mail-mcp-server@1.0.2 2>/dev/null | python3 -c "
import json,sys
names = []
for line in sys.stdin:
    line = line.strip()
    if not line.startswith('{'): continue
    try: d = json.loads(line)
    except: continue
    if d.get('id') == 2:
        names = [t.get('name') for t in d.get('result',{}).get('tools',[])]
print('temp-mail tools:', ', '.join(names) if names else 'NONE — server broken here')
" || bad "temp-mail handshake failed"

echo
if [[ "$FAIL" -gt 0 ]]; then echo "RESULT: $FAIL problem(s) above — fix them, then re-run."; exit 1; fi
echo "RESULT: machine layer clean — any remaining denial is session/binary staleness: fresh session on the bb.6+ binary."
