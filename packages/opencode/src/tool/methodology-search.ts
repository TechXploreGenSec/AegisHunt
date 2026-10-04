import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./methodology-search.txt"

export const BuildParameters = Schema.Struct({ force: Schema.optional(Schema.Boolean) })
type BuildMeta = { indexed: unknown }

export const MethodologyIndexBuildTool = Tool.define<typeof BuildParameters, BuildMeta, never>(
  "methodology_index_build",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: BuildParameters,
      execute: (params: Schema.Schema.Type<typeof BuildParameters>, ctx: Tool.Context<BuildMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "methodology", patterns: ["*"], always: ["*"], metadata: {} })
          const source = process.env.METHODOLOGY_SOURCE_PATH
          if (!source) throw new Error("METHODOLOGY_SOURCE_PATH not set")
          const dbPath = process.env.METHODOLOGY_INDEX_PATH ?? "./methodology_index.db"
          const result = yield* Effect.promise(async () => {
            const { Database } = await import("bun:sqlite")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const db: any = new Database(dbPath)
            db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(heading, body, source_path, tags)`)
            const { c } = db.prepare("SELECT COUNT(*) as c FROM chunks").get() as { c: number }
            if (c > 0 && !params.force) return { skipped: true, existingChunks: c }
            db.exec("DELETE FROM chunks")
            const { readFileSync, readdirSync, statSync } = await import("node:fs")
            const { join, relative } = await import("node:path")
            const walk = (dir: string): string[] => {
              const out: string[] = []
              for (const e of readdirSync(dir)) {
                const full = join(dir, e)
                if (statSync(full).isDirectory()) {
                  if (e === ".git" || e === "node_modules") continue
                  out.push(...walk(full))
                } else if (e.endsWith(".md")) out.push(full)
              }
              return out
            }
            const chunk = (text: string) => {
              const chunks: Array<{ h: string; b: string }> = []
              let h = "Untitled"
              let cur: string[] = []
              const flush = () => {
                const b = cur.join("\n").trim()
                if (b) chunks.push({ h, b: b.slice(0, 3200) })
                cur = []
              }
              for (const line of text.split("\n")) {
                const m = line.match(/^(#{2,3})\s+(.*)/)
                if (m) {
                  flush()
                  h = m[2].trim()
                } else cur.push(line)
              }
              flush()
              return chunks
            }
            const files = walk(source)
            const ins = db.prepare("INSERT INTO chunks (heading, body, source_path, tags) VALUES (?, ?, ?, ?)")
            const tx = db.transaction((all: Array<{ h: string; b: string; f: string }>) => {
              for (const c of all) ins.run(c.h, c.b, relative(source, c.f), "")
            })
            let total = 0
            for (const f of files) {
              const list = chunk(readFileSync(f, "utf-8")).map((c) => ({ ...c, f }))
              tx(list)
              total += list.length
            }
            db.close()
            return { indexed: true, filesScanned: files.length, chunksWritten: total }
          })
          return { title: "methodology index", output: JSON.stringify(result), metadata: { indexed: result } }
        }),
    } satisfies Tool.DefWithoutID<typeof BuildParameters, BuildMeta>
  }),
)

export const SearchParameters = Schema.Struct({
  query: Schema.String,
  techStack: Schema.optional(Schema.Array(Schema.String)),
  vulnClass: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
})
type SearchMeta = { results: unknown }

export const MethodologySearchTool = Tool.define<typeof SearchParameters, SearchMeta, never>(
  "methodology_search",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: SearchParameters,
      execute: (params: Schema.Schema.Type<typeof SearchParameters>, ctx: Tool.Context<SearchMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "methodology", patterns: ["*"], always: ["*"], metadata: {} })
          const limit = Math.min(Math.max(Math.round(params.limit ?? 5), 1), 20)
          const rows = yield* Effect.promise(async () => {
            const { Database } = await import("bun:sqlite")
            const dbPath = process.env.METHODOLOGY_INDEX_PATH ?? "./methodology_index.db"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const db: any = new Database(dbPath, { readonly: true })
            const q = [params.query, ...(params.techStack ?? []), params.vulnClass ?? ""]
              .filter(Boolean)
              .map((t) => `"${t.replace(/"/g, '""')}"`)
              .join(" OR ")
            const out = db
              .prepare(`SELECT heading, body, source_path, rank FROM chunks WHERE chunks MATCH ? ORDER BY rank LIMIT ?`)
              .all(q, limit) as Array<{ heading: string; body: string; source_path: string }>
            db.close()
            return out
          })
          return {
            title: `${rows.length} chunks`,
            output: JSON.stringify(rows.map((r) => ({ heading: r.heading, snippet: r.body.slice(0, 600), sourcePath: r.source_path }))),
            metadata: { results: rows },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof SearchParameters, SearchMeta>
  }),
)

export const methodologyTools = [MethodologyIndexBuildTool, MethodologySearchTool]
