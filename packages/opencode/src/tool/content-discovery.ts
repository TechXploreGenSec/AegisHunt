import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { recordToolCall } from "./tool_call_audit"
import DESCRIPTION from "./content-discovery.txt"
import { getLoadedScope, observeScope } from "./scope-gate"
import { runWriteEffect } from "./graph-db"

export const Parameters = Schema.Struct({
  programId: Schema.String,
  target: Schema.String,
  wordlistPath: Schema.String,
  rateLimit: Schema.Number,
  extensions: Schema.optional(Schema.Array(Schema.String)),
  timeoutSeconds: Schema.optional(Schema.Number),
})

type Metadata = { runId: unknown; totalHits: unknown; nodesWritten: unknown }

export const ContentDiscoveryTool = Tool.define<typeof Parameters, Metadata, never>(
  "content_discovery",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "content_discovery",
            patterns: [params.target],
            always: [],
            metadata: { target: params.target },
          })
          const scope = getLoadedScope(params.programId)
          observeScope(scope, params.programId, "content_discovery", params.target, "active-recon")
          if (!(params.rateLimit > 0)) throw new Error("rateLimit must be positive from computePerLaneRate")
          const timeout = Math.round(params.timeoutSeconds ?? 300)
          const runId = crypto.randomUUID()
          const out = yield* Effect.promise(async () => {
            const proc = Bun.spawn(
              [
                "ffuf",
                "-w",
                params.wordlistPath,
                "-u",
                `${params.target.replace(/\/$/, "")}/FUZZ`,
                "-of",
                "json",
                "-rate",
                String(Math.max(1, Math.round(params.rateLimit))),
                "-timeout",
                String(timeout),
                "-s",
                ...(params.extensions?.length ? ["-e", params.extensions.join(",")] : []),
              ],
              { stdout: "pipe", stderr: "pipe" },
            )
            const text = await new Response(proc.stdout).text()
            await proc.exited
            return text
          })
          let results: Array<{ url: string; status: number }> = []
          try {
            const parsed = JSON.parse(out || '{"results":[]}') as { results?: typeof results }
            results = parsed.results ?? []
          } catch {
            results = []
          }
          let nodesWritten = 0
          for (const r of results.slice(0, 200)) {
            try {
              const u = new URL(r.url)
              const key = `${u.hostname}${u.pathname}`
              yield* runWriteEffect(`MERGE (e:Endpoint {id: $key}) SET e.url = $url, e.status_code = $status, e.program_id = $programId RETURN e`, {
                key,
                url: r.url,
                status: r.status,
                programId: params.programId,
              })
              nodesWritten++
            } catch {
              continue
            }
          }
          const sample = results
            .filter((r) => r.status < 400)
            .slice(0, 15)
          recordToolCall(params.programId, "content_discovery", params.target)
          return {
            title: `${results.length} hits`,
            output: JSON.stringify({ runId, totalHits: results.length, nodesWritten, sample }),
            metadata: { runId, totalHits: results.length, nodesWritten },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
