import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./test-execution-record.txt"
import { runWriteEffect, runReadEffect } from "./graph-db"
import { findMatchingToolCall } from "./tool_call_audit"

export const Parameters = Schema.Struct({
  hypothesisId: Schema.String,
  toolUsed: Schema.String,
  whatWasTried: Schema.String,
  evidenceRef: Schema.optional(Schema.String),
  outcome: Schema.Literals(["confirmed", "inconclusive", "ruled_out"]),
  matchedPrediction: Schema.Literals(["positive", "negative", "neither"]).annotate({
    description: "Which pre-registered prediction this result matched. 'neither' is an honest inconclusive — it maps to outcome inconclusive.",
  }),
})

type Metadata = { testExecutionId: unknown; outcome: unknown; canProduceFinding: unknown }

export const TestExecutionRecordTool = Tool.define<typeof Parameters, Metadata, never>(
  "test_execution_record",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "finding",
            patterns: ["*"],
            always: ["*"],
            metadata: { hypothesisId: params.hypothesisId },
          })
          if (params.whatWasTried.trim().length < 20) throw new Error("whatWasTried must be >= 20 chars")
          if (params.matchedPrediction === "neither" && params.outcome !== "inconclusive")
            throw new Error("matchedPrediction 'neither' must pair with outcome 'inconclusive' — do not force it into confirmed/ruled_out")
          // Audit gate: the claimed test must be backed by a real, recent
          // tool invocation against the hypothesis target — or an OOB
          // plant naming this hypothesis (blind vulns).
          const epRows = yield* runReadEffect(
            `MATCH (e:Endpoint)-[:SUGGESTS]->(h:Hypothesis {id: $id}) RETURN e.url AS url, h.program_id AS programId`,
            { id: params.hypothesisId },
          )
          const paramRows =
            epRows.length === 0
              ? yield* runReadEffect(
                  `MATCH (e:Endpoint)-[:HAS_PARAMETER]->(p:Parameter)-[:SUGGESTS]->(h:Hypothesis {id: $id}) RETURN e.url AS url, h.program_id AS programId`,
                  { id: params.hypothesisId },
                )
              : []
          const anchor = epRows[0] ?? paramRows[0]
          const targetUrl = (anchor as Record<string, unknown> | undefined)?.["url"] as string | undefined
          const hypProgram = (anchor as Record<string, unknown> | undefined)?.["programId"] as string | undefined
          const hRows = yield* runReadEffect(`MATCH (h:Hypothesis {id: $id}) RETURN h.program_id AS programId`, {
            id: params.hypothesisId,
          })
          const programId = hypProgram ?? ((hRows[0] as Record<string, unknown> | undefined)?.["programId"] as string | undefined)
          if (!programId) throw new Error(`Hypothesis ${params.hypothesisId} not found`)
          const backing = targetUrl
            ? findMatchingToolCall(programId, targetUrl, params.hypothesisId)
            : findMatchingToolCall(programId, params.hypothesisId, params.hypothesisId)
          if (!backing) {
            throw new Error(
              `No recent tool call backs this test${targetUrl ? ` against ${targetUrl}` : ""} — test_execution_record requires evidence a live-target tool was actually used (browser_navigate, mitm_replay_flow, content_discovery, oob_plant_payload, …) within the last 15 minutes. Run the actual test first.`,
            )
          }
          const rows = yield* runReadEffect(`MATCH (h:Hypothesis {id: $id}) RETURN h`, {
            id: params.hypothesisId,
          })
          const status = (rows[0]?.h as { properties?: { status?: string } } | undefined)?.properties?.status
          // runRead returns toObject() shapes; be tolerant to driver variants
          const current = status ?? (rows[0] as Record<string, unknown>)?.["h.status"] ?? "open"
          if (current !== "open") throw new Error(`Hypothesis ${params.hypothesisId} is not open (status: ${current})`)
          const testId = crypto.randomUUID()
          yield* runWriteEffect(
            `MERGE (t:TestExecution {id: $testId}) SET t.tool_used = $toolUsed, t.what_was_tried = $whatWasTried, t.evidence_ref = $evidenceRef, t.outcome = $outcome, t.matched_prediction = $matchedPrediction, t.evidence_tool_call_id = $evidenceCallId, t.executed_at = timestamp() RETURN t`,
            {
              testId,
              toolUsed: params.toolUsed,
              whatWasTried: params.whatWasTried,
              evidenceRef: params.evidenceRef ?? null,
              outcome: params.outcome,
              matchedPrediction: params.matchedPrediction,
              evidenceCallId: backing.id,
            },
          )
          yield* runWriteEffect(
            `MATCH (h:Hypothesis {id: $hypothesisId}) MATCH (t:TestExecution {id: $testId}) MERGE (h)-[r:TESTED_BY]->(t) RETURN r`,
            { hypothesisId: params.hypothesisId, testId },
          )
          if (params.outcome === "ruled_out") {
            yield* runWriteEffect(`MATCH (h:Hypothesis {id: $id}) SET h.status = 'closed_negative' RETURN h`, {
              id: params.hypothesisId,
            })
          }
          const canProduceFinding = params.outcome === "confirmed"
          return {
            title: `test ${testId} ${params.outcome}`,
            output: JSON.stringify({ testExecutionId: testId, outcome: params.outcome, canProduceFinding, evidenceToolCallId: backing.id }),
            metadata: { testExecutionId: testId, outcome: params.outcome, canProduceFinding },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
