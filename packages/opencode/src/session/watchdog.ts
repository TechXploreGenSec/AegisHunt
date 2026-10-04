// Session-idle watchdog — host-level, NOT a tool. Every enforcement gate
// built so far fires when the model TRIES something disallowed. None of
// them fire when the model simply stops: ends its turn with a tidy summary
// while work remains. This subscribes to the real session.idle event and,
// for bug-bounty sessions only, resumes the run with an injected
// continuation — or stays silent when stopping is legitimate.
//
// Resumption is NOT persuasion: the injected message orders specific next
// actions (next todowrite batch, or bot_notify_hold which refuses loudly
// with the remaining work if the model is wrong about being done).
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Exit, Layer, Scope } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { runReadEffect } from "@/tool/graph-db"

const NUDGE_PREFIX = "[watchdog-resume]"
const MAX_CONSECUTIVE_NUDGES = 3
const RECENT_MESSAGES = 20

interface Breaker {
  nudges: number
  toolParts: number
}

const breaker = new Map<string, Breaker>()

function toNum(value: unknown): number {
  if (typeof value === "number") return value
  if (value !== null && typeof value === "object" && "toNumber" in value) {
    const fn = (value as { toNumber: unknown }).toNumber
    if (typeof fn === "function") return (fn as () => number)()
  }
  return 0
}

