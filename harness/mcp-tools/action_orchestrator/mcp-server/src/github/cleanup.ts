import { getOctokit } from "./client.js";
import { logger } from "../lib/logger.js";

/**
 * Deletes a workflow run from GitHub.
 * Call this after artifacts have been safely retrieved.
 */
export async function cleanupRun(
  owner: string,
  repo: string,
  runId: number,
): Promise<void> {
  const octokit = getOctokit();
  await octokit.rest.actions.deleteWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });
  logger.info({ owner, repo, runId }, "Workflow run deleted");
}

/**
 * Deletes the workflow file for a given task from the repo.
 * Optional — use if you want to clean up the workflow definition after a task.
 */
export async function cleanupWorkflowFile(
  owner: string,
  repo: string,
  filePath: string,
  commitMessage?: string,
): Promise<void> {
  const octokit = getOctokit();
  const branch = process.env["GITHUB_DEFAULT_BRANCH"] ?? "main";

  // Get the current SHA of the file (required for deletion)
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: filePath,
    ref: branch,
  });

  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Cannot delete — ${filePath} is not a file or was not found`);
  }

  await octokit.rest.repos.deleteFile({
    owner,
    repo,
    path: filePath,
    message: commitMessage ?? `chore: remove completed task workflow ${filePath}`,
    sha: data.sha,
    branch,
  });

  logger.info({ owner, repo, filePath }, "Workflow file deleted");
}
