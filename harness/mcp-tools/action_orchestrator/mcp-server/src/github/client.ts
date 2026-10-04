import { Octokit } from "@octokit/rest";
import { config } from "../config.js";

let _octokit: Octokit | null = null;

/**
 * Returns a singleton authenticated Octokit instance.
 * The PAT is read from GITHUB_TOKEN at startup via config.
 */
export function getOctokit(): Octokit {
  return new Octokit({
    auth: process.env["GITHUB_TOKEN"] || config.GITHUB_TOKEN,
    userAgent: "mcp-gh-actions-orchestrator/1.0.0",
  });
}
