import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./graph-query-chain.txt"
import { runReadEffect } from "./graph-db"

export const Parameters = Schema.Struct({
  startFindingId: Schema.String,
  maxHops: Schema.optional(Schema.Number),
})

type Metadata = { paths: unknown }

export const GraphQueryChainTool = Tool.define<typeof Parameters, Metadata, never>(
  "graph_query_chain",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "graph",
            patterns: ["*"],
            always: ["*"],
            metadata: { startFindingId: params.startFindingId },
          })
          const hops = Math.min(Math.max(Math.round(params.maxHops ?? 4), 1), 6)
          const rows = yield* runReadEffect(
            `MATCH path = (start:Finding {id: $startFindingId})-[:CHAINS_TO*1..${hops}]->(end:Finding) RETURN path ORDER BY length(path) DESC LIMIT 20`,
            { startFindingId: params.startFindingId },
          )
          return {
            title: `chain from ${params.startFindingId}`,
            output: JSON.stringify(rows),
            metadata: { paths: rows },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
