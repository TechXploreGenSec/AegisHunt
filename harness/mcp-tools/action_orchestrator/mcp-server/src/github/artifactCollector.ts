import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { getOctokit } from "./client.js";
import { logger } from "../lib/logger.js";

export interface ArtifactResult {
  artifactId: number;
  name: string;
  destDir: string;
  files: string[];
}

/**
 * Downloads and extracts all artifacts for a completed workflow run.
 * Each artifact is extracted into `<destDir>/<artifact-name>/`.
 * Returns the list of extracted file paths.
 */
export async function fetchArtifacts(
  owner: string,
  repo: string,
  runId: number,
  destDir: string,
): Promise<ArtifactResult[]> {
  const octokit = getOctokit();

  const { data } = await octokit.rest.actions.listWorkflowRunArtifacts({
    owner,
    repo,
    run_id: runId,
    per_page: 100,
  });

  if (data.artifacts.length === 0) {
    logger.info({ owner, repo, runId }, "No artifacts found for run");
    return [];
  }

  logger.info(
    { owner, repo, runId, count: data.artifacts.length },
    "Downloading artifacts",
  );

  await mkdir(destDir, { recursive: true });

  const results: ArtifactResult[] = [];

  for (const artifact of data.artifacts) {
    const artifactDir = path.join(destDir, artifact.name);
    await mkdir(artifactDir, { recursive: true });

    try {
      // Download the artifact archive via the GitHub API
      // Octokit follows the redirect; the response contains an ArrayBuffer
      const downloadResp = await octokit.rest.actions.downloadArtifact({
        owner,
        repo,
        artifact_id: artifact.id,
        archive_format: "zip",
      });

      // The SDK resolves the 302 and returns the redirect URL in `url`
      const redirectUrl = (downloadResp as unknown as { url: string }).url;
      const fetchResp = await fetch(redirectUrl);
      if (!fetchResp.ok) {
        logger.warn(
          { artifactId: artifact.id, name: artifact.name, status: fetchResp.status },
          "Failed to download artifact zip",
        );
        continue;
      }

      const arrayBuffer = await fetchResp.arrayBuffer();
      const zipBuffer = Buffer.from(arrayBuffer);
      const zipPath = path.join(artifactDir, "_archive.zip");
      await writeFile(zipPath, zipBuffer);

      // Extract with adm-zip
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(artifactDir, /* overwrite */ true);
      await rm(zipPath, { force: true });

      const entries = zip
        .getEntries()
        .filter((e) => !e.isDirectory)
        .map((e) => path.join(artifactDir, e.entryName));

      results.push({
        artifactId: artifact.id,
        name: artifact.name,
        destDir: artifactDir,
        files: entries,
      });

      logger.info(
        { name: artifact.name, fileCount: entries.length, destDir: artifactDir },
        "Artifact extracted",
      );
    } catch (err) {
      logger.error({ err, artifactId: artifact.id, name: artifact.name }, "Error downloading artifact");
    }
  }

  return results;
}

/**
 * Reads all text files in the extracted artifact dirs and concatenates them,
 * de-duplicating lines. Useful for merging per-job output (e.g. found URLs).
 */
export async function mergeTextResults(
  results: ArtifactResult[],
): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const result of results) {
    for (const filePath of result.files) {
      if (!/\.(txt|log|csv|out)$/i.test(filePath)) continue;
      try {
        const content = await readFile(filePath, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            lines.push(trimmed);
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  return lines.join("\n");
}
