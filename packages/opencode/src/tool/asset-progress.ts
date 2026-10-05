import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./asset-progress.txt"
import { runReadEffect, runWriteEffect } from "./graph-db"
import { findMatchingToolCall, hostOf } from "./tool_call_audit"

// Every number returned here is computed by querying the graph directly —
// nothing is self-reported by the model. That is the structural fix for
// progress that never moved: there used to be no mechanism computing a
// real percentage at all, so the model could only narrate one.

function toNum(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value) || 0
  if (value !== null && typeof value === "object" && "toNumber" in value) {
    const fn = (value as { toNumber: unknown }).toNumber
    if (typeof fn === "function") return (fn as () => number)()
  }
  return 0
}

function progressOf(total: number, tested: number, blocked: number) {
  const percentComplete = total === 0 ? 0 : Math.round(((tested + blocked) / total) * 100)
  return {
    totalEndpoints: total,
    tested,
    blocked,
    untested: Math.max(0, total - tested - blocked),
    percentComplete,
    isComplete: total > 0 && tested + blocked >= total,
  }
}

export const SetCurrentParameters = Schema.Struct({
  programId: Schema.String,
  assetKey: Schema.String.annotate({ description: "Asset now under single focus, e.g. an Asset id / hostname" }),
  priority: Schema.optional(Schema.Number.annotate({ description: "Lower runs first in asset_get_queue" })),
})

export const AssetSetCurrentTool = Tool.define<typeof SetCurrentParameters, { currentAsset: unknown }, never>(
  "asset_set_current",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: SetCurrentParameters,
      execute: (params: Schema.Schema.Type<typeof SetCurrentParameters>, ctx: Tool.Context<{ currentAsset: unknown }>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "asset_progress", patterns: ["*"], always: ["*"], metadata: {} })
          if (!params.assetKey.trim()) throw new Error("assetKey must be non-empty")
          yield* runWriteEffect(
            `MERGE (s:SessionState {program_id: $programId})
             SET s.current_asset = $assetKey, s.current_asset_started_at = timestamp()
             RETURN s`,
            { programId: params.programId, assetKey: params.assetKey },
          )
          yield* runWriteEffect(
            `MERGE (a:Asset {id: $assetKey}) RETURN a`,
            { assetKey: params.assetKey },
          )
          if (params.priority !== undefined) {
            yield* runWriteEffect(`MATCH (a:Asset {id: $assetKey}) SET a.priority = $priority RETURN a`, {
              assetKey: params.assetKey,
              priority: params.priority,
            })
          }
          return {
            title: `current asset ${params.assetKey}`,
            output: JSON.stringify({ programId: params.programId, currentAsset: params.assetKey }),
            metadata: { currentAsset: params.assetKey },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof SetCurrentParameters, { currentAsset: unknown }>
  }),
)

export const ProgressGetParameters = Schema.Struct({
  programId: Schema.String,
  assetKey: Schema.String,
})

export const AssetProgressGetTool = Tool.define<typeof ProgressGetParameters, { percentComplete: unknown }, never>(
  "asset_progress_get",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: ProgressGetParameters,
      execute: (params: Schema.Schema.Type<typeof ProgressGetParameters>, ctx: Tool.Context<{ percentComplete: unknown }>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "asset_progress", patterns: ["*"], always: ["*"], metadata: {} })
          const qp = { assetKey: params.assetKey, programId: params.programId }
          const totalRows = yield* runReadEffect(
            `MATCH (a:Asset {id: $assetKey})-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId RETURN count(e) AS total`,
            qp,
          )
          const testedRows = yield* runReadEffect(
            `MATCH (a:Asset {id: $assetKey})-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId AND (e)-[:SUGGESTS]->(h:Hypothesis)-[:TESTED_BY]->(t:TestExecution) AND t.outcome IN ['confirmed', 'ruled_out'] RETURN count(DISTINCT e) AS tested`,
            qp,
          )
          const blockedRows = yield* runReadEffect(
            `MATCH (a:Asset {id: $assetKey})-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId AND e.blocked_reason IS NOT NULL RETURN count(e) AS blocked`,
            qp,
          )
          const findingsRows = yield* runReadEffect(
            `MATCH (a:Asset {id: $assetKey})<-[:AFFECTS]-(f:Finding) RETURN count(f) AS findings`,
            { assetKey: params.assetKey },
          )
          const hypsRows = yield* runReadEffect(
            `MATCH (a:Asset {id: $assetKey})-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId AND (e)-[:SUGGESTS]->(h:Hypothesis) AND NOT (h)-[:TESTED_BY]->(:TestExecution) RETURN count(DISTINCT h) AS open`,
            qp,
          )
          const total = toNum(totalRows[0]?.["total"])
          const tested = toNum(testedRows[0]?.["tested"])
          const blocked = toNum(blockedRows[0]?.["blocked"])
          const result = {
            assetKey: params.assetKey,
            programId: params.programId,
            ...progressOf(total, tested, blocked),
            openHypotheses: toNum(hypsRows[0]?.["open"]),
            findings: toNum(findingsRows[0]?.["findings"]),
          }
          return {
            title: `${params.assetKey} ${result.percentComplete}%`,
            output: JSON.stringify(result),
            metadata: { percentComplete: result.percentComplete },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof ProgressGetParameters, { percentComplete: unknown }>
  }),
)

