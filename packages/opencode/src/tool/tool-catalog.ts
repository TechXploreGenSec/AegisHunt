import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./tool-catalog.txt"

const supabaseEffect = () =>
  Effect.promise(async () => {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_KEY
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    const { createClient } = await import("@supabase/supabase-js").catch(() => ({ createClient: null }))
    if (!createClient) throw new Error("supabase-js not installed")
    return createClient(url, key)
  })

export const LookupParameters = Schema.Struct({
  category: Schema.String,
  maxAgeDays: Schema.optional(Schema.Number),
})
type LookupMeta = { fresh: unknown }

export const ToolCatalogLookupTool = Tool.define<typeof LookupParameters, LookupMeta, never>(
  "tool_catalog_lookup",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: LookupParameters,
      execute: (params: Schema.Schema.Type<typeof LookupParameters>, ctx: Tool.Context<LookupMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "tool_catalog", patterns: ["*"], always: ["*"], metadata: {} })
          const maxAge = params.maxAgeDays ?? 30
          const client = yield* supabaseEffect()
          const { data, error } = yield* Effect.promise(() =>
            client.from("tool_catalog").select().eq("category", params.category).maybeSingle(),
          )
          if (error) throw new Error(error.message)
          const ageMs = data ? Date.now() - new Date(data.updated_at).getTime() : Infinity
          if (data && ageMs < maxAge * 86400000) {
            return {
              title: `fresh ${params.category}`,
              output: JSON.stringify(data.ranked_tools),
              metadata: { fresh: true },
            }
          }
          const year = new Date().getFullYear()
          return {
            title: `stale ${params.category}`,
            output: JSON.stringify({
              fresh: false,
              suggestedQuery: `best ${params.category} tools ${year} bug bounty github stars`,
            }),
            metadata: { fresh: false },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof LookupParameters, LookupMeta>
  }),
)

export const RecordParameters = Schema.Struct({
  category: Schema.String,
  rankedTools: Schema.Array(Schema.Struct({ name: Schema.String, rationale: Schema.String })),
  sourceQuery: Schema.String,
})
type RecordMeta = { recorded: unknown }

export const ToolCatalogRecordTool = Tool.define<typeof RecordParameters, RecordMeta, never>(
  "tool_catalog_record",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: RecordParameters,
      execute: (params: Schema.Schema.Type<typeof RecordParameters>, ctx: Tool.Context<RecordMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "tool_catalog", patterns: ["*"], always: ["*"], metadata: {} })
          const client = yield* supabaseEffect()
          const { error } = yield* Effect.promise(() =>
            client.from("tool_catalog").upsert({
              category: params.category,
              ranked_tools: params.rankedTools,
              source_query: params.sourceQuery,
              updated_at: new Date().toISOString(),
            }),
          )
          if (error) throw new Error(error.message)
          return {
            title: `recorded ${params.category}`,
            output: JSON.stringify({ recorded: true }),
            metadata: { recorded: true },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof RecordParameters, RecordMeta>
  }),
)
