import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./graph-get-untested-endpoints.txt"
import { runReadEffect } from "./graph-db"

export const Parameters = Schema.Struct({
  programId: Schema.String,
  limit: Schema.optional(Schema.Number),
})

type Metadata = { untestedEndpoints: unknown }

export const GraphGetUntestedEndpointsTool = Tool.define<typeof Parameters, Metadata, never>(
  "graph_get_untested_endpoints",
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
            metadata: { programId: params.programId },
          })
          const limit = Math.min(Math.max(Math.round(params.limit ?? 20), 1), 100)
          const rows = yield* runReadEffect(
            `MATCH (e:Endpoint) WHERE NOT (e)-[:SUGGESTS]->(:Hypothesis) RETURN e.url AS untested_endpoint LIMIT $limit`,
            { limit },
          )
          const list = rows.map((r) => (r as Record<string, unknown>).untested_endpoint)
          return {
            title: `${list.length} untested endpoints`,
            output: JSON.stringify(list),
            metadata: { untestedEndpoints: list },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
