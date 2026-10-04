import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { recordToolCall } from "./tool_call_audit"
import DESCRIPTION from "./oob-ops.txt"

interface OobSession {
  proc: { kill: () => void }
  logPath: string
  domain: string | null
  planted: Map<string, { label: string; hypothesisId?: string; plantedAt: number }>
}

const sessions = new Map<string, OobSession>()

const logPathFor = (programId: string) =>
  `${process.env.OOB_LOG_DIR ?? "./oob-logs"}/${programId}.jsonl`

export const StartParameters = Schema.Struct({ programId: Schema.String })
type StartMeta = { domain: unknown }

export const OobStartTool = Tool.define<typeof StartParameters, StartMeta, never>(
  "oob_start_listener",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: StartParameters,
      execute: (params: Schema.Schema.Type<typeof StartParameters>, ctx: Tool.Context<StartMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "oob", patterns: ["*"], always: ["*"], metadata: {} })
          const existing = sessions.get(params.programId)
          if (existing) {
            return { title: "listener running", output: "{}", metadata: { domain: existing.domain } }
          }
          const logPath = logPathFor(params.programId)
          yield* Effect.promise(async () => {
            const { mkdir } = await import("node:fs/promises")
            const { dirname } = await import("node:path")
            await mkdir(dirname(logPath), { recursive: true })
          })
          const proc = Bun.spawn(["interactsh-client", "-json", "-o", logPath], {
            stdout: "pipe",
            stderr: "ignore",
          })
          const session: OobSession = { proc: proc as unknown as OobSession["proc"], logPath, domain: null, planted: new Map() }
          sessions.set(params.programId, session)
          // interactsh-client prints its assigned domain on startup; don't hang if the pattern shifts
          // interactsh-client prints its assigned domain on startup; don't hang if the pattern shifts
          const domain = yield* Effect.promise(
            () =>
              new Promise<string | null>((resolve) => {
                const reader = (proc.stdout as unknown as ReadableStream<Uint8Array>).getReader()
                const decoder = new TextDecoder()
                const timer = setTimeout(() => {
                  void reader.cancel().catch(() => undefined)
                  resolve(null)
                }, 8000)
                const pump = async () => {
                  try {
                    for (;;) {
                      const { done, value } = await reader.read()
                      if (done) break
                      const match = decoder
                        .decode(value)
                        .match(/([a-z0-9]+\.(?:oast\.\w+|interact\.sh))/i)
                      if (match) {
                        clearTimeout(timer)
                        resolve(match[1])
                        break
                      }
                    }
                  } catch {
                    clearTimeout(timer)
                    resolve(null)
                  }
                }
                void pump()
              }),
          )
          if (domain) session.domain = domain
          return {
            title: domain ? `listener ${domain}` : "listener starting",
            output: JSON.stringify({ started: true, domain }),
            metadata: { domain },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof StartParameters, StartMeta>
  }),
)

export const PlantParameters = Schema.Struct({
  programId: Schema.String,
  label: Schema.String,
  hypothesisId: Schema.optional(Schema.String),
})
type PlantMeta = { payloadUrl: unknown }

export const OobPlantTool = Tool.define<typeof PlantParameters, PlantMeta, never>(
  "oob_plant_payload",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: PlantParameters,
      execute: (params: Schema.Schema.Type<typeof PlantParameters>, ctx: Tool.Context<PlantMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "oob", patterns: ["*"], always: ["*"], metadata: {} })
          const session = sessions.get(params.programId)
          if (!session?.domain) throw new Error(`No active OOB listener for ${params.programId} — call oob_start_listener first`)
          const token = crypto.randomUUID().slice(0, 8)
          const payloadUrl = `https://${token}.${session.domain}`
          session.planted.set(token, { label: params.label, hypothesisId: params.hypothesisId, plantedAt: Date.now() })
          recordToolCall(params.programId, "oob_plant_payload", payloadUrl, params.hypothesisId)
          return {
            title: `planted ${params.label}`,
            output: JSON.stringify({
              payloadUrl,
              note: "Embed wherever the hypothesis calls for, then poll oob_check_interactions.",
            }),
            metadata: { payloadUrl },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof PlantParameters, PlantMeta>
  }),
)

export const CheckParameters = Schema.Struct({ programId: Schema.String })
type CheckMeta = { interactions: unknown }

export const OobCheckTool = Tool.define<typeof CheckParameters, CheckMeta, never>(
  "oob_check_interactions",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: CheckParameters,
      execute: (params: Schema.Schema.Type<typeof CheckParameters>, ctx: Tool.Context<CheckMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "oob", patterns: ["*"], always: ["*"], metadata: {} })
          const session = sessions.get(params.programId)
          if (!session) return { title: "no listener", output: "[]", metadata: { interactions: [] } }
          const interactions = yield* Effect.promise(async () => {
            const file = Bun.file(session.logPath)
            if (!(await file.exists())) return []
            const out: Array<Record<string, unknown>> = []
            for (const line of (await file.text()).split("\n")) {
              if (!line.trim()) continue
              try {
                const entry = JSON.parse(line) as Record<string, unknown>
                const fullId = String(entry["full-id"] ?? entry["unique-id"] ?? "")
                const token = fullId.split(".")[0]
                const planted = session.planted.get(token)
                if (planted) {
                  out.push({
                    token,
                    label: planted.label,
                    hypothesisId: planted.hypothesisId,
                    protocol: entry["protocol"] ?? "unknown",
                    remoteAddress: entry["remote-address"] ?? "unknown",
                    timestamp: entry["timestamp"] ?? new Date().toISOString(),
                  })
                }
              } catch {
                continue
              }
            }
            return out
          })
          return {
            title: `${interactions.length} interactions`,
            output: JSON.stringify(interactions),
            metadata: { interactions },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof CheckParameters, CheckMeta>
  }),
)

export const StopParameters = Schema.Struct({ programId: Schema.String })
type StopMeta = { stopped: unknown }

export const OobStopTool = Tool.define<typeof StopParameters, StopMeta, never>(
  "oob_stop_listener",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: StopParameters,
      execute: (params: Schema.Schema.Type<typeof StopParameters>, ctx: Tool.Context<StopMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "oob", patterns: ["*"], always: ["*"], metadata: {} })
          const session = sessions.get(params.programId)
          if (session) {
            session.proc.kill()
            sessions.delete(params.programId)
          }
          return {
            title: session ? "listener stopped" : "no listener",
            output: JSON.stringify({ stopped: Boolean(session) }),
            metadata: { stopped: Boolean(session) },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof StopParameters, StopMeta>
  }),
)

export const oobTools = [OobStartTool, OobPlantTool, OobCheckTool, OobStopTool]
