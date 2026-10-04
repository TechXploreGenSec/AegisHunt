import { getOctokit } from "./client.js";
import { logger } from "../lib/logger.js";

/**
 * Re-runs a single job by job ID.
 * The decision to retry (and whether to tweak the plan first) belongs to the LLM.
 */
export async function retryJob(
  owner: string,
  repo: string,
  jobId: number,
): Promise<void> {
  const octokit = getOctokit();
  await octokit.rest.actions.reRunJobForWorkflowRun({
    owner,
    repo,
    job_id: jobId,
    enable_debug_logging: false,
  });
  logger.info({ owner, repo, jobId }, "Job rerun triggered");
}

/**
 * Re-runs all failed jobs in a workflow run.
 */
export async function retryFailedJobs(
  owner: string,
  repo: string,
  runId: number,
): Promise<void> {
  const octokit = getOctokit();
  await octokit.rest.actions.reRunWorkflowFailedJobs({
    owner,
    repo,
    run_id: runId,
    enable_debug_logging: false,
  });
  logger.info({ owner, repo, runId }, "Failed jobs rerun triggered");
}
