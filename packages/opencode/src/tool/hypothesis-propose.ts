import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./hypothesis-propose.txt"
import { runWriteEffect, runReadEffect } from "./graph-db"
import { scopeExclusions } from "./scope-gate"
import { VULN_CLASSES } from "./vuln-classes"

export const Parameters = Schema.Struct({
  programId: Schema.String,
  vulnClass: Schema.Literals(VULN_CLASSES),
  attachToLabel: Schema.Literals(["Endpoint", "Parameter"]),
  attachToKey: Schema.String,
  attachToKeyField: Schema.optional(Schema.String),
  rationale: Schema.String,
  methodologySource: Schema.String.annotate({
    description: "REQUIRED: the methodology pattern, skill checklist, or HackTricks section this hypothesis comes from — grounding that stops familiar-only guessing. Min 10 chars.",
  }),
  expectedPositiveSignal: Schema.String.annotate({
    description: "What a CONFIRMED result would actually look like — specific and observable. Pre-registered before testing to stop post-hoc rationalization.",
  }),
  expectedNegativeSignal: Schema.String.annotate({
    description: "What a RULED-OUT result would look like — equally specific.",
  }),
  fingerprintRefs: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Implementation choices this hypothesis combines (ORM, validation lib, session store, auth mechanism, deployment detail...). REQUIRED with >=2 entries when vulnClass is 'other'.",
  }),
  triageVerdict: Schema.optional(Schema.Literals(["ACCEPT", "CONDITIONAL", "REJECT"])).annotate({
    description: "Mentor's bounty pre-mortem. REJECT files a persistent kill (status 'killed'): it satisfies coverage, is excluded from completion demands, and is never re-briefed.",
  }),
  severity: Schema.optional(Schema.Literals(["info", "low", "medium", "high", "critical"])).annotate({
    description: "Estimated bounty severity for prioritization.",
  }),
  verdictReason: Schema.optional(Schema.String).annotate({
    description: "REQUIRED when triageVerdict is REJECT: the one-line kill reason (which exclusion, why unprovable, or why destructive-only).",
  }),
})

type Metadata = { hypothesisId: unknown; status: unknown }

export const HypothesisProposeTool = Tool.define<typeof Parameters, Metadata, never>(
  "hypothesis_propose",
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
            metadata: { vulnClass: params.vulnClass },
          })
          if (params.rationale.trim().length < 20)
            throw new Error("rationale must be >= 20 chars — cite methodology pattern, not a guess")
          const isKill = params.triageVerdict === "REJECT"
          if (isKill && (!params.verdictReason || params.verdictReason.trim().length < 10))
            throw new Error("triageVerdict REJECT requires verdictReason >= 10 chars — the one-line kill reason triage would give")
          if (!isKill) {
            if (params.expectedPositiveSignal.trim().length < 15)
              throw new Error("expectedPositiveSignal must be >= 15 chars — say what you would actually observe")
            if (params.expectedNegativeSignal.trim().length < 15)
              throw new Error("expectedNegativeSignal must be >= 15 chars — say what ruling out looks like")
            if (!params.methodologySource || params.methodologySource.trim().length < 10)
              throw new Error("methodologySource is REQUIRED (>= 10 chars) — every hypothesis must ground in a methodology pattern, skill, or HackTricks section")
          }
          if (scopeExclusions(params.programId).excluded.includes(params.vulnClass))
            throw new Error(`vulnClass '${params.vulnClass}' is program-excluded for ${params.programId} — proposing it wastes a cycle triage will reject; pick a covered class or another endpoint`)
          const refs = (params.fingerprintRefs ?? []).map((r) => r.trim()).filter(Boolean)
          if (params.vulnClass === "other" && !isKill) {
            if (refs.length < 2)
              throw new Error("vulnClass 'other' requires fingerprintRefs with >= 2 implementation choices being combined — weirdness must be anchored, not free-floating")
            if (params.rationale.trim().length < 60)
              throw new Error("vulnClass 'other' requires rationale >= 60 chars — explain the specific combination and why it fails")
          }
          const hypothesisId = crypto.randomUUID()
          const attachField = params.attachToKeyField ?? "id"
          // Attach target must exist — otherwise this hypothesis orphans and
          // silently never counts toward any endpoint's coverage.
          const attachCheck = yield* runReadEffect(
            `MATCH (a:${params.attachToLabel} {${attachField}: $attachToKey}) RETURN a LIMIT 1`,
            { attachToKey: params.attachToKey },
          )
          if (!attachCheck.length)
            throw new Error(
              `Attach target not in graph: ${params.attachToLabel} ${attachField}=${params.attachToKey} — recon has not logged it (or the key is wrong). Log it first, then propose.`,
            )
          const status = isKill ? "killed" : "open"
          yield* runWriteEffect(
            `MERGE (h:Hypothesis {id: $hypothesisId}) SET h.vuln_class = $vulnClass, h.rationale = $rationale, h.methodology_source = $methodologySource, h.expected_positive_signal = $expectedPositive, h.expected_negative_signal = $expectedNegative, h.fingerprint_refs = $fingerprintRefs, h.triage_verdict = $triageVerdict, h.severity = $severity, h.verdict_reason = $verdictReason, h.status = $status, h.program_id = $programId, h.created_at = timestamp() RETURN h`,
            {
              hypothesisId,
              vulnClass: params.vulnClass,
              rationale: params.rationale,
              methodologySource: params.methodologySource ?? null,
              expectedPositive: params.expectedPositiveSignal,
              expectedNegative: params.expectedNegativeSignal,
              fingerprintRefs: (params.fingerprintRefs ?? []).map((r) => r.trim()).filter(Boolean),
              triageVerdict: params.triageVerdict ?? null,
              severity: params.severity ?? null,
              verdictReason: params.verdictReason ?? null,
              status,
              programId: params.programId,
            },
          )
          yield* runWriteEffect(
            `MATCH (a:${params.attachToLabel} {${attachField}: $attachToKey}) MATCH (h:Hypothesis {id: $hypothesisId}) MERGE (a)-[r:SUGGESTS]->(h) RETURN r`,
            { attachToKey: params.attachToKey, hypothesisId },
          )
          return {
            title: isKill ? `kill ${hypothesisId}` : `hypothesis ${hypothesisId}`,
            output: JSON.stringify({ hypothesisId, status }),
            metadata: { hypothesisId, status },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
