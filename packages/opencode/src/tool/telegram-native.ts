import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./telegram-native.txt"

const TOKENS: Record<string, string | undefined> = {
  "bot-approve": process.env.TELEGRAM_BOT_APPROVE_TOKEN,
  "bot-ask-input": process.env.TELEGRAM_BOT_ASK_INPUT_TOKEN,
  "bot-general": process.env.TELEGRAM_BOT_GENERAL_TOKEN,
  "bot-report": process.env.TELEGRAM_BOT_REPORT_TOKEN,
}
const offsets: Record<string, number> = {}

function tokenFor(bot: string) {
  const t = TOKENS[bot] ?? process.env[`TELEGRAM_${bot.toUpperCase().replace("-", "_")}_TOKEN`]
  if (!t) throw new Error(`No token for ${bot}`)
  return t
}

export const SendParameters = Schema.Struct({
  botName: Schema.Literals(["bot-approve", "bot-ask-input", "bot-general", "bot-report"]),
  text: Schema.String,
  parseMode: Schema.optional(Schema.Literals(["Markdown", "MarkdownV2", "HTML"])),
})
type SendMeta = { messageId: unknown }

export const TelegramSendTool = Tool.define<typeof SendParameters, SendMeta, never>(
  "telegram_send_message",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: SendParameters,
      execute: (params: Schema.Schema.Type<typeof SendParameters>, ctx: Tool.Context<SendMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "telegram", patterns: ["*"], always: ["*"], metadata: {} })
          const chat = process.env.TELEGRAM_CHAT_ID
          if (!chat) throw new Error("TELEGRAM_CHAT_ID not set")
          const data = yield* Effect.promise(async () => {
            const res = await fetch(`https://api.telegram.org/bot${tokenFor(params.botName)}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chat,
                text: params.text,
                ...(params.parseMode ? { parse_mode: params.parseMode } : {}),
              }),
            })
            return (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number } }
          })
          if (!data.ok) throw new Error(`sendMessage failed: ${data.description}`)
          return {
            title: `sent ${data.result?.message_id}`,
            output: JSON.stringify({ messageId: data.result?.message_id }),
            metadata: { messageId: data.result?.message_id },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof SendParameters, SendMeta>
  }),
)

export const UpdatesParameters = Schema.Struct({
  botName: Schema.Literals(["bot-approve", "bot-ask-input", "bot-general", "bot-report"]),
  timeoutSeconds: Schema.optional(Schema.Number),
})
type UpdatesMeta = { updates: unknown }

export const TelegramUpdatesTool = Tool.define<typeof UpdatesParameters, UpdatesMeta, never>(
  "telegram_get_updates",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: UpdatesParameters,
      execute: (params: Schema.Schema.Type<typeof UpdatesParameters>, ctx: Tool.Context<UpdatesMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "telegram", patterns: ["*"], always: ["*"], metadata: {} })
          const updates = yield* Effect.promise(async () => {
            const url = new URL(`https://api.telegram.org/bot${tokenFor(params.botName)}/getUpdates`)
            url.searchParams.set("timeout", String(params.timeoutSeconds ?? 5))
            if (offsets[params.botName]) url.searchParams.set("offset", String(offsets[params.botName]))
            const res = await fetch(url.toString())
            const data = (await res.json()) as { ok: boolean; result: Array<{ update_id: number }> }
            if (data.result.length > 0) offsets[params.botName] = data.result[data.result.length - 1].update_id + 1
            return data.result
          })
          return { title: `${updates.length} updates`, output: JSON.stringify(updates), metadata: { updates } }
        }),
    } satisfies Tool.DefWithoutID<typeof UpdatesParameters, UpdatesMeta>
  }),
)
