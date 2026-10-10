import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { recordToolCall } from "./tool_call_audit"
import DESCRIPTION from "./browser-session.txt"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdir, readFile } from "node:fs/promises"
import { getLoadedScope, observeScope, scopeRequestHeaders } from "./scope-gate"
import type { Browser, Page } from "playwright"

const REALISTIC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

type Channel = "chromium" | "chrome" | "msedge"

type NetEntry = { url: string; method: string; status: number | null; type: string; timestampMs: number }
type ConEntry = { level: string; text: string; timestampMs: number }

interface SessionEntry {
  browser: Browser
  page: Page
  networkLog: NetEntry[]
  consoleLog: ConEntry[]
}

// Keyed by program + display mode + engine so the agent can hold e.g. a
// headed-Chrome session and a headless-Chromium one side by side. Cookies,
// storage, and logs are NOT shared between modes — each entry is its own
// browser process. Defaults everywhere: headed real Chrome.
const sessions = new Map<string, SessionEntry>()

const sessionKey = (programId: string, headless: boolean, channel: Channel) =>
  `${programId}|${headless ? "headless" : "headed"}|${channel}`

const ModeMixin = {
  headless: Schema.optional(Schema.Boolean).annotate({
    description: "false (default) = headed, looks interactive; true = headless, faster. Each mode is a separate session.",
  }),
  channel: Schema.optional(Schema.Literals(["chromium", "chrome", "msedge"])).annotate({
    description: "Browser engine. Defaults to chrome (real installed Chrome), falls back to bundled Chromium.",
  }),
}

function resolveMode(params: { headless?: boolean; channel?: Channel }): { headless: boolean; channel: Channel } {
  return { headless: params.headless ?? false, channel: params.channel ?? "chrome" }
}

function getSessionEffect(programId: string, headless: boolean, channel: Channel) {
  return Effect.promise(async () => {
    const key = sessionKey(programId, headless, channel)
    const existing = sessions.get(key)
    if (existing) return { entry: existing, key }
    const mod = await import("playwright").catch(() => null)
    if (!mod) throw new Error('playwright not installed — run "bun add playwright"')
    // Enforced Tor bypass: Playwright honors env proxy unless told otherwise.
    const launchOpts: Parameters<typeof mod.chromium.launch>[0] = { headless, proxy: { server: "per-context" } }
    if (channel !== "chromium") launchOpts.channel = channel
    // Prefer the real installed browser; fall back to bundled Chromium
    // so a missing channel binary degrades instead of failing the session.
    let browser
    try {
      browser = await mod.chromium.launch(launchOpts)
    } catch {
      if (channel === "chromium") throw new Error("Chromium launch failed — run 'bunx playwright install chromium'")
      browser = await mod.chromium.launch({ headless, proxy: { server: "per-context" } })
    }
    // Program-mandated identity rides on every browser context; falls back
    // to the realistic default when the scope declares none.
    const scopeHeaders = scopeRequestHeaders(getLoadedScope(programId))
    const context = await browser.newContext({
      viewport: { width: 1366, height: 850 },
      userAgent: scopeHeaders["User-Agent"] ?? REALISTIC_UA,
    })
    if (Object.keys(scopeHeaders).length > 0) {
      const { "User-Agent": _ua, ...extra } = scopeHeaders
      void _ua
      if (Object.keys(extra).length > 0) await context.setExtraHTTPHeaders(extra)
    }
    const page = await context.newPage()
    const entry: SessionEntry = { browser, page, networkLog: [], consoleLog: [] }
    page.on("request", (req) => {
      entry.networkLog.push({
        url: req.url(),
        method: req.method(),
        status: null,
        type: req.resourceType(),
        timestampMs: Date.now(),
      })
    })
    page.on("response", (res) => {
      const match = entry.networkLog.find((e) => e.url === res.url() && e.status === null)
      if (match) match.status = res.status()
    })
    page.on("console", (msg) => {
      entry.consoleLog.push({ level: msg.type(), text: msg.text(), timestampMs: Date.now() })
    })
    sessions.set(key, entry)
    return { entry, key }
  })
}

function liveCheck(programId: string, target: string) {
  return Effect.sync(() => {
    const scope = getLoadedScope(programId)
    if (target) observeScope(scope, programId, "browser", target)
    return scope
  })
}

