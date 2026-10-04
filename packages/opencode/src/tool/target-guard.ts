// Target guard — framework-agnostic wrapper (no Tool.define, no zod),
// same shape as scope-gate.ts. Applied in registry.ts to the shell and
// webfetch defs so EVERY agent (including task-spawned subagents) hits it.
//
// Why this exists: prompt rules ("never curl the target, use the
// session-aware tools") were observed not holding — bash is always
// available and curl is the path of least resistance, so target traffic
// kept bypassing scope, rate limits, and evidence capture. This makes
// that path a thrown error instead of a discouraged option.
//
// What it does NOT do: block bash or webfetch entirely. Local operations
// (installing tools, reading files, which <binary>) and off-scope URLs
// (methodology docs, package registries) pass through untouched. It only
// fires when a command/URL demonstrably matches a LOADED engagement
// scope — with no scope loaded (plain coding use) nothing is blocked.
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { findScopeForTarget } from "./scope-gate"

// Binaries whose primary job is a direct HTTP/network request. If one of
// these shows up in a shell segment with a URL matching loaded scope, the
// call belongs in a session-aware tool instead.
const RAW_REQUEST_BINARIES = new Set(["curl", "wget", "http", "httpie", "nc", "ncat", "telnet", "socat"])

const URL_PATTERN = /https?:\/\/[a-zA-Z0-9.\-]+(?::\d+)?(?:\/[^\s"'|;&]*)?/g

function segmentsOf(command: string): string[] {
  return command.split(/[\n;]+|\|\||\|(?!\|)|\&\&/g)
}

function guardedCommand(command: string): { binary: string; url: string; programId: string } | null {
  if (!command.trim()) return null
  for (const segment of segmentsOf(command)) {
    const firstWord = segment
      .trim()
      .split(/\s+/)[0]
      ?.replace(/^.*\//, "")
      .toLowerCase()
    if (!firstWord || !RAW_REQUEST_BINARIES.has(firstWord)) continue
    const urls = segment.match(URL_PATTERN) ?? []
    for (const url of urls) {
      const scope = findScopeForTarget(url)
      if (scope) return { binary: firstWord, url, programId: scope.programId }
    }
  }
  return null
}

function guardedUrl(url: unknown): { url: string; programId: string } | null {
  if (typeof url !== "string" || !url) return null
  const scope = findScopeForTarget(url)
  return scope ? { url, programId: scope.programId } : null
}

function refusal(binary: string, url: string, programId: string): string {
  return (
    `Blocked: this call fetches ${url} directly via ${binary}, bypassing scope, rate limits, and evidence capture ` +
    `(program ${programId}). Live-target HTTP must go through a session-aware tool: ` +
    `content_discovery or js_extract_endpoints for enumeration, ` +
    `browser_navigate / browser_fill_and_submit for interactive testing, ` +
    `mitm_replay_flow for replaying a captured flow, mitm_fuzz_endpoint for fuzzing. ` +
    `bash and webfetch remain available for local work and off-scope URLs.`
  )
}

export function withTargetGuard<P extends Schema.Decoder<unknown>, M extends Tool.Metadata>(
  def: Tool.Def<P, M>,
): Tool.Def<P, M> {
  const original = def.execute
  const execute: Tool.Def<P, M>["execute"] = (args, ctx) =>
    Effect.gen(function* () {
      const record = args as Record<string, unknown>
      if (typeof record["command"] === "string") {
        const hit = guardedCommand(record["command"])
        if (hit) throw new Error(refusal(hit.binary, hit.url, hit.programId))
      }
      if (typeof record["url"] === "string") {
        const hit = guardedUrl(record["url"])
        if (hit) throw new Error(refusal("webfetch", hit.url, hit.programId))
      }
      return yield* original(args, ctx)
    })
  return { ...def, execute }
}
