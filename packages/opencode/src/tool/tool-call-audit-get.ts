import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./tool-call-audit-get.txt"
import { recentToolCalls } from "./tool_call_audit"

export const Parameters = Schema.Struct({
  programId: Schema.String,
  target: Schema.optional(Schema.String.annotate({ description: "Exact target URL/host to filter on; omit for all" })),
  limit: Schema.optional(Schema.Number.annotate({ description: "Max rows, default 20, capped at 50" })),
})

type Metadata = { rows: unknown }

export const ToolCallAuditGetTool = Tool.define<typeof Parameters, Metadata, never>(
  "tool_call_audit_get",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "completion", patterns: ["*"], always: ["*"], metadata: {} })
          const rows = recentToolCalls(
            params.programId,
            Math.min(Math.max(Math.round(params.limit ?? 20), 1), 50),
            params.target,
          )
          return {
            title: `${rows.length} audit entries`,
            output: JSON.stringify({ programId: params.programId, count: rows.length, rows }),
            metadata: { rows },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
