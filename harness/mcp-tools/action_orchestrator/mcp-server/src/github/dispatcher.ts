import { getOctokit } from "./client.js";
import { logger } from "../lib/logger.js";
import type { JobPlan } from "../schemas/jobPlan.js";

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Triggers a workflow_dispatch event and returns the resulting workflow run ID.
 *
 * GitHub's dispatch endpoint returns 204 (no body) — the run ID isn't handed
 * back directly. We record the timestamp before dispatching, wait briefly,
 * then poll the run list until we find a run created after that point.
 */
export async function triggerRun(
  owner: string,
  repo: string,
  workflowFile: string,
  jobPlan?: JobPlan,
  customInputs?: Record<string, string>,
): Promise<number> {
  const octokit = getOctokit();
  const ref = process.env["GITHUB_DEFAULT_BRANCH"] ?? "main";

  let inputs: Record<string, string> = {};
  if (customInputs) {
    inputs = { ...customInputs };
  }
  if (jobPlan) {
    inputs["job_plan"] = JSON.stringify(jobPlan.jobs);
  }

  const dispatchedAfter = new Date();
  dispatchedAfter.setSeconds(dispatchedAfter.getSeconds() - 5); // 5s buffer for clock skew

  logger.info({ owner, repo, workflowFile, inputsKeys: Object.keys(inputs) }, "Dispatching workflow");

  await octokit.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowFile,
    ref,
    inputs,
  });

  logger.info("Dispatch sent, polling for run ID…");

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const { data } = await octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: workflowFile,
      event: "workflow_dispatch",
      per_page: 10,
    });

    const run = data.workflow_runs.find(
      (r) => new Date(r.created_at) >= dispatchedAfter,
    );

    if (run) {
      logger.info({ runId: run.id }, "Found run ID");
      return run.id;
    }

    logger.debug({ attempt, maxAttempts: MAX_POLL_ATTEMPTS }, "Run not found yet, retrying…");
  }

  throw new Error(
    `Could not find the new run ID after ${MAX_POLL_ATTEMPTS} attempts. ` +
      `The dispatch likely succeeded — check GitHub directly for workflow: ${workflowFile}`,
  );
}