export const NavigateParameters = Schema.Struct({
  programId: Schema.String,
  url: Schema.String,
  ...ModeMixin,
  waitUntil: Schema.optional(Schema.Literals(["load", "domcontentloaded", "networkidle"])),
})
type NavMeta = { status: unknown; finalUrl: unknown }

export const BrowserNavigateTool = Tool.define<typeof NavigateParameters, NavMeta, never>(
  "browser_navigate",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: NavigateParameters,
      execute: (params: Schema.Schema.Type<typeof NavigateParameters>, ctx: Tool.Context<NavMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "browser_navigate", patterns: [params.url], always: [], metadata: {} })
          yield* liveCheck(params.programId, params.url)
          const mode = resolveMode(params)
          const { entry } = yield* getSessionEffect(params.programId, mode.headless, mode.channel)
          const res = yield* Effect.promise(() =>
            entry.page.goto(params.url, { waitUntil: params.waitUntil ?? "networkidle", timeout: 30000 }),
          )
          const finalUrl = entry.page.url()
          const title = yield* Effect.promise(() => entry.page.title())
          const status = res?.status() ?? null
          // Bot-block signal: tell the model the exact next move (escalate
          // to headed) rather than leaving it to infer from a bare 403.
          const blocked =
            (status !== null && [403, 429, 503].includes(status)) ||
            /challenge|captcha|access denied|forbidden|unusual traffic/i.test(title)
          const hint =
            blocked && mode.headless
              ? " Bot-detection likely: retry the same call with headless:false (headed real Chrome)."
              : ""
          recordToolCall(params.programId, "browser_navigate", finalUrl)
          return {
            title: `${status} ${title}`,
            output: JSON.stringify({ status, finalUrl, title, mode, blocked, hint }),
            metadata: { status, finalUrl },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof NavigateParameters, NavMeta>
  }),
)

export const ScreenshotParameters = Schema.Struct({
  programId: Schema.String,
  fullPage: Schema.optional(Schema.Boolean),
  ...ModeMixin,
})
type ShotMeta = { url: unknown }

export const BrowserScreenshotTool = Tool.define<typeof ScreenshotParameters, ShotMeta, never>(
  "browser_screenshot",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: ScreenshotParameters,
      execute: (params: Schema.Schema.Type<typeof ScreenshotParameters>, ctx: Tool.Context<ShotMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "browser_navigate", patterns: ["*"], always: ["*"], metadata: {} })
          const mode = resolveMode(params)
          const { entry } = yield* getSessionEffect(params.programId, mode.headless, mode.channel)
          const buf = yield* Effect.promise(() => entry.page.screenshot({ fullPage: params.fullPage ?? false }))
          return {
            title: "screenshot",
            output: "screenshot captured",
            metadata: {
              url: entry.page.url(),
              ...( { imageBase64: Buffer.from(buf).toString("base64") } as unknown as Record<string, unknown> ),
            } as unknown as ShotMeta,
          }
        }),
    } satisfies Tool.DefWithoutID<typeof ScreenshotParameters, ShotMeta>
  }),
)

export const FillParameters = Schema.Struct({
  programId: Schema.String,
  fields: Schema.Array(Schema.Struct({ selector: Schema.String, value: Schema.String })),
  submitSelector: Schema.optional(Schema.String),
  ...ModeMixin,
})
type FillMeta = { finalUrl: unknown }

export const BrowserFillAndSubmitTool = Tool.define<typeof FillParameters, FillMeta, never>(
  "browser_fill_and_submit",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: FillParameters,
      execute: (params: Schema.Schema.Type<typeof FillParameters>, ctx: Tool.Context<FillMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "browser_navigate", patterns: ["*"], always: [], metadata: {} })
          const scope = getLoadedScope(params.programId)
          const mode = resolveMode(params)
          const { entry } = yield* getSessionEffect(params.programId, mode.headless, mode.channel)
          const current = entry.page.url()
          if (current && current !== "about:blank") observeScope(scope, params.programId, "browser_fill_and_submit", current)
          for (const f of params.fields) {
            yield* Effect.promise(() => entry.page.fill(f.selector, f.value))
          }
          if (params.submitSelector) {
            yield* Effect.promise(() =>
              Promise.all([
                entry.page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }).catch(() => null),
                entry.page.click(params.submitSelector as string),
              ]).then(() => undefined),
            )
          }
          const finalUrl = entry.page.url()
          recordToolCall(params.programId, "browser_fill_and_submit", finalUrl)
          return {
            title: `filled ${finalUrl}`,
            output: JSON.stringify({ finalUrl, title: yield* Effect.promise(() => entry.page.title()), mode }),
            metadata: { finalUrl },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof FillParameters, FillMeta>
  }),
)

