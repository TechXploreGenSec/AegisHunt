#!/usr/bin/env bash
# session_watchdog.sh — external polling watchdog for opencode bug-bounty sessions.
#
# Complements the in-process watchdog (packages/opencode/src/session/watchdog.ts,
# subscribed to the real session.idle event). Use THIS when you want a visible
# loop in its own terminal, or when driving sessions across process restarts.
#
# Every server call below is taken verbatim from the real API surface
# (packages/opencode/src/server/routes/instance/httpapi/groups/session.ts
# SessionPaths) — no guessed commands:
#   GET  /session/status                  -> {sessionID: {type: "idle"|...}}
#   GET  /session/:id/message?limit=N      -> [{info, parts[]}] (tool parts carry state/output)
#   POST /session/:id/prompt_async {parts} -> fire-and-forget turn (does not block polling)
#
# Requires: opencode serve running (e.g. `opencode serve --port 4096`),
#   jq, python3 with the neo4j driver (pip install neo4j), and env with
#   NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD / NEO4J_DATABASE
#   (source ~/.config/opencode/.env.bb first).
# Optional: SERVER_USER / SERVER_PASSWORD for basic auth if serve requires it.
#
# Usage:
#   session_watchdog.sh --server http://127.0.0.1:4096 --session ses_XXX \
#     --program bb-example-2026-10-04 [--asset app.example.com] \
#     [--interval 90] [--max-nudges 3]
set -euo pipefail

SERVER="http://127.0.0.1:4096"
SESSION=""
PROGRAM=""
ASSET=""
INTERVAL=90
MAX_NUDGES=3

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --session) SESSION="$2"; shift 2 ;;
    --program) PROGRAM="$2"; shift 2 ;;
    --asset) ASSET="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --max-nudges) MAX_NUDGES="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$SESSION" && -n "$PROGRAM" ]] || { echo "Usage: $0 --server URL --session SES --program PROG [--asset HOST] [--interval S] [--max-nudges N]" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 required" >&2; exit 2; }
python3 -c "import neo4j" 2>/dev/null || { echo "python neo4j driver required: pip install neo4j" >&2; exit 2; }

AUTH=()
if [[ -n "${SERVER_PASSWORD:-}" ]]; then AUTH=(-u "${SERVER_USER:-opencode}:${SERVER_PASSWORD}"); fi

NUDGES=0
LAST_TOOL_COUNT=-1

graph_check() {
  # Prints: INCOMPLETE=<n> LEFT=<m>  (assets incomplete / untested left on ASSET)
  python3 - "$PROGRAM" "$ASSET" <<'PYEOF'
import json, os, sys
from neo4j import GraphDatabase
program, asset = sys.argv[1], (sys.argv[2] or None)
drv = GraphDatabase.driver(
    os.environ["NEO4J_URI"],
    auth=(os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"]),
    database=os.environ.get("NEO4J_DATABASE"),
)
def num(v):
    return v.to_number() if hasattr(v, "to_number") else int(v or 0)
with drv.session() as s:
    totals = {r["asset"]: num(r["total"]) for r in s.run(
        "MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $p RETURN a.id AS asset, count(e) AS total",
        p=program)}
    tested = {r["asset"]: num(r["tested"]) for r in s.run(
        "MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $p "
        "AND (e)-[:SUGGESTS]->(:Hypothesis)-[:TESTED_BY]->(:TestExecution) "
        "RETURN a.id AS asset, count(DISTINCT e) AS tested", p=program)}
    blocked = {r["asset"]: num(r["blocked"]) for r in s.run(
        "MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $p "
        "AND e.blocked_reason IS NOT NULL RETURN a.id AS asset, count(e) AS blocked", p=program)}
left_map = {a: t - tested.get(a, 0) - blocked.get(a, 0) for a, t in totals.items()}
incomplete = sum(1 for v in left_map.values() if v > 0)
left = left_map.get(asset, 0) if asset else 0
print(f"INCOMPLETE={incomplete} LEFT={left}")
PYEOF
}

echo "$(date '+%F %T'): watchdog armed — session=$SESSION program=$PROGRAM asset=${ASSET:-<queue>} every=${INTERVAL}s"
while true; do
  sleep "$INTERVAL"

  # 1. idle? (GET /session/status)
  TYPE=$(curl -s --max-time 15 "${AUTH[@]}" "$SERVER/session/status" | jq -r --arg s "$SESSION" '.[$s].type // "unknown"')
  [[ "$TYPE" == "idle" ]] || continue

  # 2. recent parts (GET /session/:id/message?limit=15)
  MSGS=$(curl -s --max-time 20 "${AUTH[@]}" "$SERVER/session/$SESSION/message?limit=15")

  # 3. successful hold anywhere recent = legitimate stop, exit.
  if echo "$MSGS" | jq -e '[.[] | .parts[]? | select(.type=="tool" and .tool=="bot_notify_hold" and .state.status=="completed") | .state.output | fromjson? | select(.sent==true)] | length > 0' >/dev/null; then
    echo "$(date '+%F %T'): successful bot_notify_hold found — legitimate stop, watchdog exiting"
    exit 0
  fi

  # 4. breaker: no new completed tool calls across consecutive nudges.
  TOOL_COUNT=$(echo "$MSGS" | jq '[.[] | .parts[]? | select(.type=="tool" and .state.status=="completed")] | length')
  if [[ "$TOOL_COUNT" == "$LAST_TOOL_COUNT" ]]; then
    NUDGES=$((NUDGES + 1))
  else
    NUDGES=0
  fi
  LAST_TOOL_COUNT="$TOOL_COUNT"
  if [[ "$NUDGES" -ge "$MAX_NUDGES" ]]; then
    echo "$(date '+%F %T'): $MAX_NUDGES consecutive nudges with zero new tool calls — stalled, watchdog exiting (raise --max-nudges to keep going)"
    exit 0
  fi

  # 5. real state, not the turn's narrative (direct Neo4j, same queries as asset_progress_get).
  eval "$(graph_check)"
  if [[ "${INCOMPLETE:-1}" == "0" ]]; then
    echo "$(date '+%F %T'): queue empty — legitimate stop, watchdog exiting"
    exit 0
  fi

  # 6. resume: fire-and-forget turn (POST /session/:id/prompt_async — returns immediately).
  NUDGE="[watchdog-resume] Session idle with work remaining and no successful bot_notify_hold (program $PROGRAM, asset ${ASSET:-?}: ${LEFT:-?} endpoints untested, ${INCOMPLETE} assets incomplete). Resume immediately with the next todowrite batch — do not end the turn with a summary. If you believe nothing remains, prove it by calling bot_notify_hold (it refuses with specifics if you are wrong)."
  BODY=$(jq -n --arg t "$NUDGE" '{parts:[{type:"text", text:$t}]}')
  curl -s --max-time 20 "${AUTH[@]}" -X POST "$SERVER/session/$SESSION/prompt_async" \
    -H 'Content-Type: application/json' -d "$BODY" >/dev/null
  NUDGES=$((NUDGES + 1))
  echo "$(date '+%F %T'): nudged (incomplete=$INCOMPLETE left=$LEFT nudge=$NUDGES/$MAX_NUDGES)"
done
