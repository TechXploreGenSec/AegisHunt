import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./finding-propose-chain.txt"
import { runWriteEffect } from "./graph-db"

export const Parameters = Schema.Struct({
  fromFindingId: Schema.String,
  toFindingId: Schema.String,
  rationale: Schema.String,
})

type Metadata = { chained: unknown; proposed: unknown }

export const FindingProposeChainTool = Tool.define<typeof Parameters, Metadata, never>(
  "finding_propose_chain",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "finding", patterns: ["*"], always: ["*"], metadata: {} })
          if (params.rationale.trim().length < 20) throw new Error("rationale must be >= 20 chars")
          yield* runWriteEffect(
            `MATCH (a:Finding {id: $fromFindingId}) MATCH (b:Finding {id: $toFindingId}) MERGE (a)-[r:CHAINS_TO]->(b) SET r.rationale = $rationale, r.proposed = true RETURN r`,
            { fromFindingId: params.fromFindingId, toFindingId: params.toFindingId, rationale: params.rationale },
          )
          return {
            title: `chain ${params.fromFindingId} -> ${params.toFindingId}`,
            output: JSON.stringify({ chained: true, proposed: true }),
            metadata: { chained: true, proposed: true },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
