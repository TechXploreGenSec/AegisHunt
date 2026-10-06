import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./bot-ops.txt"
import { runReadEffect } from "./graph-db"
import { DIVERGENT_MIN } from "./completion-engine"

function code() {
  return Math.random().toString(36).slice(2, 6).toUpperCase()
}

const supabaseEffect = () =>
  Effect.promise(async () => {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_KEY
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    const { createClient } = await import("@supabase/supabase-js").catch(() => ({ createClient: null }))
    if (!createClient) throw new Error("supabase-js not installed")
    return createClient(url, key)
  })

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// Structured MarkdownV2 notification: the non-blocking behavior is VISIBLE
// in the message itself ("Continuing meanwhile" vs "Paused until this
// resolves"), so a silent stop after notifying is spottable on a phone
// skim — by the operator, and by the model re-reading its own output.
function notifyMessage(
  code: string,
  programId: string,
  question: string,
  blocking: boolean,
  continuingWith: string[],
  stayingPaused: string[],
): string {
  const lines = [
    `${blocking ? "⛔ *APPROVAL NEEDED*" : "❓ *INPUT NEEDED*"} \`${code}\``,
    `📋 ${escapeMdV2(programId)}`,
    ``,
    escapeMdV2(question),
    ``,
  ]
  if (continuingWith.length > 0) {
    lines.push(`🔄 *Continuing meanwhile:*`)
    for (const item of continuingWith) lines.push(`• ${escapeMdV2(item)}`)
    lines.push(``)
  }
  if (stayingPaused.length > 0) {
    lines.push(`⏸ *Paused until this resolves:*`)
    for (const item of stayingPaused) lines.push(`• ${escapeMdV2(item)}`)
    lines.push(``)
  }
  if (blocking) lines.push(`⚠️ Explicit yes required — silence keeps this thread paused\\.`, ``)
  lines.push(`↩️ Reply \`${code} <answer>\` whenever you have time — no rush, work continues\\.`)
  return lines.join("\n")
}

export const HOLD_TEMPLATE = [
  `⏸ <b>HOLD</b> — run winding down, work remains`,
  `Program: <code>{programId}</code>`,
  `Endpoints: found {found} · tested {tested} · confirmed {confirmed}`,
  `Hypotheses: open {open} · verified {verified}`,
  `Findings: {findings}`,
  `Blocked on: {blocked}`,
  `Stop reason: {reason}`,
].join("\n")

function telegramEffect(botName: string, text: string, parseMode: "HTML" | "MarkdownV2" = "HTML") {
  return Effect.promise(async () => {
    const token =
      process.env[`TELEGRAM_${botName.toUpperCase().replace("-", "_")}_TOKEN`] ??
      process.env.TELEGRAM_BOT_ASK_INPUT_TOKEN
    const chat = process.env.TELEGRAM_CHAT_ID
    if (!token || !chat) throw new Error("telegram env not set")
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: parseMode }),
    })
  })
}

// MarkdownV2 requires escaping outside intentional formatting —
// centralized here so every structured message escapes identically.
function escapeMdV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1")
}

function formatProgressBar(percent: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return "▓".repeat(filled) + "░".repeat(width - filled)
}

export const NotifyParameters = Schema.Struct({
  programId: Schema.String,
  question: Schema.String,
  requiresExplicitApproval: Schema.optional(Schema.Boolean),
  continuingWith: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Surfaces/vectors proceeding in parallel while this waits — shown under 'Continuing meanwhile'",
  }),
  stayingPaused: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "What genuinely cannot proceed until this resolves — shown under 'Paused until this resolves'",
  }),
  botName: Schema.optional(
    Schema.Literals(["bot-approve", "bot-ask-input", "bot-general", "bot-report"]),
  ),
})
type NotifyMeta = { correlationCode: unknown }

