// Single source of truth for the vulnerability-class taxonomy.
//
// Structural rule: VulnClass, VULN_CLASSES, applicableVulnClasses(), and the
// scopeExclusions-filtering helpers live ONLY here. hypothesis-propose.ts,
// finding-produce.ts, completion-engine.ts, and scope-set.ts all import from
// this module — never their own copies. Every enum change or trigger-rule
// change happens in exactly one place, so per-gate copies can never drift
// out of sync again (that drift produced unsatisfiable coverage/completion
// gates: gates demanding classes that propose refuses).
//
// Design line, enforced: entries here are DETECTION categories (observable
// triggers), never impact descriptors. privilege-escalation is impact — it
// belongs in finding severity/summary, not this enum. Mass-assignment IS a
// detection category (bindable body accepting extra fields) and earns its
// own entry with its own trigger rule.
import { scopeExclusions } from "./scope-gate"

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
  "mass-assignment",
  "other",
] as const
export type VulnClass = (typeof VULN_CLASSES)[number]

export function isVulnClass(value: string): value is VulnClass {
  return (VULN_CLASSES as readonly string[]).includes(value)
}

export interface EndpointProps {
  url: string
  method?: string
  contentType?: string
  requiresAuth?: boolean
  paramNames?: string[]
}

function isWriteMethod(method: string | undefined): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes((method ?? "GET").toUpperCase())
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
  if (isWriteMethod(ep.method)) classes.add("business-logic")
  // Mass-assignment trigger: state-changing method with bindable fields.
  // Distinct from business-logic (workflow abuse) — this is unfiltered
  // parameter binding (ORM update(req.body) persisting role/isAdmin/etc).
  if (isWriteMethod(ep.method) && (params.length > 0 || path.includes("/api/"))) classes.add("mass-assignment")
  return [...classes]
}

// Union of program-excluded classes across the given program IDs.
export function excludedForPrograms(programIds: Iterable<string>): Set<string> {
  const excluded = new Set<string>()
  for (const pid of programIds) {
    if (typeof pid === "string" && pid) for (const c of scopeExclusions(pid).excluded) excluded.add(c)
  }
  return excluded
}

// Applicable classes minus program exclusions — the ONLY set any gate may
// demand hypotheses, tests, or kills for. Demanding anything outside this
// set recreates the unsatisfiable-gate deadlock.
export function applicableForPrograms(ep: EndpointProps, programIds: Iterable<string>): VulnClass[] {
  const excluded = excludedForPrograms(programIds)
  return applicableVulnClasses(ep).filter((c) => !excluded.has(c))
}