function safeJson(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

type CompletedTool = SessionV1.ToolPart & { state: SessionV1.ToolStateCompleted }

const isCompletedTool = (p: SessionV1.Part): p is CompletedTool =>
  p.type === "tool" && p.state.status === "completed"

const incompleteAssetsEffect = (programId: string) =>
  Effect.gen(function* () {
    const qp = { programId }
    const assetRows = yield* runReadEffect(
      `MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId RETURN a.id AS asset, count(e) AS total`,
      qp,
    )
    if (!assetRows.length) return { total: 0, incomplete: [] as Array<{ asset: string; left: number }> }
    const testedRows = yield* runReadEffect(
      `MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId AND (e)-[:SUGGESTS]->(:Hypothesis)-[:TESTED_BY]->(:TestExecution) RETURN a.id AS asset, count(DISTINCT e) AS tested`,
      qp,
    )
    const blockedRows = yield* runReadEffect(
      `MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId AND e.blocked_reason IS NOT NULL RETURN a.id AS asset, count(e) AS blocked`,
      qp,
    )
    const num = (r: Record<string, unknown>, k: string): number => toNum(r[k])
    const testedBy = new Map<string, number>()
    for (const r of testedRows) testedBy.set(String((r as Record<string, unknown>)["asset"]), num(r as Record<string, unknown>, "tested"))
    const blockedBy = new Map<string, number>()
    for (const r of blockedRows) blockedBy.set(String((r as Record<string, unknown>)["asset"]), num(r as Record<string, unknown>, "blocked"))
    const incomplete = assetRows
      .map((r) => {
        const asset = String((r as Record<string, unknown>)["asset"])
        const total = num(r as Record<string, unknown>, "total")
        return { asset, left: total - (testedBy.get(asset) ?? 0) - (blockedBy.get(asset) ?? 0) }
      })
      .filter((a) => a.left > 0)
    return { total: assetRows.length, incomplete }
  })

const currentAssetEffect = (programId: string) =>
  Effect.gen(function* () {
    const rows = yield* runReadEffect(`MATCH (s:SessionState {program_id: $programId}) RETURN s.current_asset AS current`, {
      programId,
    })
    const current = rows[0] ? (rows[0] as Record<string, unknown>)["current"] : null
    return typeof current === "string" && current ? current : null
  })

const handleIdleEffect = (session: Session.Interface, promptSvc: SessionPrompt.Interface, sessionID: string) =>
  Effect.gen(function* () {
    const messages = yield* session
      .messages({ sessionID: sessionID as never, limit: RECENT_MESSAGES })
      .pipe(Effect.orElseSucceed(() => [] as SessionV1.WithParts[]))
    const completed: CompletedTool[] = []
    for (const m of messages) {
      for (const p of m.parts) {
        if (isCompletedTool(p)) completed.push(p)
      }
    }
    if (!completed.length) return

    // 1. Legitimate stop: a SUCCESSFUL hold happened recently.
    for (const p of completed) {
      if (p.tool !== "bot_notify_hold") continue
      if (safeJson(p.state.output)?.["sent"] === true) {
        breaker.delete(sessionID)
        return
      }
    }

    // 2. Not a bug-bounty session (no program context anywhere)? Stay out.
    let programId: string | null = null
    let assetKey: string | null = null
    for (let i = completed.length - 1; i >= 0; i--) {
      const p = completed[i]
      const input = p.state.input as Record<string, unknown>
      const output = safeJson(p.state.output) ?? {}
      if (p.tool === "asset_set_current" && typeof output["programId"] === "string") {
        programId = output["programId"]
        if (typeof output["currentAsset"] === "string") assetKey = output["currentAsset"]
        break
      }
      if (p.tool === "asset_focus" && typeof input["programId"] === "string") {
        programId = input["programId"] as string
        if (typeof input["host"] === "string") assetKey = input["host"] as string
        break
      }
      if (p.tool === "asset_progress_get" && typeof output["programId"] === "string") {
        programId = output["programId"] as string
        if (typeof output["assetKey"] === "string") assetKey = output["assetKey"] as string
        break
      }
      if (p.tool === "asset_get_queue" && typeof output["programId"] === "string") {
        programId = output["programId"] as string
        if (typeof output["currentAsset"] === "string") assetKey = output["currentAsset"] as string
        break
      }
      if (p.tool === "scope_set" && typeof output["programId"] === "string") {
        programId = output["programId"] as string
      }
    }
    if (!programId) return
    if (!assetKey) assetKey = yield* currentAssetEffect(programId)
    if (!assetKey) return

    // 3. Circuit breaker: no new tool activity across consecutive nudges.
    const prev = breaker.get(sessionID)
    const nudges = prev && prev.toolParts === completed.length ? prev.nudges + 1 : 1
    if (nudges > MAX_CONSECUTIVE_NUDGES) return
    breaker.set(sessionID, { nudges, toolParts: completed.length })

    // 4. Real state, not the turn's narrative.
    const queue = yield* incompleteAssetsEffect(programId)
    const mine = queue.incomplete.find((a) => a.asset === assetKey)
    if (!mine && queue.incomplete.length === 0) {
      breaker.delete(sessionID)
      return
    }
    const left = mine ? mine.left : 0

    // 5. Resume with orders, not suggestions.
    const text =
      `${NUDGE_PREFIX} Session went idle with work remaining and no successful bot_notify_hold this turn ` +
      `(program ${programId}, asset ${assetKey}: ${left} endpoints untested, ${queue.incomplete.length} assets incomplete). ` +
      `Resume immediately with the next batch from todowrite — do not end the turn with a summary. ` +
      `If you believe nothing remains, prove it by calling bot_notify_hold (it refuses with specifics if you are wrong).`
    yield* promptSvc
      .prompt({
        sessionID: sessionID as never,
        parts: [{ type: "text", text }],
      })
      .pipe(Effect.ignore)
  })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const session = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void).pipe(Effect.ignore))
    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== SessionStatusEvent.Idle.type) return Effect.void
      const data = event.data as { sessionID: string }
      return handleIdleEffect(session, promptSvc, data.sessionID).pipe(
        Effect.ignore,
        Effect.forkIn(scope),
        Effect.asVoid,
      )
    })
    yield* Effect.addFinalizer(() => unsubscribe.pipe(Effect.ignore))
  }),
)

export const node = LayerNode.make({
  name: "SessionWatchdog",
  layer,
  deps: [EventV2Bridge.node, Session.node, SessionPrompt.node],
})

export * as SessionWatchdog from "./watchdog"
