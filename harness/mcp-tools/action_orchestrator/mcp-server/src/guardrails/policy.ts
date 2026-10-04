import { appendFileSync } from "node:fs";
import { config, getSharedScope } from "../config.js";
import { logger } from "../lib/logger.js";

function hostMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) || host === pattern.slice(2);
  }
  return host === pattern;
}

/**
 * Checks whether `targetUrl` is permitted by the shared scope file
 * (same file scope-gate.ts loads). Fail-closed: empty inScope rejects all.
 * outOfScope always wins over inScope. Matches scope-gate.ts semantics.
 */
export function checkScope(targetUrl: string): void {
  const scope = getSharedScope();
  let host: string;
  try {
    host = new URL(targetUrl.includes("://") ? targetUrl : `https://${targetUrl}`).hostname;
  } catch {
    host = targetUrl;
  }
  if (scope.outOfScope.some((p) => hostMatches(p, host))) {
    throw new Error(`Target "${targetUrl}" is explicitly out of scope for ${scope.programId}.`);
  }
  if (!scope.inScope.some((p) => hostMatches(p, host))) {
    throw new Error(
      `Target "${targetUrl}" is not in the scope allowlist for ${scope.programId}. ` +
        `In-scope patterns: ${scope.inScope.join(", ")}`,
    );
  }
}

const RATE_FLAG_PATTERN = /-rate[= ](\d+)|--rate-limit[= ](\d+)/i;

/**
 * Backstop: enforces per-lane rate from scope.maxRequestsPerSecond across
 * parallel jobs. Returns perLaneRate for workflow env injection
 * (RATE_LIMIT_PER_SEC). Only catches recognizable flags in free-form
 * extraArgs — env injection is the reliable half.
 */
export function checkRateBudget(jobPlan: { jobs: Array<{ extraArgs?: string }> }): number {
  const scope = getSharedScope();
  const laneCount = Math.max(1, jobPlan.jobs.length);
  const perLaneRate = scope.maxRequestsPerSecond / laneCount;
  for (const job of jobPlan.jobs) {
    const match = job.extraArgs?.match(RATE_FLAG_PATTERN);
    const declared = match ? Number(match[1] ?? match[2]) : null;
    if (declared !== null && declared > perLaneRate * 1.5) {
      throw new Error(
        `Job extraArgs declares rate ${declared}/s, exceeding per-lane budget ` +
          `${perLaneRate.toFixed(1)}/s (${scope.maxRequestsPerSecond}/s / ${laneCount} lanes).`,
      );
    }
  }
  return perLaneRate;
}

export interface AuditEntry {
  timestamp: string;
  taskId: string;
  targetUrl: string;
  runId?: number;
  action: string;
  details?: Record<string, unknown>;
}

/**
 * Appends a structured audit entry to the local audit log.
 * Never throws — audit failures are logged but don't break the flow.
 */
export function writeAuditLog(entry: AuditEntry): void {
  try {
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(config.AUDIT_LOG_PATH, line, "utf8");
  } catch (err) {
    logger.warn({ err }, "Failed to write audit log entry");
  }
}

/**
 * Checks the per-plan job-count cap. Concurrent workflow-run limits are enforced
 * by the process-wide run coordinator at dispatch time.
 */
export function checkVolumeCaps(jobCount: number): void {
  if (jobCount > config.MAX_JOBS_PER_PLAN) {
    throw new Error(
      `Job plan has ${jobCount} jobs, which exceeds MAX_JOBS_PER_PLAN=${config.MAX_JOBS_PER_PLAN}. ` +
        `Split the plan into smaller batches or raise the cap in your configuration.`,
    );
  }
}
