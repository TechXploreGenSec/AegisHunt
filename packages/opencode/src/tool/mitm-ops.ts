import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { recordToolCall } from "./tool_call_audit"
import DESCRIPTION from "./mitm-ops.txt"
import { getLoadedScope, observeScope, scopeRequestHeaders, scopeUpstreamProxy } from "./scope-gate"
import { unproxiedEnv } from "./no-proxy"

const DB_PATH = process.env.MITM_TRAFFIC_DB_PATH ?? "./mitm_mcp_traffic.db"

type DbLike = {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    all: (...args: unknown[]) => Record<string, unknown>[]
    get: (...args: unknown[]) => Record<string, unknown> | undefined
    run: (...args: unknown[]) => void
  }
  close: () => void
}

let db: DbLike | null = null

function getDbEffect() {
  return Effect.promise(async () => {
    if (db) return db
    const { Database } = await import("bun:sqlite")
    const instance = new Database(DB_PATH) as unknown as DbLike
    instance.exec(
      `CREATE TABLE IF NOT EXISTS flows (
        flow_id TEXT PRIMARY KEY, program_id TEXT, url TEXT, method TEXT,
        status INTEGER, headers TEXT, body TEXT, host TEXT, created_at INTEGER
      )`,
    )
    db = instance
    return instance
  })
}

interface ProxyHandle {
  proc: { kill: () => void; pid?: number; exited: Promise<unknown> }
  programId: string
  listenPort: number
}

let proxy: ProxyHandle | null = null

export const StartParameters = Schema.Struct({
  programId: Schema.String,
  listenPort: Schema.optional(Schema.Number),
  scopeConfigPath: Schema.String,
})
type StartMeta = { pid: unknown; listenPort: unknown }

export const MitmStartProxyTool = Tool.define<typeof StartParameters, StartMeta, never>(
  "mitm_start_proxy",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: StartParameters,
      execute: (params: Schema.Schema.Type<typeof StartParameters>, ctx: Tool.Context<StartMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "mitm_proxy", patterns: ["*"], always: ["*"], metadata: {} })
          if (proxy) return { title: "proxy already running", output: "{}", metadata: { pid: null, listenPort: proxy.listenPort } }
          const port = Math.round(params.listenPort ?? 8080)
          const addonPath = process.env.MITM_ADDON_PATH ?? "./mitm_addon.py"
          // Optional upstream chaining: only when the scope configures it.
          const upstreamProxy = scopeUpstreamProxy(getLoadedScope(params.programId))
          const proc = Bun.spawn(
            [
              "mitmdump",
              "-s",
              addonPath,
              "--listen-port",
              String(port),
              ...(upstreamProxy ? ["--mode", `upstream:${upstreamProxy}`] : []),
              "--set",
              `traffic_db=${DB_PATH}`,
              "--set",
              `scope_config=${params.scopeConfigPath}`,
              "--set",
              `program_id=${params.programId}`,
            ],
            { stdout: "ignore", stderr: "ignore", env: unproxiedEnv() },
          )
          proxy = { proc: proc as unknown as ProxyHandle["proc"], programId: params.programId, listenPort: port }
          return {
            title: `proxy on :${port}`,
            output: JSON.stringify({ started: true, listenPort: port }),
            metadata: { pid: null, listenPort: port },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof StartParameters, StartMeta>
  }),
)

export const StopParameters = Schema.Struct({})
type StopMeta = { stopped: unknown }

export const MitmStopProxyTool = Tool.define<typeof StopParameters, StopMeta, never>(
  "mitm_stop_proxy",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: StopParameters,
      execute: (_params: Schema.Schema.Type<typeof StopParameters>, ctx: Tool.Context<StopMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "mitm_proxy", patterns: ["*"], always: ["*"], metadata: {} })
          if (proxy) {
            proxy.proc.kill()
            proxy = null
            return { title: "proxy stopped", output: "{}", metadata: { stopped: true } }
          }
          return { title: "proxy not running", output: "{}", metadata: { stopped: false } }
        }),
    } satisfies Tool.DefWithoutID<typeof StopParameters, StopMeta>
  }),
)

