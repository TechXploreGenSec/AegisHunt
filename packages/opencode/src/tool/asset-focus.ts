import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./asset-focus.txt"

export const Parameters = Schema.Struct({
  programId: Schema.String,
  host: Schema.String.annotate({ description: "Asset now under active testing, e.g. api.example.com" }),
  note: Schema.optional(Schema.String).annotate({
    description: "Why this asset is next: priority order position, what remains",
  }),
})

type Metadata = { host: unknown }

export const AssetFocusTool = Tool.define<typeof Parameters, Metadata, never>(
  "asset_focus",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "asset_focus", patterns: ["*"], always: ["*"], metadata: {} })
          if (!params.host.trim()) throw new Error("host must be non-empty")
          return {
            title: `focus ${params.host}`,
            output: JSON.stringify({ programId: params.programId, host: params.host, note: params.note ?? "" }),
            metadata: { host: params.host },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