export const BotNotifyTool = Tool.define<typeof NotifyParameters, NotifyMeta, never>(
  "bot_notify_and_continue",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: NotifyParameters,
      execute: (params: Schema.Schema.Type<typeof NotifyParameters>, ctx: Tool.Context<NotifyMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "bot_ops", patterns: ["*"], always: ["*"], metadata: {} })
          const c = code()
          const blocking = params.requiresExplicitApproval ?? false
          yield* telegramEffect(
            params.botName ?? "bot-ask-input",
            notifyMessage(
              c,
              params.programId,
              params.question,
              blocking,
              params.continuingWith ?? [],
              params.stayingPaused ?? [],
            ),
            "MarkdownV2",
          )
          const client = yield* supabaseEffect()
          yield* Effect.promise(() =>
            client.from("agent_tasks").insert({
              id: crypto.randomUUID(),
              program_id: params.programId,
              correlation_code: c,
              question: params.question,
              blocking,
              status: "blocked",
            }),
          )
          return {
            title: `blocked ${c}`,
            output: JSON.stringify({
              status: "blocked_non_fatal",
              correlationCode: c,
              instruction: "Do not stop session. Other in-scope work continues.",
            }),
            metadata: { correlationCode: c },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof NotifyParameters, NotifyMeta>
  }),
)

export const CheckParameters = Schema.Struct({ programId: Schema.String })
type CheckMeta = { resolved: unknown }

