import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./finding-produce.txt"
import { runWriteEffect, runReadEffect } from "./graph-db"
import { scopeExclusions } from "./scope-gate"
import { isVulnClass } from "./vuln-classes"

export const Parameters = Schema.Struct({
  testExecutionId: Schema.String,
  severity: Schema.Literals(["info", "low", "medium", "high", "critical"]),
  affectsAssetKey: Schema.String,
  summary: Schema.String,
  impactEvidence: Schema.optional(Schema.String).annotate({
    description:
      "REQUIRED when the finding's vuln class is program-marked impact-sensitive: concrete demonstrated business impact (what was read/done, whose data, with what effect) — not what it 'could lead to'. Min 40 chars.",
  }),
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
          const clsRows = yield* runReadEffect(
            `MATCH (t:TestExecution {id: $id})<-[:TESTED_BY]-(h:Hypothesis) RETURN h.vuln_class AS vc, h.program_id AS programId`,
            { id: params.testExecutionId },
          )
          const cls = String((clsRows[0] as Record<string, unknown> | undefined)?.["vc"] ?? "")
          const clsProgram = String((clsRows[0] as Record<string, unknown> | undefined)?.["programId"] ?? "")
          const excl = scopeExclusions(clsProgram)
          if (cls && excl.excluded.includes(cls))
            throw new Error(`vulnClass '${cls}' is program-excluded for ${clsProgram} — triage rejects this class outright; do not report it`)
          // Enum guard: findings for invented classes (e.g. impact labels
          // like 'privilege-escalation') break coverage/score joins, which
          // only understand the shared taxonomy. Impact goes in
          // severity/summary, never in the class slot.
          if (cls && !isVulnClass(cls))
            throw new Error(`vulnClass '${cls}' is not in the shared taxonomy — map it to a real detection class (mass-assignment, auth-bypass, access-control, ...) and put the impact in severity/summary`)
          const isSensitive = cls !== "" && excl.sensitive.includes(cls)
          // Mechanical sensitive gate (not prompt-only): a sensitive class
          // produces NOTHING without attached concrete impact evidence.
          const impact = (params.impactEvidence ?? "").trim()
          if (isSensitive && impact.length < 40)
            throw new Error(
              `Program marks '${cls}' as impact-sensitive: finding_produce refuses without impactEvidence >= 40 chars of DEMONSTRATED business impact (what was read/done, whose data, with what effect — never 'could lead to'). Test further or abandon.`,
            )
          const sensitivityWarning = isSensitive
            ? `Program marks '${cls}' as impact-sensitive: triage demands proven business impact. Report ONLY with concrete impact evidence attached.`
            : null
          const findingId = crypto.randomUUID()
          yield* runWriteEffect(
            `MERGE (f:Finding {id: $findingId}) SET f.severity = $severity, f.summary = $summary, f.impact_evidence = $impactEvidence, f.status = 'unreported', f.human_reviewed = false, f.sensitivity_warning = $sensitivityWarning, f.created_at = timestamp() RETURN f`,
            { findingId, severity: params.severity, summary: params.summary, impactEvidence: impact || null, sensitivityWarning: sensitivityWarning },
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
            output: JSON.stringify({
              findingId,
              status: "unreported",
              ...(sensitivityWarning ? { sensitivityWarning } : {}),
            }),
            metadata: { findingId, status: "unreported" },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
