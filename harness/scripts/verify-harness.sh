#!/usr/bin/env bash
# verify-harness.sh — strong pre-hunt certification for the AegisHunt tree.
# Run from the repo root, BEFORE starting testing on any machine:
#   bash harness/scripts/verify-harness.sh [path/to/opencode-binary]
#
# Layer 0 — binary: stamp + every enforcement tool actually bundled.
# Layer 1 — wiring: every tool file referenced in registry.ts; every agent
#   permission key present in agent.ts (incl. question-denied everywhere).
# Layer 2 — prompts: every load-bearing rule marker present in the four
#   agent prompts (a dropped rule fails here, not silently mid-hunt).
# Layer 3 — live preconditions: env keys, Neo4j TCP, config parse, skills,
#   methodology source. (Deep proof — agents/permissions/graph/audit — is
#   harness_self_check, run as the first call of a fresh session.)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="${1:-$ROOT/packages/opencode/dist/opencode-linux-x64/bin/opencode}"
SRC="$ROOT/packages/opencode/src"
PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); }
fail() { FAIL=$((FAIL+1)); printf '\033[1;31m[FAIL]\033[0m %s\n' "$*"; }

echo "== Layer 0: binary ($BIN)"
if [[ -x "$BIN" ]]; then
  VER="$("$BIN" --version 2>/dev/null | head -1)"
  [[ "$VER" == *"1.18.33"* ]] && pass || fail "version stamp is '$VER', want 1.18.33"
else
  fail "binary missing/not executable: $BIN"
fi
if [[ -x "$BIN" ]]; then
  for marker in tool_call_audit_get todo_coverage_check todo_honesty_check \
      endpoint_completion_score asset_generate_test_plan hypothesis_coverage_check \
      harness_self_check bot_notify_hold watchdog-resume scope_deviations \
      outside-loaded-scope fingerprint_refs divergentRequired matchedPrediction; do
    if grep -q "$marker" "$BIN" 2>/dev/null; then pass; else fail "binary missing marker: $marker"; fi
  done
fi

echo "== Layer 1: registry wiring + agent permissions"
TOOLS="asset-focus asset-progress bot-ops browser-session completion-engine content-discovery finding-produce finding-propose-chain finding-update-status graph-get-untested-endpoints graph-query-chain graph-upsert-edge graph-upsert-node hypothesis-propose js-extract mitm-ops oob-ops phase-complete scope-set telegram-native tool-catalog methodology-search tool-call-audit-get todo-coverage-check todo-honesty-check harness-self-check"
for t in $TOOLS; do
  if [[ -f "$SRC/tool/$t.ts" ]]; then pass; else fail "tool file missing: $t.ts"; continue; fi
  base="$(basename "$t")"
  if grep -q "$base" "$SRC/tool/registry.ts"; then pass; else fail "not referenced in registry.ts: $t"; fi
done
for key in asset_progress completion todo_coverage harness bot_notify_hold mitm_fuzz_endpoint todowrite; do
  if grep -q "$key:" "$SRC/agent/agent.ts"; then pass; else fail "permission key absent in agent.ts: $key"; fi
done
# question-deny lives in shared defaults: verify once globally + per-agent blocks inherit it
if grep -q 'question: "deny"' "$SRC/agent/agent.ts"; then pass; else fail "question deny missing in agent.ts defaults"; fi
for agent in coordinator recon verification reporting; do
  if grep -q "name: \"$agent\"" "$SRC/agent/agent.ts"; then pass; else fail "agent missing: $agent"; fi
done

echo "== Layer 2: prompt strength markers"
check_mark() { # file marker…
  if grep -qF "$2" "$SRC/agent/prompt/$1"; then pass; else fail "$1 missing: $2"; fi
}
check_mark coordinator.txt "ABSOLUTE RULE"
check_mark coordinator.txt "EXACTLY ONCE"
check_mark coordinator.txt "BREADTH IS MANDATORY"
check_mark coordinator.txt "ANOMALY REVIEW"
check_mark coordinator.txt "STARTUP GATE"
check_mark coordinator.txt "KNOWLEDGE LAYER"
check_mark coordinator.txt "hypothesis_coverage_check"
check_mark coordinator.txt "todo_honesty_check"
check_mark coordinator.txt "PER ENDPOINT"
check_mark recon.txt "exhaustive"
check_mark recon.txt "per skill"
check_mark verification.txt "EXACTLY per the skill"
check_mark verification.txt "RAW observables"
check_mark verification.txt "pre-approved within strict bounds"
check_mark reporting.txt "verified"
check_mark reporting.txt "human"

echo "== Layer 3: live preconditions"
ENV_FILE="${CONFIG_DIR:-$HOME/.config/opencode}/.env.bb"
if [[ -f "$ENV_FILE" ]]; then pass; else fail "no $ENV_FILE"; fi
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
  for v in SUPABASE_URL SUPABASE_SERVICE_KEY NEO4J_URI NEO4J_USER NEO4J_PASSWORD; do
    if [[ -n "${!v:-}" ]]; then pass; else fail "env $v unset"; fi
  done
  # Neo4j TCP reachability (host/port parsed from URI, no driver needed)
  NHOST="$(echo "${NEO4J_URI:-}" | sed -E 's|.*://||; s|[@].*||; s|:.*||; s|/.*||')"
  if [[ -n "${NHOST:-}" ]] && timeout 10 bash -c "</dev/tcp/$NHOST/7687" 2>/dev/null; then
    pass
  else
    fail "Neo4j TCP unreachable at ${NHOST:-unknown}:7687"
  fi
fi
SKILLS_DIR="${SKILLS_DIR:-$HOME/.config/opencode/skills}"
for s in bb-methodology web2-recon web2-vuln-classes triage-validation security-arsenal; do
  if [[ -f "$SKILLS_DIR/$s/SKILL.md" ]]; then pass; else fail "skill missing: $s (run fetch-methodology.sh)"; fi
done
if ls -d "$SKILLS_DIR"/recon-skills-* >/dev/null 2>&1; then pass; else fail "no recon-skills-* packs (run fetch-methodology.sh)"; fi
SRC_DIR="${METHODOLOGY_SOURCE_PATH:-$HOME/hacktricks}"
if [[ -d "$SRC_DIR/src" ]]; then pass; else fail "no $SRC_DIR/src (run fetch-methodology.sh)"; fi

echo
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "RESULT: NOT READY — fix the FAIL lines above, then re-run."
  exit 1
fi
echo "RESULT: TREE READY — launch via harness/scripts/run.sh, then open with harness_self_check in a fresh session."