export const SummaryParameters = Schema.Struct({ programId: Schema.String })
type SummaryMeta = { summary: unknown }

export const MitmTrafficSummaryTool = Tool.define<typeof SummaryParameters, SummaryMeta, never>(
  "mitm_get_traffic_summary",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: SummaryParameters,
      execute: (params: Schema.Schema.Type<typeof SummaryParameters>, ctx: Tool.Context<SummaryMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "mitm_proxy", patterns: ["*"], always: ["*"], metadata: {} })
          const database = yield* getDbEffect()
          const rows = yield* Effect.promise(async () =>
            database
              .prepare(`SELECT host, status, COUNT(*) as count FROM flows WHERE program_id = ? GROUP BY host, status`)
              .all(params.programId),
          )
          return { title: `${rows.length} groups`, output: JSON.stringify(rows), metadata: { summary: rows } }
        }),
    } satisfies Tool.DefWithoutID<typeof SummaryParameters, SummaryMeta>
  }),
)

export const SearchParameters = Schema.Struct({
  programId: Schema.String,
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
})
type SearchMeta = { matches: unknown }

export const MitmSearchTrafficTool = Tool.define<typeof SearchParameters, SearchMeta, never>(
  "mitm_search_traffic",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: SearchParameters,
      execute: (params: Schema.Schema.Type<typeof SearchParameters>, ctx: Tool.Context<SearchMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "mitm_proxy", patterns: ["*"], always: ["*"], metadata: {} })
          const database = yield* getDbEffect()
          const limit = Math.min(Math.max(Math.round(params.limit ?? 20), 1), 100)
          const rows = yield* Effect.promise(async () =>
            database
              .prepare(
                `SELECT flow_id, url, method, status FROM flows WHERE program_id = ? AND (url LIKE ? OR body LIKE ?) LIMIT ?`,
              )
              .all(params.programId, `%${params.query}%`, `%${params.query}%`, limit),
          )
          return { title: `${rows.length} matches`, output: JSON.stringify(rows), metadata: { matches: rows } }
        }),
    } satisfies Tool.DefWithoutID<typeof SearchParameters, SearchMeta>
  }),
)

export const InspectParameters = Schema.Struct({ flowId: Schema.String })
type InspectMeta = { flow: unknown }

export const MitmInspectFlowTool = Tool.define<typeof InspectParameters, InspectMeta, never>(
  "mitm_inspect_flow",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: InspectParameters,
      execute: (params: Schema.Schema.Type<typeof InspectParameters>, ctx: Tool.Context<InspectMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "mitm_proxy", patterns: ["*"], always: ["*"], metadata: {} })
          const database = yield* getDbEffect()
          const row = yield* Effect.promise(async () =>
            database.prepare(`SELECT * FROM flows WHERE flow_id = ?`).get(params.flowId),
          )
          if (!row) throw new Error(`Flow ${params.flowId} not found`)
          return { title: `flow ${params.flowId}`, output: JSON.stringify(row), metadata: { flow: row } }
        }),
    } satisfies Tool.DefWithoutID<typeof InspectParameters, InspectMeta>
  }),
)

export const ReplayParameters = Schema.Struct({
  programId: Schema.String,
  flowId: Schema.String,
  modifiedHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  modifiedBody: Schema.optional(Schema.String),
})
type ReplayMeta = { status: unknown }