export const NetLogParameters = Schema.Struct({
  programId: Schema.String,
  onlyFailed: Schema.optional(Schema.Boolean),
  ...ModeMixin,
})
type NetLogMeta = { requests: unknown }

export const BrowserNetworkLogTool = Tool.define<typeof NetLogParameters, NetLogMeta, never>(
  "browser_get_network_log",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: NetLogParameters,
      execute: (params: Schema.Schema.Type<typeof NetLogParameters>, ctx: Tool.Context<NetLogMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "browser_navigate", patterns: ["*"], always: ["*"], metadata: {} })
          const mode = resolveMode(params)
          const log = sessions.get(sessionKey(params.programId, mode.headless, mode.channel))?.networkLog ?? []
          const requests = params.onlyFailed ? log.filter((r) => r.status === null || r.status >= 400) : log
          return {
            title: `${requests.length} requests`,
            output: JSON.stringify(requests),
            metadata: { requests },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof NetLogParameters, NetLogMeta>
  }),
)

export const ConLogParameters = Schema.Struct({ programId: Schema.String, ...ModeMixin })
type ConLogMeta = { messages: unknown }

export const BrowserConsoleLogTool = Tool.define<typeof ConLogParameters, ConLogMeta, never>(
  "browser_get_console_log",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: ConLogParameters,
      execute: (params: Schema.Schema.Type<typeof ConLogParameters>, ctx: Tool.Context<ConLogMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "browser_navigate", patterns: ["*"], always: ["*"], metadata: {} })
          const mode = resolveMode(params)
          const messages =
            sessions.get(sessionKey(params.programId, mode.headless, mode.channel))?.consoleLog ?? []
          return {
            title: `${messages.length} console messages`,
            output: JSON.stringify(messages),
            metadata: { messages },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof ConLogParameters, ConLogMeta>
  }),
)

export const PerfParameters = Schema.Struct({ programId: Schema.String, ...ModeMixin })
type PerfMeta = { timing: unknown }

export const BrowserPerfTimingTool = Tool.define<typeof PerfParameters, PerfMeta, never>(
  "browser_get_performance_timing",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: PerfParameters,
      execute: (params: Schema.Schema.Type<typeof PerfParameters>, ctx: Tool.Context<PerfMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "browser_navigate", patterns: ["*"], always: ["*"], metadata: {} })
          const mode = resolveMode(params)
          const session = sessions.get(sessionKey(params.programId, mode.headless, mode.channel))
          if (!session)
            throw new Error(
              `No ${mode.headless ? "headless" : "headed"}-${mode.channel} session for ${params.programId} — navigate first in that mode`,
            )
          const timing = yield* Effect.promise(() =>
            session.page.evaluate(() => JSON.stringify(performance.getEntriesByType("navigation"))),
          )
          return {
            title: "navigation timing",
            output: timing as string,
            metadata: { timing: JSON.parse(timing as string) },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof PerfParameters, PerfMeta>
  }),
)


export const PageContentParameters = Schema.Struct({
  programId: Schema.String,
  maxChars: Schema.optional(Schema.Number.annotate({ description: "Max HTML chars returned, default 30000" })),
  ...ModeMixin,
})
type PageContentMeta = { url: unknown; truncated: unknown }

export const BrowserPageContentTool = Tool.define<typeof PageContentParameters, PageContentMeta, never>(
  "browser_get_page_content",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: PageContentParameters,
      execute: (params: Schema.Schema.Type<typeof PageContentParameters>, ctx: Tool.Context<PageContentMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "browser_navigate", patterns: ["*"], always: [], metadata: {} })
          const mode = resolveMode(params)
          const { entry } = yield* getSessionEffect(params.programId, mode.headless, mode.channel)
          const url = entry.page.url()
          if (url && url !== "about:blank") {
            const scope = getLoadedScope(params.programId)
            observeScope(scope, params.programId, "browser_get_page_content", url)
          }
          const html = yield* Effect.promise(() => entry.page.content())
          const max = Math.min(Math.max(Math.round(params.maxChars ?? 30000), 1000), 200000)
          const truncated = html.length > max
          return {
            title: `page content ${html.length} chars`,
            output: JSON.stringify({ url, truncated, length: html.length, html: truncated ? html.slice(0, max) : html }),
            metadata: { url, truncated },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof PageContentParameters, PageContentMeta>
  }),
)