export const BotCheckRepliesTool = Tool.define<typeof CheckParameters, CheckMeta, never>(
  "bot_check_replies",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: CheckParameters,
      execute: (params: Schema.Schema.Type<typeof CheckParameters>, ctx: Tool.Context<CheckMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "bot_ops", patterns: ["*"], always: ["*"], metadata: {} })
          const client = yield* supabaseEffect()
          const { data: pending, error } = yield* Effect.promise(() =>
            client.from("agent_tasks").select().eq("program_id", params.programId).eq("status", "blocked"),
          )
          if (error) throw new Error(error.message)
          if (!pending?.length) return { title: "no pending", output: "[]", metadata: { resolved: [] } }
          const token = process.env.TELEGRAM_BOT_ASK_INPUT_TOKEN
          const updates: Array<{ message?: { text?: string } }> = yield* Effect.promise(async () => {
            if (!token) return []
            const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=5`)
            const j = (await res.json()) as { result: Array<{ message?: { text?: string } }> }
            return j.result
          })
          const resolved: Array<unknown> = []
          for (const u of updates) {
            const text = u.message?.text
            if (!text) continue
            const match = (pending as Array<{ correlation_code: string; id: string; blocking: boolean }>).find((t) =>
              text.toUpperCase().startsWith(t.correlation_code),
            )
            if (!match) continue
            const reply = text.slice(match.correlation_code.length).trim()
            yield* Effect.promise(() =>
              client.from("agent_tasks").update({ status: "resolved", reply }).eq("id", match.id),
            )
            resolved.push({ correlationCode: match.correlation_code, reply })
          }
          return {
            title: `${resolved.length} resolved`,
            output: JSON.stringify(resolved),
            metadata: { resolved },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof CheckParameters, CheckMeta>
  }),
)

export const HoldParameters = Schema.Struct({
  programId: Schema.String,
  reason: Schema.String.annotate({ description: "Specifically why nothing further can proceed anywhere in scope" }),
  assetsCompleted: Schema.Number,
  assetsTotal: Schema.Number,
  currentAssetKey: Schema.optional(Schema.String.annotate({ description: "Current asset — hold is refused unless it reports complete" })),
  botName: Schema.optional(
    Schema.Literals(["bot-approve", "bot-ask-input", "bot-general", "bot-report"]),
  ),
})
type HoldMeta = { sent: unknown }

export const BotHoldTool = Tool.define<typeof HoldParameters, HoldMeta, never>(
  "bot_notify_hold",
  Effect.gen(function* () {
    return {
      description:
        "Send a HOLD notification with full run context. Use ONLY when there is genuinely no further work possible anywhere in scope — per-thread blockers use bot_notify_and_continue instead.",
      parameters: HoldParameters,
      execute: (params: Schema.Schema.Type<typeof HoldParameters>, ctx: Tool.Context<HoldMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "bot_ops", patterns: ["*"], always: ["*"], metadata: {} })
          if (params.reason.trim().length < 20)
            throw new Error("reason must be >= 20 chars — say specifically what blocks everything")
          // Mechanical gate (not persuasion): the call fails outright
          // unless the queue is genuinely empty and the current asset is
          // genuinely complete. If this throws, its message names the
          // remaining work — go do that instead of stopping.
          const qp = { programId: params.programId }
          const assetRows = yield* runReadEffect(
            `MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId RETURN a.id AS asset, count(e) AS total`,
            qp,
          )
          const testedRows = yield* runReadEffect(
            `MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId AND (e)-[:SUGGESTS]->(h:Hypothesis)-[:TESTED_BY]->(t:TestExecution) AND t.outcome IN ['confirmed', 'ruled_out'] RETURN a.id AS asset, count(DISTINCT e) AS tested`,
            qp,
          )
          const blockedRows = yield* runReadEffect(
            `MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint) WHERE e.program_id = $programId AND e.blocked_reason IS NOT NULL RETURN a.id AS asset, count(e) AS blocked`,
            qp,
          )
          const num = (v: unknown): number => {
            if (typeof v === "number") return v
            if (v !== null && typeof v === "object" && "toNumber" in v) {
              const fn = (v as { toNumber: unknown }).toNumber
              if (typeof fn === "function") return (fn as () => number)()
            }
            return 0
          }
          const testedBy = new Map<string, number>()
          for (const r of testedRows) testedBy.set(String((r as Record<string, unknown>)["asset"]), num((r as Record<string, unknown>)["tested"]))
          const blockedBy = new Map<string, number>()
          for (const r of blockedRows) blockedBy.set(String((r as Record<string, unknown>)["asset"]), num((r as Record<string, unknown>)["blocked"]))
          const divRows = yield* runReadEffect(
            `MATCH (a:Asset)-[:EXPOSES]->(e:Endpoint)-[:SUGGESTS]->(h:Hypothesis) WHERE e.program_id = $programId AND h.vuln_class = 'other' AND size(coalesce(h.fingerprint_refs, [])) >= 2 RETURN a.id AS asset, count(DISTINCT h) AS div`,
            qp,
          )
          const divByAsset = new Map<string, number>()
          for (const r of divRows) divByAsset.set(String((r as Record<string, unknown>)["asset"]), num((r as Record<string, unknown>)["div"]))
          const incomplete = assetRows
            .map((r) => {
              const asset = String((r as Record<string, unknown>)["asset"])
              const total = num((r as Record<string, unknown>)["total"])
              const div = divByAsset.get(asset) ?? 0
              return {
                asset,
                left: total - (testedBy.get(asset) ?? 0) - (blockedBy.get(asset) ?? 0),
                divShort: Math.max(0, DIVERGENT_MIN - div),
              }
            })
            .filter((a) => a.left > 0 || a.divShort > 0)
          if (incomplete.length > 0) {
            throw new Error(
              `Cannot hold — ${incomplete.length} asset(s) still incomplete: ${incomplete.map((a) => `${a.asset} (${a.left} endpoints left, ${a.divShort} divergent hypotheses short)`).join(", ")}. Move to the next one instead of stopping.`,
            )
          }
          if (params.currentAssetKey) {
            const cur = assetRows.find((r) => String((r as Record<string, unknown>)["asset"]) === params.currentAssetKey)
            if (cur) {
              const total = num((cur as Record<string, unknown>)["total"])
              const tested = testedBy.get(params.currentAssetKey) ?? 0
              const blocked = blockedBy.get(params.currentAssetKey) ?? 0
              const div = divByAsset.get(params.currentAssetKey) ?? 0
              if (tested + blocked < total || div < DIVERGENT_MIN) {
                throw new Error(
                  `Cannot hold — current asset ${params.currentAssetKey} is only ${total === 0 ? 0 : Math.round(((tested + blocked) / total) * 100)}% complete (${total - tested - blocked} endpoints untested, ${blocked} blocked, ${div}/${DIVERGENT_MIN} divergent hypotheses). Finish, document blockers, and think divergently first.`,
                )
              }
            }
          }
          const overall = params.assetsTotal === 0 ? 0 : Math.round((params.assetsCompleted / params.assetsTotal) * 100)
          const text = [
            `\u{1F6D1} *HOLD \u2014 run stopped*`,
            ``,
            `*Progress:* ${escapeMdV2(formatProgressBar(overall))} ${overall}% \\({params.assetsCompleted}/${params.assetsTotal} assets\\)`,
            ``,
            `*Program:* ${escapeMdV2(params.programId)}`,
            ``,
            `*Why:*`,
            escapeMdV2(params.reason),
            ``,
            `_Reply to resume once this is resolved \u2014 the run does not continue on its own from here._`,
          ].join("\n")
          yield* telegramEffect(params.botName ?? "bot-general", text, "MarkdownV2")
          return {
            title: `hold ${params.programId}`,
            output: JSON.stringify({ sent: true, programId: params.programId }),
            metadata: { sent: true },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof HoldParameters, HoldMeta>
  }),
)
