// Scope gate — framework-agnostic helper (no Tool.define, no zod).
// Single source of truth: JSON file loaded via loadScopeConfig, read by both
// opencode tools and gh-runner via SCOPE_CONFIG_PATH.
//
// Observe-not-block: tools NEVER refuse on scope grounds. When a target
// falls outside the loaded scope (or no scope is loaded at all), the call
// proceeds and the deviation is recorded to the audit log for operator
// review (see noteScopeDeviation / tool_call_audit_get). Explicit
// outOfScope exclusions are still honored inside matching.
import { readFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { noteScopeDeviation } from "./tool_call_audit"

export interface ScopeConfig {
  programId: string
  inScope: string[]
  outOfScope: string[]
  allowedTestTypes: string[]
  maxRequestsPerSecond: number
  executionMode: "local" | "gh-runner" | "auto"
  /** Runtime-only. When true, every target is allowed (still logs nothing —
   *  there is no loaded scope to deviate from). Never persisted by scope_set. */
  unrestricted?: boolean
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
  const cached = cache.get(programId)
  if (cached) return cached
  // Survives restarts: the operator-placed scope file reloads itself on
  // first use. When nothing is on disk, tools get an unrestricted scope
  // instead of refusing — see observeScope.
  return (
    ensureScope(programId) ?? {
      programId,
      inScope: [],
      outOfScope: [],
      allowedTestTypes: ["active-recon", "interaction"],
      maxRequestsPerSecond: 5,
      executionMode: "local",
      unrestricted: true,
    }
  )
}

/**
 * Best-effort reload of an operator-written scope file into the cache.
 * Tries SCOPE_DIR/<programId>.json, then the current.json mirror (which
 * must name the same program — a different program's file is NOT accepted).
 * Returns null (never throws) when nothing usable is on disk.
 */
export function ensureScope(programId: string): ScopeConfig | null {
  if (cache.has(programId)) return cache.get(programId)!
  const tryFile = (filePath: string): ScopeConfig | null => {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ScopeConfig
      if (parsed.programId !== programId) return null
      return setScopeConfig(parsed)
    } catch {
      return null
    }
  }
  return tryFile(scopeFilePath(programId)) ?? tryFile(currentScopeFile())
}

/** All scopes loaded in this process (scope_set per engagement). Empty until scope_set runs. */
export function listLoadedScopes(): ScopeConfig[] {
  return [...cache.values()]
}

/**
 * First loaded scope whose inScope patterns match the target, else null.
 * Used by the target guard for attribution (which scope, if any, a
 * raw-request call touches) — the guard logs and allows, never refuses.
 */
export function findScopeForTarget(target: string): ScopeConfig | null {
  if (cache.size === 0) {
    // Guard calls carry no programId — fall back to the operator's
    // designated current scope so a restart doesn't silently disarm the
    // bash/webfetch guard while tools reload theirs per-program.
    try {
      const parsed = JSON.parse(readFileSync(currentScopeFile(), "utf-8")) as ScopeConfig
      setScopeConfig(parsed)
    } catch {
      // no usable file — guard allows, tools fall back to unrestricted scope
    }
  }
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
  if (scope.inScope.length === 0) {
    // Empty scope declares no boundary: everything is allowed (explicit
    // outOfScope exclusions still honored). Recorded as unrestricted so
    // observe-not-block tooling treats it as declared-open, not missing.
    scope.unrestricted = true
    if (scope.allowedTestTypes.length === 0) scope.allowedTestTypes = ["active-recon", "interaction"]
  }
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
  if (scope.unrestricted) return true
  return scope.inScope.some((p) => hostMatches(p, host))
}

/**
 * Observe-not-block checkpoint for live-target tools. Returns the scope
 * for rate math; NEVER throws. When a loaded (non-unrestricted) scope
 * does not cover the target — or does not declare the required test type —
 * the deviation is recorded for operator review and the call proceeds.
 */
export function observeScope(
  scope: ScopeConfig,
  programId: string,
  toolName: string,
  target: string,
  requiredTestType?: string,
): ScopeConfig {
  if (!scope.unrestricted) {
    if (!isInScope(scope, target)) noteScopeDeviation(programId, toolName, target, "outside-loaded-scope")
    if (requiredTestType && !scope.allowedTestTypes.includes(requiredTestType))
      noteScopeDeviation(programId, toolName, target, `${requiredTestType}-not-declared`)
  }
  return scope
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