export const ClickDownloadParameters = Schema.Struct({
  programId: Schema.String,
  selector: Schema.String.annotate({ description: "CSS selector of the link/button that triggers the download" }),
  timeoutSeconds: Schema.optional(Schema.Number.annotate({ description: "Wait for download event, default 20" })),
  ...ModeMixin,
})
type ClickDownloadMeta = { savedPath: unknown; size: unknown }

export const BrowserClickDownloadTool = Tool.define<typeof ClickDownloadParameters, ClickDownloadMeta, never>(
  "browser_click_and_download",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: ClickDownloadParameters,
      execute: (params: Schema.Schema.Type<typeof ClickDownloadParameters>, ctx: Tool.Context<ClickDownloadMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "browser_navigate", patterns: ["*"], always: [], metadata: {} })
          const scope = getLoadedScope(params.programId)
          const mode = resolveMode(params)
          const { entry } = yield* getSessionEffect(params.programId, mode.headless, mode.channel)
          const url = entry.page.url()
          if (url && url !== "about:blank") observeScope(scope, params.programId, "browser_click_and_download", url)
          const timeout = Math.min(Math.max((params.timeoutSeconds ?? 20) * 1000, 5000), 60000)
          const dir = join(tmpdir(), `opencode-dl-${params.programId}`)
          yield* Effect.promise(() => mkdir(dir, { recursive: true }))
          const [download] = yield* Effect.promise(() =>
            Promise.all([
              entry.page.waitForEvent("download", { timeout }).catch((e: unknown) => {
                throw new Error(`no download started within timeout: ${e instanceof Error ? e.message : String(e)}`)
              }),
              entry.page.click(params.selector),
            ]),
          )
          const suggested = download.suggestedFilename().replace(/[/\\]/g, "_")
          const savedPath = join(dir, `${Date.now()}-${suggested}`)
          yield* Effect.promise(() => download.saveAs(savedPath))
          const buf = yield* Effect.promise(() => readFile(savedPath))
          let preview = ""
          try {
            preview = buf.toString("utf8").slice(0, 4000)
          } catch {
            preview = "<binary>"
          }
          return {
            title: `downloaded ${suggested} (${buf.length} bytes)`,
            output: JSON.stringify({
              savedPath,
              fileName: suggested,
              size: buf.length,
              truncated: buf.length > 4000,
              preview,
            }),
            metadata: { savedPath, size: buf.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof ClickDownloadParameters, ClickDownloadMeta>
  }),
)

export const CloseParameters = Schema.Struct({
  programId: Schema.String,
  all: Schema.optional(Schema.Boolean).annotate({
    description: "Close every session (all modes) for the program. Default closes only the selected mode.",
  }),
  ...ModeMixin,
})
type CloseMeta = { closed: unknown }

export const BrowserCloseSessionTool = Tool.define<typeof CloseParameters, CloseMeta, never>(
  "browser_close_session",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: CloseParameters,
      execute: (params: Schema.Schema.Type<typeof CloseParameters>, ctx: Tool.Context<CloseMeta>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "browser_navigate", patterns: ["*"], always: ["*"], metadata: {} })
          const mode = resolveMode(params)
          let closed = 0
          if (params.all) {
            for (const [key, session] of [...sessions]) {
              if (key.startsWith(`${params.programId}|`)) {
                yield* Effect.promise(() => session.browser.close())
                sessions.delete(key)
                closed++
              }
            }
          } else {
            const session = sessions.get(sessionKey(params.programId, mode.headless, mode.channel))
            if (session) {
              yield* Effect.promise(() => session.browser.close())
              sessions.delete(sessionKey(params.programId, mode.headless, mode.channel))
              closed = 1
            }
          }
          return {
            title: closed ? `${closed} session(s) closed` : "no session",
            output: JSON.stringify({ closed }),
            metadata: { closed },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof CloseParameters, CloseMeta>
  }),
)

export const browserTools = [
  BrowserNavigateTool,
  BrowserScreenshotTool,
  BrowserFillAndSubmitTool,
  BrowserNetworkLogTool,
  BrowserConsoleLogTool,
  BrowserPerfTimingTool,
  BrowserCloseSessionTool,
]
