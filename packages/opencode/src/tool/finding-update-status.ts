import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./finding-update-status.txt"
import { runWriteEffect, runReadEffect } from "./graph-db"

const ALLOWED: Record<string, string[]> = {
  unreported: ["reported", "false_positive"],
  reported: [],
  false_positive: [],
}

export const Parameters = Schema.Struct({
  findingId: Schema.String,
  newStatus: Schema.Literals(["reported", "false_positive"]),
  justification: Schema.String,
})

type Metadata = { findingId: unknown; from: unknown; to: unknown }

export const FindingUpdateStatusTool = Tool.define<typeof Parameters, Metadata, never>(
  "finding_update_status",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "finding", patterns: ["*"], always: ["*"], metadata: {} })
          if (params.justification.trim().length < 20) throw new Error("justification must be >= 20 chars")
          const rows = yield* runReadEffect(`MATCH (f:Finding {id: $id}) RETURN f`, { id: params.findingId })
          if (!rows[0]) throw new Error(`Finding ${params.findingId} not found`)
          const current = (rows[0]?.f as { properties?: { status?: string } } | undefined)?.properties?.status ?? "unreported"
          if (!ALLOWED[current]?.includes(params.newStatus))
            throw new Error(`Cannot move from '${current}' to '${params.newStatus}'`)
          if (params.newStatus === "reported") {
            const hr = (rows[0]?.f as { properties?: { human_reviewed?: boolean } } | undefined)?.properties
              ?.human_reviewed
            if (!hr) throw new Error("Cannot mark 'reported' until human_reviewed=true")
          }
          yield* runWriteEffect(
            `MATCH (f:Finding {id: $id}) SET f.status = $newStatus, f.status_justification = $justification RETURN f`,
            { id: params.findingId, newStatus: params.newStatus, justification: params.justification },
          )
          return {
            title: `${params.findingId} ${current} -> ${params.newStatus}`,
            output: JSON.stringify({ findingId: params.findingId, from: current, to: params.newStatus }),
            metadata: { findingId: params.findingId, from: current, to: params.newStatus },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
