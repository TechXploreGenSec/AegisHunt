import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./completion-engine.txt"
import { runReadEffect, runWriteEffect } from "./graph-db"
import {
  applicableForPrograms,
  applicableVulnClasses,
  excludedForPrograms,
  type EndpointProps,
  type VulnClass,
} from "./vuln-classes"

// Floor for divergent (unclassifiable, fingerprint-anchored) hypotheses per
// asset. Single source — asset_progress_get, asset_get_queue, the hold gate,
// and the watchdog all enforce this same constant.
export const DIVERGENT_MIN = 3

// Transparent, auditable completeness: which vuln classes even apply to an
// endpoint (simple explainable rules on observable properties, see
// vuln-classes.ts — the single source of truth), and how many of those have
// a real TestExecution or triage kill behind them. The model never declares
// "done" — endpoint_mark_assessed refuses unless the computed score is complete.
export function rowProps(row: Record<string, unknown>): EndpointProps {
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
    // Action-1 fix: the score MUST filter program-excluded classes, exactly
    // like plan generation and coverage do. An unfiltered set here re-creates
    // the deadlock one gate over: mark_assessed demanding resolution for a
    // class propose refuses outright.
    const epNode = (epRows[0] as Record<string, unknown>)["e"] as { properties?: Record<string, unknown> } | undefined
    const epProps = (epNode?.properties ?? epRows[0]) as Record<string, unknown>
    const epProgram = epProps["program_id"]
    const applicable = applicableForPrograms(
      rowProps(epRows[0] as Record<string, unknown>),
      typeof epProgram === "string" && epProgram ? [epProgram] : [],
    )
    const testedRows = yield* runReadEffect(
      `MATCH (e:Endpoint {id: $key})-[:SUGGESTS]->(h:Hypothesis)-[:TESTED_BY]->(t:TestExecution) WHERE t.outcome IN ['confirmed', 'ruled_out'] RETURN DISTINCT h.vuln_class AS vulnClass`,
      { key: endpointKey },
    )
    // Killed-by-triage classes are resolved without testing — triage would
    // refuse them, so demanding test spend on them manufactures junk.
    const killedRows = yield* runReadEffect(
      `MATCH (e:Endpoint {id: $key})-[:SUGGESTS]->(h:Hypothesis) WHERE h.status = 'killed' RETURN DISTINCT h.vuln_class AS vulnClass`,
      { key: endpointKey },
    )
    const testedClasses = [
      ...new Set([
        ...testedRows.map((r) => String((r as Record<string, unknown>)["vulnClass"])),
        ...killedRows.map((r) => String((r as Record<string, unknown>)["vulnClass"])),
      ]),
    ]
    const missing = applicable.filter((c) => !testedClasses.includes(c))
    const score = applicable.length === 0 ? 1 : Math.round(((applicable.length - missing.length) / applicable.length) * 100) / 100
    const divRows = yield* runReadEffect(
      `MATCH (e:Endpoint {id: $key})-[:SUGGESTS]->(h:Hypothesis) WHERE h.vuln_class = 'other' AND h.status <> 'killed' AND size(coalesce(h.fingerprint_refs, [])) >= 2 RETURN count(DISTINCT h) AS div`,
      { key: endpointKey },
    )
    const toCount = (v: unknown): number => {
      if (typeof v === "number") return v
      if (v !== null && typeof v === "object" && "toNumber" in v) {
        // call as a method: driver 6.2.0's Integer.toNumber reads this.high/this.low,
        // so a detached call throws instead of converting
        const fn = (v as { toNumber: () => number }).toNumber
        if (typeof fn === "function") return fn.call(v)
      }
      return 0
    }
    const divergent = toCount((divRows[0] as Record<string, unknown> | undefined)?.["div"])
    const divergentReady = divergent >= DIVERGENT_MIN
    return {
      endpointKey,
      applicableClasses: applicable,
      testedClasses,
      missingClasses: missing,
      score,
      divergent,
      divergentRequired: DIVERGENT_MIN,
      divergentReady,
      ready: missing.length === 0 && divergentReady,
    }
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
            const gaps = [
              ...(s.missingClasses.length
                ? [`missing coverage for: ${s.missingClasses.join(", ")} — propose and test a hypothesis for each`]
                : []),
              ...(!s.divergentReady
                ? [
                    `only ${s.divergent}/${s.divergentRequired} anchored divergent hypotheses — propose ${s.divergentRequired - s.divergent} more vulnClass 'other' hypotheses with >=2 fingerprintRefs each`,
                  ]
                : []),
            ]
            throw new Error(
              `Cannot mark ${params.endpointKey} assessed — ${gaps.join("; ")}. ` +
                `Or asset_mark_blocker the endpoint if it genuinely cannot be tested.`,
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
          const planPrograms = new Set<string>()
          for (const pe of yield* runReadEffect(`MATCH (a:Asset {id: $assetKey})-[:EXPOSES]->(e:Endpoint) RETURN DISTINCT e.program_id AS programId`, { assetKey: params.assetKey })) {
            const pid = (pe as Record<string, unknown>)["programId"]
            if (typeof pid === "string" && pid) planPrograms.add(pid)
          }
          const planExcluded = excludedForPrograms(planPrograms)
          for (const row of rows) {
            const props = rowProps(row as Record<string, unknown>)
            for (const vulnClass of applicableVulnClasses(props).filter((c) => !planExcluded.has(c))) {
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

export const HypCoverageParameters = Schema.Struct({ assetKey: Schema.String })

export const HypothesisCoverageCheckTool = Tool.define<typeof HypCoverageParameters, { sufficient: unknown }, never>(
  "hypothesis_coverage_check",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: HypCoverageParameters,
      execute: (params: Schema.Schema.Type<typeof HypCoverageParameters>, ctx: Tool.Context<{ sufficient: unknown }>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "completion", patterns: ["*"], always: ["*"], metadata: {} })
          const rows = yield* runReadEffect(
            `MATCH (a:Asset {id: $assetKey})-[:EXPOSES]->(e:Endpoint)
             OPTIONAL MATCH (e)-[:SUGGESTS]->(h:Hypothesis)
             OPTIONAL MATCH (e)-[:HAS_PARAMETER]->(p:Parameter)-[:SUGGESTS]->(h2:Hypothesis)
             RETURN e, collect(DISTINCT h.vuln_class) AS direct, collect(DISTINCT h2.vuln_class) AS viaParam`,
            { assetKey: params.assetKey },
          )
          if (!rows.length)
            throw new Error(`No endpoints for asset ${params.assetKey} — recon has not written any yet`)
          // Program-excluded classes are unsatisfiable here (propose refuses
          // them) — demanding them would fail this gate forever.
          const covPrograms = new Set<string>()
          for (const pe of yield* runReadEffect(`MATCH (a:Asset {id: $assetKey})-[:EXPOSES]->(e:Endpoint) RETURN DISTINCT e.program_id AS programId`, { assetKey: params.assetKey })) {
            const pid = (pe as Record<string, unknown>)["programId"]
            if (typeof pid === "string" && pid) covPrograms.add(pid)
          }
          const covExcluded = excludedForPrograms(covPrograms)
          const missing: Array<{ endpointKey: string; vulnClass: string }> = []
          let total = 0
          for (const row of rows) {
            const props = rowProps(row as Record<string, unknown>)
            const have = new Set<string>([
              ...((row as Record<string, unknown>)["direct"] as string[] ?? []),
              ...((row as Record<string, unknown>)["viaParam"] as string[] ?? []),
            ])
            for (const vulnClass of applicableVulnClasses(props).filter((c) => !covExcluded.has(c))) {
              total++
              if (!have.has(vulnClass)) missing.push({ endpointKey: props.url || params.assetKey, vulnClass })
            }
          }
          if (missing.length > 0) {
            const shown = missing.slice(0, 12).map((m) => `${m.vulnClass}: ${m.endpointKey}`).join("; ")
            const more = missing.length > 12 ? ` (+${missing.length - 12} more)` : ""
            throw new Error(
              `Hypothesis coverage short: ${missing.length}/${total} (endpoint, class) pairs have no hypothesis: ${shown}${more}. ` +
                `Propose one per missing pair — or file a REJECT kill (triageVerdict REJECT + verdictReason) for pairs triage would refuse — then retry.`,
            )
          }
          return {
            title: `hypotheses cover ${total} pairs`,
            output: JSON.stringify({ assetKey: params.assetKey, totalPairs: total, missing: 0, sufficient: true }),
            metadata: { sufficient: true },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof HypCoverageParameters, { sufficient: unknown }>
  }),
)
