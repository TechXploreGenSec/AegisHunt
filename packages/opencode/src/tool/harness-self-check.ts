import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./harness-self-check.txt"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { runReadEffect } from "./graph-db"
import { recordToolCall, findMatchingToolCall } from "./tool_call_audit"
import { Database } from "bun:sqlite"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { homedir } from "node:os"

export const Parameters = Schema.Struct({
  programId: Schema.String.annotate({ description: "Program the upcoming engagement targets (scopes graph + audit checks)" }),
})

type Metadata = { sufficient: unknown }

const EXPECTED_AGENTS = ["coordinator", "recon", "verification", "reporting", "mentor"]

// Permission keys as actually asked by each tool (NOT tool ids — several differ).
const REQUIRED_PERMS: Record<string, string[]> = {
  coordinator: [
    "scope",
    "asset_focus",
    "asset_progress",
    "completion",
    "todo_coverage",
    "bot_ops",
    "finding",
    "task",
    "todowrite",
    "phase_complete",
    "read",
    "methodology",
    "tool_catalog",
  ],
  recon: ["content_discovery", "phase_complete", "bot_ops", "asset_progress", "webfetch", "read", "tool_catalog", "methodology"],
  verification: [
    "finding",
    "browser_navigate",
    "mitm_replay_flow",
    "mitm_fuzz_endpoint",
    "oob",
    "asset_progress",
    "completion",
    "bot_ops",
    "methodology",
    "read",
    "phase_complete",
  ],
  reporting: ["finding", "read", "write"],
}

const EXPECTED_SKILLS = ["bb-methodology", "web2-recon", "web2-vuln-classes", "triage-validation", "security-arsenal"]
const SKILL_PREFIX_ANY = ["recon-skills-"]

const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "NEO4J_URI",
  "NEO4J_USER",
  "NEO4J_PASSWORD",
  "TELEGRAM_BOT_GENERAL_TOKEN",
  "TELEGRAM_CHAT_ID",
]

function countMarkdown(dir: string, depth: number, budget: { n: number }): number {
  if (depth < 0 || budget.n <= 0) return 0
  let found = 0
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const e of entries) {
    if (budget.n <= 0) break
    budget.n--
    const full = join(dir, e)
    let st = null
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) found += countMarkdown(full, depth - 1, budget)
    else if (e.endsWith(".md")) found++
  }
  return found
}

// Neo4j hands back integers as Integer objects ({ low, high }) and counts as
// strings in some aggregation paths — never as JS primitives. Mirrors the toNum
// convention in asset-progress.ts so both read the same values the same way.
//
// Must call it as a METHOD (`value.toNumber()`), never detached
// (`const fn = value.toNumber; fn()`): driver 6.2.0 defines toNumber as
// `function () { return this.high * … + (this.low >>> 0) }`, so a detached call
// throws "undefined is not an object (evaluating 'this.high')".
function toNum(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value) || 0
  if (value !== null && typeof value === "object" && "toNumber" in value) {
    const fn = (value as { toNumber: () => number }).toNumber
    if (typeof fn === "function") return fn.call(value)
  }
  return 0
}

