// Scope gate — framework-agnostic helper (no Tool.define, no zod).
// Single source of truth: JSON file loaded via loadScopeConfig, read by both
// opencode tools and gh-runner via SCOPE_CONFIG_PATH. Fail-closed: empty inScope rejects all.
import { readFile } from "node:fs/promises"

export interface ScopeConfig {
  programId: string
  inScope: string[]
  outOfScope: string[]
  allowedTestTypes: string[]
  maxRequestsPerSecond: number
  executionMode: "local" | "gh-runner" | "auto"
}

const cache = new Map<string, ScopeConfig>()

function assertScope(u: unknown): asserts u is ScopeConfig {
  const s = u as Record<string, unknown>
  if (typeof s.programId !== "string") throw new Error("scope programId must be string")
  if (!Array.isArray(s.inScope)) throw new Error("scope inScope must be array")
  if (typeof s.maxRequestsPerSecond !== "number" || s.maxRequestsPerSecond <= 0)
    throw new Error("scope maxRequestsPerSecond must be positive number")
}

export async function loadScopeConfig(programId: string, filePath: string): Promise<ScopeConfig> {
  const raw = await readFile(filePath, "utf-8")
  const parsed = JSON.parse(raw) as ScopeConfig
  if (parsed.programId !== programId) throw new Error(`programId mismatch: expected ${programId}`)
  parsed.outOfScope ??= []
  parsed.allowedTestTypes ??= []
  parsed.executionMode ??= "local"
  assertScope(parsed)
  cache.set(programId, parsed)
  return parsed
}

export function getLoadedScope(programId: string): ScopeConfig {
  const s = cache.get(programId)
  if (!s) throw new Error(`No scope loaded for ${programId} — call loadScopeConfig first`)
  return s
}

/** All scopes loaded in this process (scope_set per engagement). Empty until scope_set runs. */
export function listLoadedScopes(): ScopeConfig[] {
  return [...cache.values()]
}

/**
 * First loaded scope whose inScope patterns match the target, else null.
 * Used by the target guard: shell/webfetch calls are refused only when
 * they demonstrably hit a loaded engagement scope — with no scope loaded
 * (plain coding use) everything passes through untouched.
 */
export function findScopeForTarget(target: string): ScopeConfig | null {
  for (const scope of cache.values()) {
    try {
      if (isInScope(scope, target)) return scope
    } catch {
      continue
    }
  }
  return null
}

/** Direct cache set for in-session scope paste (scope_set tool). Same validation as file load. */
export function setScopeConfig(scope: ScopeConfig): ScopeConfig {
  scope.outOfScope ??= []
  scope.allowedTestTypes ??= []
  scope.executionMode ??= "local"
  assertScope(scope)
  if (scope.inScope.length === 0) throw new Error("inScope must contain at least one pattern — fail-closed")
  cache.set(scope.programId, scope)
  return scope
}

/** Where scope files live for sharing with gh-runner via SCOPE_CONFIG_PATH. */
export function scopeFilePath(programId: string): string {
  const dir = process.env.SCOPE_DIR ?? "./scopes"
  return `${dir}/${programId}.json`
}

/**
 * Fixed pointer the runner's SCOPE_CONFIG_PATH aims at. scope_set mirrors
 * every program file here so a single static env covers all engagements.
 */
export function currentScopeFile(): string {
  const dir = process.env.SCOPE_DIR ?? "./scopes"
  return `${dir}/current.json`
}

function hostMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1)
    return host.endsWith(suffix) || host === pattern.slice(2)
  }
  return host === pattern
}

export function isInScope(scope: ScopeConfig, target: string): boolean {
  let host: string
  try {
    host = new URL(target.includes("://") ? target : `https://${target}`).hostname
  } catch {
    host = target
  }
  if (scope.outOfScope.some((p) => hostMatches(p, host))) return false
  return scope.inScope.some((p) => hostMatches(p, host))
}

export function computePerLaneRate(scope: ScopeConfig, laneCount: number): number {
  if (laneCount < 1) throw new Error("laneCount must be >= 1")
  return scope.maxRequestsPerSecond / laneCount
}

export const LIVE_TARGET_TOOLS = new Set([
  "content_discovery",
  "port_scan",
  "vhost_bruteforce",
  "browser_navigate",
  "browser_fill_and_submit",
  "http_request",
  "http_replay",
  "mitm_replay_flow",
  "mitm_fuzz_endpoint",
])
