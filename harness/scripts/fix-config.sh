#!/usr/bin/env bash
# fix-config.sh — make THIS machine's opencode config purely ours.
# - archives the alien orchestrator.md (phantom toolchain, not our harness)
# - enforces default_agent=coordinator
# - ensures apmix provider + per-agent model routing exist (never overwrites live keys)
# - verifies agent count, default, routing, JSON validity, and reports
# Idempotent. Backs up before touching anything. Prints NO secret values.
set -euo pipefail

CFG="${CONFIG_DIR:-$HOME/.config/opencode}"
export CFG_DIR="$CFG"
STAMP="$(date +%Y%m%d-%H%M%S)"
log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

[[ -f "$CFG/opencode.json" ]] || { echo "no $CFG/opencode.json — nothing to fix" >&2; exit 2; }
cp -a "$CFG/opencode.json" "$CFG/opencode.json.pre-fix-$STAMP"
log "backup: opencode.json.pre-fix-$STAMP"

# 1. archive the alien entry point (only .md referencing phantom tools)
if [[ -f "$CFG/agents/orchestrator.md" ]]; then
  mkdir -p "$CFG/agents-archived-$STAMP"
  mv "$CFG/agents/orchestrator.md" "$CFG/agents-archived-$STAMP/"
  log "archived agents/orchestrator.md (phantom toolchain) — native coordinator is the entry"
else
  log "orchestrator.md already gone"
fi

# 2-4. canonical harness config (python: structure only, values never printed)
python3 - <<'PY'
import json, os
cfg = os.environ.get("CFG_DIR", os.path.expanduser("~/.config/opencode"))
p = os.path.join(cfg, "opencode.json")
d = json.load(open(p))
changed = []

if d.get("default_agent") != "coordinator":
    d["default_agent"] = "coordinator"
    changed.append("default_agent=coordinator")

prov = d.setdefault("provider", {})
if "apmix" not in prov:
    prov["apmix"] = {
        "npm": "@ai-sdk/openai-compatible",
        "name": "Apmix",
        "options": {"baseURL": "https://api.apmix.ai/v1", "apiKey": "PASTE_KEY_HERE"},
        "models": {"claude-sonnet-4-6-free": {"name": "Claude Sonnet 4.6 Free"}},
    }
    changed.append("apmix provider skeleton (paste live key into apiKey)")
else:
    if prov["apmix"].get("npm") != "@ai-sdk/openai-compatible":
        prov["apmix"]["npm"] = "@ai-sdk/openai-compatible"
        changed.append("apmix npm -> openai-compatible")
    if prov["apmix"].get("options", {}).get("baseURL") != "https://api.apmix.ai/v1":
        prov["apmix"].setdefault("options", {})["baseURL"] = "https://api.apmix.ai/v1"
        changed.append("apmix baseURL fixed")
    if "claude-sonnet-4-6-free" not in prov["apmix"].get("models", {}):
        prov["apmix"].setdefault("models", {})["claude-sonnet-4-6-free"] = {"name": "Claude Sonnet 4.6 Free"}
        changed.append("apmix model entry added")

want = {
    "coordinator": "apmix/claude-sonnet-4-6-free",
    "verification": "opencode/space-bunny-free",
    "recon": "opencode/space-bunny-free",
    "reporting": "opencode/space-bunny-free",
}
agents = d.setdefault("agent", {})
for name, model in want.items():
    cur = (agents.get(name) or {}).get("model")
    if cur != model:
        agents.setdefault(name, {})["model"] = model
        changed.append(f"agent.{name}.model={model}")

json.dump(d, open(p, "w"), indent=1)
print("CHANGED:", "; ".join(changed) if changed else "nothing — already canonical")
PY

# 5. verify + report (names and counts only, never values)
python3 - <<'PY'
import json, os, glob
cfg = os.environ.get("CFG_DIR", os.path.expanduser("~/.config/opencode"))
d = json.load(open(os.path.join(cfg, "opencode.json")))
print(f"default_agent: {d.get('default_agent')}")
print("providers:", ", ".join(sorted(d.get("provider", {}).keys())))
print("agent routing:")
for name in ["coordinator", "verification", "recon", "reporting"]:
    print(f"  {name:13s} -> {(d.get('agent', {}).get(name) or {}).get('model', '(default)')}")
mds = sorted(os.path.basename(f) for f in glob.glob(os.path.join(cfg, "agents", "*.md")))
print(f"custom .md agents active ({len(mds)}): {', '.join(mds)}")
print("native agents in harness binary: 11 (build, plan, general, explore, compaction, title, summary + coordinator, recon, verification, reporting)")
PY
log "done. start a FRESH session — old sessions keep whatever agent they started with."
