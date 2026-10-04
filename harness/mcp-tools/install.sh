#!/usr/bin/env bash
# Install runtime deps for the bundled MCP servers (node_modules are NOT
# committed). Run from harness/mcp-tools/. python-based servers note their
# own requirements below.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
have_bun=0
command -v bun >/dev/null 2>&1 && have_bun=1
for d in */; do
  if [ -f "$d/package.json" ]; then
    echo "==> installing $d"
    if [ "$have_bun" = "1" ]; then ( cd "$d" && bun install ); else ( cd "$d" && npm install ); fi
  fi
  if [ -f "$d/mcp-server/package.json" ]; then
    echo "==> installing $d/mcp-server"
    if [ "$have_bun" = "1" ]; then ( cd "$d/mcp-server" && bun install ); else ( cd "$d/mcp-server" && npm install ); fi
  fi
done
echo "NOTE: man-mcp-server is python3 stdlib-only (no install step)."
echo "NOTE: temp-mail-mcp-server runs via npx (fetched on first use)."
