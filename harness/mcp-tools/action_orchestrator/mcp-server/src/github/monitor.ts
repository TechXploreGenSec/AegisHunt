import { getOctokit } from "./client.js";
import { logger } from "../lib/logger.js";
import type { JobStatus, JobItem } from "../schemas/jobStatus.js";

const DEFAULT_TAIL_LINES = 80;

/**
 * Returns the current status of a workflow run, including per-job status.
 */
export async function pollStatus(
  owner: string,
  repo: string,
  runId: number,
): Promise<JobStatus> {
  const octokit = getOctokit();

  const [{ data: run }, { data: jobsData }] = await Promise.all([
    octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId }),
    octokit.rest.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: runId,
      per_page: 100,
    }),
  ]);

  const jobs: JobItem[] = jobsData.jobs.map((j) => {
    // Extract the matrix index from the job name if present (e.g. "run-chunk (0)")
    const indexMatch = /\((\d+)\)$/.exec(j.name);
    return {
      jobId: j.id,
      index: indexMatch ? parseInt(indexMatch[1]!, 10) : undefined,
      name: j.name,
      status: j.status as JobItem["status"],
      conclusion: (j.conclusion ?? null) as JobItem["conclusion"],
      startedAt: j.started_at ?? null,
      completedAt: j.completed_at ?? null,
    };
  });

  return {
    runId,
    status: run.status as JobStatus["status"],
    conclusion: (run.conclusion ?? null) as JobStatus["conclusion"],
    jobs,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

/**
 * Downloads the log for a specific job and returns the tail.
 * GitHub API returns a redirect to a temporary log archive URL — we follow it.
 */
export async function getJobLogs(
  owner: string,
  repo: string,
  jobId: number,
  tailLines: number = DEFAULT_TAIL_LINES,
): Promise<string> {
  const octokit = getOctokit();

  // This endpoint returns a 302 redirect; Octokit follows it and returns the URL
  let logUrl: string;
  try {
    const response = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: jobId,
    });
    // Octokit resolves the redirect and gives us the final URL in response.url
    logUrl = (response as unknown as { url: string }).url;
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return "(No logs available — job may still be queued or logs have expired)";
    }
    throw err;
  }

  logger.debug({ jobId, logUrl }, "Fetching job logs");

  const resp = await fetch(logUrl);
  if (!resp.ok) {
    logger.warn({ jobId, status: resp.status }, "Failed to fetch log content");
    return `(Failed to download logs: HTTP ${resp.status})`;
  }

  const text = await resp.text();

  // Strip GitHub's timestamp prefix (e.g. "2026-08-04T12:00:00.0000000Z ") from each line
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /, ""));

  const tail = lines.slice(-tailLines);
  return tail.join("\n");
}
