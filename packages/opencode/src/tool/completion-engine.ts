import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./completion-engine.txt"
import { runReadEffect, runWriteEffect } from "./graph-db"

// Transparent, auditable completeness: which vuln classes even apply to an
// endpoint (simple explainable rules on observable properties), and how
// many of those have a real TestExecution behind them. The model never
// declares "done" — endpoint_mark_assessed refuses unless the computed
// score is complete.

export const VULN_CLASSES = [
  "idor",
  "ssrf",
  "auth-bypass",
  "injection",
  "xss",
  "business-logic",
  "access-control",
  "info-disclosure",
  "rce",
  "other",
] as const
export type VulnClass = (typeof VULN_CLASSES)[number]

export interface EndpointProps {
  url: string
  method?: string
  contentType?: string
  requiresAuth?: boolean
  paramNames?: string[]
}

export function applicableVulnClasses(ep: EndpointProps): VulnClass[] {
  const classes = new Set<VulnClass>(["info-disclosure"])
  const params = (ep.paramNames ?? []).map((p) => p.toLowerCase())
  const path = (ep.url ?? "").toLowerCase()
  if (params.some((p) => /^(id|uid|user_?id|ref|account_?id)$/.test(p)) || /\/\d+(\/|$)/.test(path))
    classes.add("idor")
  if (params.length > 0) {
    classes.add("injection")
    classes.add("business-logic")
  }
  if (ep.requiresAuth) {
    classes.add("auth-bypass")
    classes.add("access-control")
  }
  if (params.some((p) => /(url|callback|webhook|redirect|next|return|target)/.test(p))) classes.add("ssrf")
  if ((ep.contentType ?? "").includes("html") || !path.includes("/api")) classes.add("xss")
  if (params.some((p) => /(file|filename|path|cmd|command)/.test(p))) classes.add("rce")
  if (["POST", "PUT", "PATCH", "DELETE"].includes((ep.method ?? "GET").toUpperCase())) classes.add("business-logic")
  return [...classes]
}

function rowProps(row: Record<string, unknown>): EndpointProps {
  const e = (row["e"] ?? {}) as { properties?: Record<string, unknown> }
  const p = (e.properties ?? row) as Record<string, unknown>
  return {
    url: String(p["url"] ?? p["id"] ?? ""),
    method: typeof p["method"] === "string" ? (p["method"] as string) : undefined,
    contentType: typeof p["contentType"] === "string" ? (p["contentType"] as string) : undefined,
    requiresAuth: p["requiresAuth"] === true,
    paramNames: Array.isArray(p["paramNames"]) ? (p["paramNames"] as string[]) : undefined,
  }
}

const computeScoreEffect = (endpointKey: string) =>
  Effect.gen(function* () {
    const epRows = yield* runReadEffect(`MATCH (e:Endpoint {id: $key}) RETURN e`, { key: endpointKey })
    if (!epRows[0]) throw new Error(`Endpoint ${endpointKey} not found — recon may not have logged it yet`)
    const applicable = applicableVulnClasses(rowProps(epRows[0] as Record<string, unknown>))
    const testedRows = yield* runReadEffect(
      `MATCH (e:Endpoint {id: $key})-[:SUGGESTS]->(h:Hypothesis)-[:TESTED_BY]->(:TestExecution) RETURN DISTINCT h.vuln_class AS vulnClass`,
      { key: endpointKey },
    )
    const testedClasses = [...new Set(testedRows.map((r) => String((r as Record<string, unknown>)["vulnClass"])))]
    const missing = applicable.filter((c) => !testedClasses.includes(c))
    const score = applicable.length === 0 ? 1 : Math.round(((applicable.length - missing.length) / applicable.length) * 100) / 100
    return { endpointKey, applicableClasses: applicable, testedClasses, missingClasses: missing, score, ready: missing.length === 0 }
  })

export const ScoreParameters = Schema.Struct({ endpointKey: Schema.String })

export const EndpointCompletionScoreTool = Tool.define<typeof ScoreParameters, { score: unknown }, never>(
  "endpoint_completion_score",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: ScoreParameters,
      execute: (params: Schema.Schema.Type<typeof ScoreParameters>, ctx: Tool.Context<{ score: unknown }>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "completion", patterns: ["*"], always: ["*"], metadata: {} })
          const s = yield* computeScoreEffect(params.endpointKey)
          return {
            title: `${params.endpointKey} score ${s.score}`,
            output: JSON.stringify({ ...s, readyToMarkAssessed: s.ready }),
            metadata: { score: s.score },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof ScoreParameters, { score: unknown }>
  }),
)

export const MarkAssessedParameters = Schema.Struct({ endpointKey: Schema.String })

export const EndpointMarkAssessedTool = Tool.define<typeof MarkAssessedParameters, { marked: unknown }, never>(
  "endpoint_mark_assessed",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: MarkAssessedParameters,
      execute: (params: Schema.Schema.Type<typeof MarkAssessedParameters>, ctx: Tool.Context<{ marked: unknown }>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "completion", patterns: ["*"], always: ["*"], metadata: {} })
          const s = yield* computeScoreEffect(params.endpointKey)
          if (!s.ready) {
            throw new Error(
              `Cannot mark ${params.endpointKey} assessed — missing coverage for: ${s.missingClasses.join(", ")}. ` +
                `Propose and test a hypothesis for each, or asset_mark_blocker the endpoint if one genuinely cannot be tested.`,
            )
          }
          yield* runWriteEffect(
            `MATCH (e:Endpoint {id: $key}) SET e.fully_assessed = true, e.assessed_at = timestamp() RETURN e`,
            { key: params.endpointKey },
          )
          return {
            title: `assessed ${params.endpointKey}`,
            output: JSON.stringify({ marked: true, endpointKey: params.endpointKey }),
            metadata: { marked: true },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof MarkAssessedParameters, { marked: unknown }>
  }),
)

export const GeneratePlanParameters = Schema.Struct({ assetKey: Schema.String })

export const AssetGenerateTestPlanTool = Tool.define<typeof GeneratePlanParameters, { totalPlanItems: unknown }, never>(
  "asset_generate_test_plan",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: GeneratePlanParameters,
      execute: (params: Schema.Schema.Type<typeof GeneratePlanParameters>, ctx: Tool.Context<{ totalPlanItems: unknown }>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "completion", patterns: ["*"], always: ["*"], metadata: {} })
          const rows = yield* runReadEffect(
            `MATCH (a:Asset {id: $assetKey})-[:EXPOSES]->(e:Endpoint) RETURN e`,
            { assetKey: params.assetKey },
          )
          if (!rows.length)
            throw new Error(`No endpoints for asset ${params.assetKey} — recon has not written any yet`)
          const planItems: Array<{ endpointKey: string; vulnClass: VulnClass; taskLabel: string }> = []
          for (const row of rows) {
            const props = rowProps(row as Record<string, unknown>)
            for (const vulnClass of applicableVulnClasses(props)) {
              planItems.push({ endpointKey: props.url || params.assetKey, vulnClass, taskLabel: `${vulnClass}: ${props.url}` })
            }
          }
          return {
            title: `plan ${planItems.length} items`,
            output: JSON.stringify({
              assetKey: params.assetKey,
              totalEndpoints: rows.length,
              totalPlanItems: planItems.length,
              planItems,
              note: `This is the real plan — ${planItems.length} items. Seed todowrite with every one, not a summary.`,
            }),
            metadata: { totalPlanItems: planItems.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof GeneratePlanParameters, { totalPlanItems: unknown }>
  }),
)