export const MitmReplayFlowTool = Tool.define<typeof ReplayParameters, ReplayMeta, never>(
  "mitm_replay_flow",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: ReplayParameters,
      execute: (params: Schema.Schema.Type<typeof ReplayParameters>, ctx: Tool.Context<ReplayMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "mitm_replay_flow", patterns: ["*"], always: [], metadata: {} })
          const scope = getLoadedScope(params.programId)
          const database = yield* getDbEffect()
          const flow = yield* Effect.promise(async () =>
            database.prepare(`SELECT * FROM flows WHERE flow_id = ?`).get(params.flowId),
          )
          if (!flow) throw new Error(`Flow ${params.flowId} not found`)
          const url = String(flow["url"] ?? "")
          observeScope(scope, params.programId, "mitm_replay_flow", url, "interaction")
          const headers = { ...JSON.parse(String(flow["headers"] ?? "{}")), ...((params.modifiedHeaders ?? {}) as Record<string, string>), ...scopeRequestHeaders(getLoadedScope(params.programId)) }
          const res = yield* Effect.promise(() =>
            fetch(url, {
              method: String(flow["method"] ?? "GET"),
              headers,
              body: (params.modifiedBody ?? (flow["body"] as string | undefined)) || undefined,
            }),
          )
          recordToolCall(params.programId, "mitm_replay_flow", url)
          return {
            title: `replayed ${res.status}`,
            output: JSON.stringify({ status: res.status }),
            metadata: { status: res.status },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof ReplayParameters, ReplayMeta>
  }),
)

export const FuzzParameters = Schema.Struct({
  programId: Schema.String,
  baseFlowId: Schema.String,
  paramName: Schema.String,
  payloads: Schema.Array(Schema.String),
  rateLimit: Schema.Number,
})
type FuzzMeta = { results: unknown }

export const MitmFuzzEndpointTool = Tool.define<typeof FuzzParameters, FuzzMeta, never>(
  "mitm_fuzz_endpoint",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: FuzzParameters,
      execute: (params: Schema.Schema.Type<typeof FuzzParameters>, ctx: Tool.Context<FuzzMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "mitm_fuzz_endpoint", patterns: ["*"], always: [], metadata: {} })
          if (params.payloads.length === 0 || params.payloads.length > 50)
            throw new Error("payloads must be 1..50 purposeful entries, not a dump")
          if (!(params.rateLimit > 0)) throw new Error("rateLimit must come from computePerLaneRate(scope, 1)")
          const scope = getLoadedScope(params.programId)
          const database = yield* getDbEffect()
          const flow = yield* Effect.promise(async () =>
            database.prepare(`SELECT * FROM flows WHERE flow_id = ?`).get(params.baseFlowId),
          )
          if (!flow) throw new Error(`Flow ${params.baseFlowId} not found`)
          const base = String(flow["url"] ?? "")
          observeScope(scope, params.programId, "mitm_fuzz_endpoint", base, "interaction")
          const delayMs = 1000 / params.rateLimit
          const baseline = String(flow["body"] ?? "").length
          const results: Array<{ payload: string; status: number; lengthDelta: number }> = []
          for (const payload of params.payloads) {
            const u = new URL(base)
            u.searchParams.set(params.paramName, payload)
            const res = yield* Effect.promise(() =>
              fetch(u.toString(), {
                method: String(flow["method"] ?? "GET"),
                headers: { ...JSON.parse(String(flow["headers"] ?? "{}")), ...scopeRequestHeaders(getLoadedScope(params.programId)) },
              }),
            )
            const text = yield* Effect.promise(() => res.text())
            results.push({ payload, status: res.status, lengthDelta: text.length - baseline })
            yield* Effect.promise(() => new Promise((r) => setTimeout(r, delayMs)))
          }
          recordToolCall(params.programId, "mitm_fuzz_endpoint", base)
          return {
            title: `${results.length} fuzz results`,
            output: JSON.stringify(results),
            metadata: { results },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof FuzzParameters, FuzzMeta>
  }),
)

export const mitmTools = [
  MitmStartProxyTool,
  MitmStopProxyTool,
  MitmTrafficSummaryTool,
  MitmSearchTrafficTool,
  MitmInspectFlowTool,
  MitmReplayFlowTool,
  MitmFuzzEndpointTool,
]
