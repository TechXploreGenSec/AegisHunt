import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./hypothesis-propose.txt"
import { runWriteEffect } from "./graph-db"

export const Parameters = Schema.Struct({
  programId: Schema.String,
  vulnClass: Schema.Literals([
    "idor",
    "ssrf",
    "auth-bypass",
    "injection",
    "xss",
    "business-logic",
    "access-control",
    "info-disclosure",
    "rce",
    "other",
  ]),
  attachToLabel: Schema.Literals(["Endpoint", "Parameter"]),
  attachToKey: Schema.String,
  attachToKeyField: Schema.optional(Schema.String),
  rationale: Schema.String,
  methodologySource: Schema.optional(Schema.String),
  expectedPositiveSignal: Schema.String.annotate({
    description: "What a CONFIRMED result would actually look like — specific and observable. Pre-registered before testing to stop post-hoc rationalization.",
  }),
  expectedNegativeSignal: Schema.String.annotate({
    description: "What a RULED-OUT result would look like — equally specific.",
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
          if (params.expectedPositiveSignal.trim().length < 15)
            throw new Error("expectedPositiveSignal must be >= 15 chars — say what you would actually observe")
          if (params.expectedNegativeSignal.trim().length < 15)
            throw new Error("expectedNegativeSignal must be >= 15 chars — say what ruling out looks like")
          if (params.rationale.trim().length < 20)
            throw new Error("rationale must be >= 20 chars — cite methodology pattern, not a guess")
          const hypothesisId = crypto.randomUUID()
          const attachField = params.attachToKeyField ?? "id"
          yield* runWriteEffect(
            `MERGE (h:Hypothesis {id: $hypothesisId}) SET h.vuln_class = $vulnClass, h.rationale = $rationale, h.methodology_source = $methodologySource, h.expected_positive_signal = $expectedPositive, h.expected_negative_signal = $expectedNegative, h.status = 'open', h.program_id = $programId, h.created_at = timestamp() RETURN h`,
            {
              hypothesisId,
              vulnClass: params.vulnClass,
              rationale: params.rationale,
              methodologySource: params.methodologySource ?? null,
              expectedPositive: params.expectedPositiveSignal,
              expectedNegative: params.expectedNegativeSignal,
              programId: params.programId,
            },
          )
          yield* runWriteEffect(
            `MATCH (a:${params.attachToLabel} {${attachField}: $attachToKey}) MATCH (h:Hypothesis {id: $hypothesisId}) MERGE (a)-[r:SUGGESTS]->(h) RETURN r`,
            { attachToKey: params.attachToKey, hypothesisId },
          )
          return {
            title: `hypothesis ${hypothesisId}`,
            output: JSON.stringify({ hypothesisId, status: "open" }),
            metadata: { hypothesisId, status: "open" },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
