import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./finding-produce.txt"
import { runWriteEffect, runReadEffect } from "./graph-db"

export const Parameters = Schema.Struct({
  testExecutionId: Schema.String,
  severity: Schema.Literals(["info", "low", "medium", "high", "critical"]),
  affectsAssetKey: Schema.String,
  summary: Schema.String,
})

type Metadata = { findingId: unknown; status: unknown }

export const FindingProduceTool = Tool.define<typeof Parameters, Metadata, never>(
  "finding_produce",
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
            metadata: { testExecutionId: params.testExecutionId },
          })
          if (params.summary.trim().length < 20) throw new Error("summary must be >= 20 chars")
          const rows = yield* runReadEffect(`MATCH (t:TestExecution {id: $id}) RETURN t`, {
            id: params.testExecutionId,
          })
          if (!rows[0]) throw new Error(`TestExecution ${params.testExecutionId} not found`)
          const outcome = (rows[0]?.t as { properties?: { outcome?: string } } | undefined)?.properties?.outcome
          if (outcome && outcome !== "confirmed")
            throw new Error(`TestExecution outcome was '${outcome}', not 'confirmed'`)
          const findingId = crypto.randomUUID()
          yield* runWriteEffect(
            `MERGE (f:Finding {id: $findingId}) SET f.severity = $severity, f.summary = $summary, f.status = 'unreported', f.human_reviewed = false, f.created_at = timestamp() RETURN f`,
            { findingId, severity: params.severity, summary: params.summary },
          )
          yield* runWriteEffect(
            `MATCH (t:TestExecution {id: $testId}) MATCH (f:Finding {id: $findingId}) MERGE (t)-[:PRODUCED]->(f)`,
            { testId: params.testExecutionId, findingId },
          )
          yield* runWriteEffect(
            `MATCH (a:Asset {id: $assetKey}) MATCH (f:Finding {id: $findingId}) MERGE (f)-[:AFFECTS]->(a)`,
            { assetKey: params.affectsAssetKey, findingId },
          )
          return {
            title: `finding ${findingId}`,
            output: JSON.stringify({ findingId, status: "unreported" }),
            metadata: { findingId, status: "unreported" },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