export const MarkBlockerParameters = Schema.Struct({
  endpointKey: Schema.String,
  reason: Schema.String.annotate({ description: "Why this endpoint could not be tested" }),
  attemptedWorkaround: Schema.String.annotate({ description: "What was actually tried before giving up" }),
})

export const AssetMarkBlockerTool = Tool.define<typeof MarkBlockerParameters, { endpointKey: unknown }, never>(
  "asset_mark_blocker",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: MarkBlockerParameters,
      execute: (params: Schema.Schema.Type<typeof MarkBlockerParameters>, ctx: Tool.Context<{ endpointKey: unknown }>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "asset_progress", patterns: ["*"], always: ["*"], metadata: {} })
          if (params.reason.trim().length < 10)
            throw new Error("reason must be >= 10 chars — say what is actually unavailable")
          if (params.attemptedWorkaround.trim().length < 10)
            throw new Error("attemptedWorkaround must be >= 10 chars — record what was tried, not a guess")
          const epRows = yield* runReadEffect(`MATCH (e:Endpoint {id: $key}) RETURN e.program_id AS programId`, {
            key: params.endpointKey,
          })
          if (!epRows.length)
            throw new Error(`Endpoint ${params.endpointKey} is not in the graph — recon has not logged it; cannot block what was never found`)
          const epProgram = String((epRows[0] as Record<string, unknown>)["programId"] ?? "")
          const attempt = epProgram
            ? findMatchingToolCall(epProgram, hostOf(params.endpointKey), undefined, 60)
            : null
          if (!attempt)
            throw new Error(
              `No evidence anything was actually tried against ${params.endpointKey} (no tool call in the last 60 min, not even recon) — run the attempt first (signup flow, auth probe, deeper recon), then mark blocked with what happened.`,
            )
          yield* runWriteEffect(
            `MATCH (e:Endpoint {id: $endpointKey})
             SET e.blocked_reason = $reason, e.blocked_attempted_workaround = $attemptedWorkaround, e.blocked_at = timestamp()
             RETURN e`,
            {
              endpointKey: params.endpointKey,
              reason: params.reason,
              attemptedWorkaround: params.attemptedWorkaround,
            },
          )
          return {
            title: `blocked ${params.endpointKey}`,
            output: JSON.stringify({ marked: true, endpointKey: params.endpointKey }),
            metadata: { endpointKey: params.endpointKey },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof MarkBlockerParameters, { endpointKey: unknown }>
  }),
)

export const GetQueueParameters = Schema.Struct({
  programId: Schema.String,
})

export const AssetGetQueueTool = Tool.define<typeof GetQueueParameters, { queue: unknown }, never>(
  "asset_get_queue",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: GetQueueParameters,
      execute: (params: Schema.Schema.Type<typeof GetQueueParameters>, ctx: Tool.Context<{ queue: unknown }>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "asset_progress", patterns: ["*"], always: ["*"], metadata: {} })
          const qp = { programId: params.programId }
          const assetRows = yield* runReadEffect(
            `MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId RETURN a.id AS asset, a.priority AS priority, count(e) AS total`,
            qp,
          )
          const testedRows = yield* runReadEffect(
            `MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId AND (e)-[:SUGGESTS]->(h:Hypothesis)-[:TESTED_BY]->(t:TestExecution) AND t.outcome IN ['confirmed', 'ruled_out'] RETURN a.id AS asset, count(DISTINCT e) AS tested`,
            qp,
          )
          const blockedRows = yield* runReadEffect(
            `MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId AND e.blocked_reason IS NOT NULL RETURN a.id AS asset, count(e) AS blocked`,
            qp,
          )
          const currentRows = yield* runReadEffect(
            `MATCH (s:SessionState {program_id: $programId}) RETURN s.current_asset AS current`,
            qp,
          )
          const testedByAsset = new Map<string, number>()
          for (const r of testedRows) testedByAsset.set(String(r["asset"]), toNum(r["tested"]))
          const blockedByAsset = new Map<string, number>()
          for (const r of blockedRows) blockedByAsset.set(String(r["asset"]), toNum(r["blocked"]))
          const queue = assetRows
            .map((r) => {
              const assetKey = String(r["asset"])
              const total = toNum(r["total"])
              const tested = testedByAsset.get(assetKey) ?? 0
              const blocked = blockedByAsset.get(assetKey) ?? 0
              const priority = r["priority"] === null || r["priority"] === undefined ? null : toNum(r["priority"])
              return { assetKey, priority, ...progressOf(total, tested, blocked) }
            })
            .filter((a) => !a.isComplete)
            .sort((a, b) => (a.priority ?? 1e9) - (b.priority ?? 1e9) || b.untested - a.untested)
          return {
            title: `queue ${queue.length} assets`,
            output: JSON.stringify({
              programId: params.programId,
              currentAsset: currentRows[0]?.["current"] ?? null,
              queue,
            }),
            metadata: { queue },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof GetQueueParameters, { queue: unknown }>
  }),
)