export const HarnessSelfCheckTool = Tool.define<typeof Parameters, Metadata, Agent.Service | Skill.Service>(
  "harness_self_check",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const skill = yield* Skill.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "harness", patterns: ["*"], always: ["*"], metadata: {} })
          const failures: string[] = []
          const report: Record<string, unknown> = { programId: params.programId }

          // 1. agents registered
          const listed = yield* agents.list()
          const haveAgents = new Set(listed.map((a) => a.name))
          const missingAgents = EXPECTED_AGENTS.filter((a) => !haveAgents.has(a))
          report["agents"] = { found: listed.length, missing: missingAgents }
          if (missingAgents.length)
            failures.push(`agents missing: ${missingAgents.join(", ")} — native harness agents not registered (check agent.ts)`)

          const mentorInfo = listed.find((a) => a.name === "mentor")
          if (mentorInfo) {
            const leaks: string[] = []
            for (const key of ["browser_navigate", "finding", "read", "task", "todowrite", "graph", "bot_ops", "methodology", "mitm_replay_flow", "content_discovery"]) {
              if (Permission.evaluate(key, "*", mentorInfo.permission).action === "allow") leaks.push(key)
            }
            if (leaks.length) failures.push(`mentor holds tools (must stay pure): ${leaks.join(", ")}`)
            else report["mentor"] = { pure: true }
          }
          // 2. per-agent tool permissions (+ question must stay denied everywhere)
          const permGaps: string[] = []
          for (const name of EXPECTED_AGENTS) {
            const info = listed.find((a) => a.name === name)
            if (!info) continue
            for (const key of REQUIRED_PERMS[name] ?? []) {
              const action = Permission.evaluate(key, "*", info.permission).action
              if (action === "deny") permGaps.push(`${name} denied ${key}`)
            }
            const q = Permission.evaluate("question", "*", info.permission).action
            if (q !== "deny") permGaps.push(`${name} can question (stop-and-wait fallback open!)`)
          }
          const coordInfo = listed.find((a) => a.name === "coordinator")
          if (coordInfo && Permission.evaluate("task", "mentor", coordInfo.permission).action === "deny")
            permGaps.push("coordinator cannot delegate to mentor (task->mentor denied)")
          report["permissions"] = { gaps: permGaps }
          if (permGaps.length)
            failures.push(`permission gaps: ${permGaps.join("; ")} — fix agent.ts permission blocks`)

          // 3. skills installed (real resolution path via Skill service)
          const allSkills = yield* skill.all()
          const skillNames = new Set(allSkills.map((s) => s.name))
          const missingSkills = EXPECTED_SKILLS.filter((s) => !skillNames.has(s))
          const hasPrefixed = SKILL_PREFIX_ANY.map((p) => ({
            prefix: p,
            found: [...skillNames].filter((n) => n.startsWith(p)).length,
          }))
          report["skills"] = { found: allSkills.length, missing: missingSkills, prefixed: hasPrefixed }
          if (missingSkills.length)
            failures.push(`skills missing: ${missingSkills.join(", ")} — run fetch-methodology.sh`)
          for (const h of hasPrefixed) {
            if (!h.found) failures.push(`no skills with prefix ${h.prefix} — run fetch-methodology.sh`)
          }

          // 4. methodology source readable
          const srcDir = resolve(process.env.METHODOLOGY_SOURCE_PATH ?? join(homedir(), "hacktricks"))
          const mdCount = existsSync(srcDir) ? countMarkdown(srcDir, 3, { n: 2000 }) : 0
          report["methodologySource"] = { dir: srcDir, markdownFiles: mdCount }
          if (!mdCount)
            failures.push(`methodology source empty/missing at ${srcDir} — run fetch-methodology.sh, then methodology_index_build`)

          // 5. methodology index queryable
          const indexPath = resolve(process.env.METHODOLOGY_INDEX_PATH ?? "./methodology_index.db")
          let chunks = -1
          try {
            const db = new Database(indexPath, { readonly: true })
            const row = db.prepare("SELECT COUNT(*) AS c FROM chunks").get() as { c: number } | null
            chunks = typeof row?.c === "number" ? row.c : 0
            db.close()
          } catch {
            chunks = -1
          }
          report["methodologyIndex"] = { path: indexPath, chunks }
          if (chunks <= 0)
            failures.push(`methodology index unusable at ${indexPath} (chunks=${chunks}) — run methodology_index_build`)

          // 6. graph reachable
          let graphOk = false
          try {
            const rows = yield* runReadEffect("RETURN 1 AS ok", {})
            // Neo4j returns integers as Integer objects ({ low, high }), never as a
            // JS primitive, so a strict `=== 1` is ALWAYS false — which reported a
            // permanently-unreachable graph no matter how healthy the DB was. Convert
            // first, same convention as asset-progress.ts toNum().
            graphOk = toNum((rows[0] as Record<string, unknown> | undefined)?.["ok"]) === 1
          } catch {
            graphOk = false
          }
          report["graph"] = { reachable: graphOk }
          if (!graphOk) failures.push("Neo4j unreachable — check NEO4J_URI/USER/PASSWORD and Aura status")

          // 7. audit log closed-loop (write then read back)
          let auditOk = false
          try {
            const id = recordToolCall(params.programId, "harness_self_check", "self-check")
            const back = findMatchingToolCall(params.programId, "self-check", undefined, 5)
            auditOk = back?.id === id
          } catch {
            auditOk = false
          }
          report["auditLog"] = { closedLoop: auditOk }
          if (!auditOk) failures.push("audit log write/read failed — check AUDIT_DB_PATH directory is writable")

          // 8. required env present (presence only — never values, never connectivity, never spam)
          const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k])
          report["env"] = { missing: missingEnv }
          if (missingEnv.length) failures.push(`env missing: ${missingEnv.join(", ")} — source .env.bb before launching`)

          if (failures.length) {
            throw new Error(
              `Harness self-check FAILED (${failures.length}):\n- ` +
                failures.join("\n- ") +
                `\nResolve every item, then re-run harness_self_check before scoping.`,
            )
          }
          return {
            title: "harness self-check passed",
            output: JSON.stringify({ ...report, sufficient: true }),
            metadata: { sufficient: true },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
