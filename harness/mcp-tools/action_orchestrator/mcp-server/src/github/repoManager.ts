import { getOctokit } from "./client.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

export interface RepoCoords {
  owner: string;
  repo: string;
}

const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function validateRepositoryName(repo: string): void {
  if (!REPOSITORY_NAME_PATTERN.test(repo)) {
    throw new Error(
      `Invalid repository name "${repo}". Use only letters, numbers, dots, underscores, and dashes.`,
    );
  }
}

/**
 * Ensures the configured task repo exists.
 * Idempotent: safe to call on every task — if the repo already exists it returns
 * successfully without modifying it.
 */
export async function ensureTaskRepo(repoName: string = config.GITHUB_REPO): Promise<RepoCoords> {
  const octokit = getOctokit();
  validateRepositoryName(repoName);
  const { owner, repo } = { owner: config.GITHUB_OWNER, repo: repoName };

  try {
    await octokit.rest.repos.get({ owner, repo });
    logger.info({ owner, repo }, "Task repo already exists");
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      logger.info({ owner, repo }, "Creating task repo");
      const { data: authenticatedUser } = await octokit.rest.users.getAuthenticated();
      const createParams = {
        name: repo,
        private: true,
        auto_init: true,
        description: "MCP GitHub Actions compute orchestrator — task runner repo",
      };

      try {
        if (authenticatedUser.login.toLowerCase() === owner.toLowerCase()) {
          await octokit.rest.repos.createForAuthenticatedUser(createParams);
        } else {
          await octokit.rest.repos.createInOrg({ org: owner, ...createParams });
        }
        logger.info({ owner, repo }, "Task repo created");
      } catch (createErr: unknown) {
        const createStatus = (createErr as { status?: number }).status;
        if (createStatus === 403) {
          logger.warn({ owner, repo }, "Fine-grained PAT blocked repo creation; falling back to default GITHUB_REPO");
          const defaultRepo = config.GITHUB_REPO;
          await octokit.rest.repos.get({ owner, repo: defaultRepo }).catch(() => null);
          return { owner, repo: defaultRepo };
        }
        throw createErr;
      }
    } else {
      throw err;
    }
  }

  return { owner, repo };
}

/** Deletes one explicitly named repository owned by GITHUB_OWNER. */
export async function deleteTaskRepo(repoName: string): Promise<RepoCoords> {
  validateRepositoryName(repoName);
  const octokit = getOctokit();
  const owner = config.GITHUB_OWNER;
  await octokit.rest.repos.delete({ owner, repo: repoName });
  logger.warn({ owner, repo: repoName }, "Task repository deleted");
  return { owner, repo: repoName };
}

/**
 * Pushes (creates or updates) a file in the repo.
 * Used to deploy the generated workflow YAML into `.github/workflows/`.
 */
export async function pushWorkflowFile(
  owner: string,
  repo: string,
  filePath: string,
  yamlContent: string,
  commitMessage?: string,
): Promise<void> {
  const octokit = getOctokit();
  const branch = config.GITHUB_DEFAULT_BRANCH;

  // Check if file exists to get its SHA (required for updates)
  let sha: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branch,
    });
    if (!Array.isArray(data) && data.type === "file") {
      sha = data.sha;
    }
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
    // 404 = file doesn't exist yet, that's fine
  }

  const content = Buffer.from(yamlContent, "utf8").toString("base64");
  const message = commitMessage ?? `chore: update workflow ${filePath}`;

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message,
    content,
    branch,
    ...(sha ? { sha } : {}),
  });

  logger.info({ owner, repo, filePath }, "Workflow file pushed");
}
