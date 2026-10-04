import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./graph-upsert-edge.txt"
import { runWriteEffect } from "./graph-db"

export const Parameters = Schema.Struct({
  fromLabel: Schema.Literals(["Program", "Asset", "Endpoint", "Parameter", "Credential", "TechStack"]),
  fromKey: Schema.String,
  fromKeyField: Schema.optional(Schema.String),
  toLabel: Schema.Literals(["Program", "Asset", "Endpoint", "Parameter", "Credential", "TechStack"]),
  toKey: Schema.String,
  toKeyField: Schema.optional(Schema.String),
  type: Schema.Literals(["IN_SCOPE", "EXPOSES", "RUNS", "HAS_PARAMETER", "PROTECTED_BY"]),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

type Metadata = { edge: unknown }

export const GraphUpsertEdgeTool = Tool.define<typeof Parameters, Metadata, never>(
  "graph_upsert_edge",
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
            metadata: { type: params.type, from: params.fromKey, to: params.toKey },
          })
          const fromKeyField = params.fromKeyField ?? "id"
          const toKeyField = params.toKeyField ?? "id"
          const props = (params.properties ?? {}) as Record<string, unknown>
          const rows = yield* runWriteEffect(
            `MATCH (a:${params.fromLabel} {${fromKeyField}: $fromKey}) MATCH (b:${params.toLabel} {${toKeyField}: $toKey}) MERGE (a)-[r:${params.type}]->(b) SET r += $properties, r.updated_at = timestamp() RETURN r`,
            { fromKey: params.fromKey, toKey: params.toKey, properties: props },
          )
          const edge = rows[0]?.r ?? null
          return {
            title: `${params.type} ${params.fromKey} -> ${params.toKey}`,
            output: JSON.stringify(edge),
            metadata: { edge },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
