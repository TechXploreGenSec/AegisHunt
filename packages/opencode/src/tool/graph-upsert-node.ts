import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./graph-upsert-node.txt"
import { runWriteEffect } from "./graph-db"

export const Parameters = Schema.Struct({
  label: Schema.Literals(["Program", "Asset", "Endpoint", "Parameter", "Credential", "TechStack"]).annotate({
    description: "Asset-graph node label. Hypothesis/TestExecution/Finding are excluded.",
  }),
  key: Schema.String.annotate({ description: "Unique identifying value, e.g. host or url" }),
  keyField: Schema.optional(Schema.String).annotate({ description: "Property to MERGE on, defaults to id" }),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Extra properties to SET on the node",
  }),
})

type Metadata = {
  node: unknown
}

export const GraphUpsertNodeTool = Tool.define<typeof Parameters, Metadata, never>(
  "graph_upsert_node",
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
            metadata: { label: params.label, key: params.key },
          })
          const keyField = params.keyField ?? "id"
          const props = (params.properties ?? {}) as Record<string, unknown>
          // label/keyField are closed sets validated by Schema; safe to interpolate after validation
          const rows = yield* runWriteEffect(
            `MERGE (n:${params.label} {${keyField}: $key}) SET n += $properties, n.updated_at = timestamp() RETURN n`,
            { key: params.key, properties: props },
          )
          const node = rows[0]?.n ?? null
          return {
            title: `upsert ${params.label} ${params.key}`,
            output: JSON.stringify(node),
            metadata: { node },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
