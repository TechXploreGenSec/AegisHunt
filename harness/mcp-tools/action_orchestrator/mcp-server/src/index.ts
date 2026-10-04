/**
 * MCP GitHub Actions Compute Orchestrator
 *
 * Transport:
 *   MCP_TRANSPORT=stdio → StdioServerTransport (for local OpenCode use)
 *   MCP_TRANSPORT=http  → StreamableHTTPServerTransport over Express (default, for Replit/remote)
 *
 * All business logic lives in the github/ modules. This file is transport + registration only.
 */

import { config } from "./config.js";
import { logger } from "./lib/logger.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { deleteTaskRepo, ensureTaskRepo, pushWorkflowFile } from "./github/repoManager.js";
import { generateWorkflowYaml, workflowFilePath } from "./github/workflowGenerator.js";
import { validateWorkflowYaml } from "./schemas/workflowValidator.js";
import { triggerRun } from "./github/dispatcher.js";
import { pollStatus, getJobLogs } from "./github/monitor.js";
import { retryJob, retryFailedJobs } from "./github/retry.js";
import { fetchArtifacts, mergeTextResults } from "./github/artifactCollector.js";
import { cleanupRun, cleanupWorkflowFile } from "./github/cleanup.js";
import { runCoordinator, type RunCapacity } from "./github/runCoordinator.js";
import { JobPlanSchema } from "./schemas/jobPlan.js";
import { checkScope, checkVolumeCaps, checkRateBudget, writeAuditLog } from "./guardrails/policy.js";

const RepositoryNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+$/, "Repository names may contain only letters, numbers, dots, underscores, and dashes");

// ─── MCP Server factory ───────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mcp-gh-actions-orchestrator",
    version: "1.0.0",
  });

  // ── ping ──────────────────────────────────────────────────────────────────
  server.tool("ping", "Health check — returns pong", {}, async () => ({
    content: [{ type: "text", text: "pong" }],
  }));

  // ── tool_help ─────────────────────────────────────────────────────────────
  server.tool(
    "tool_help",
    "Get full architectural guidance on how gh-runner operates, how to create/use ephemeral repos, and how to execute workflow jobs without error.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              architecture: "Cloud Compute Offloader via GitHub Actions Runners",
              executionFlow: [
                "1. Call create_task_repo({ repository: 'task-xxx' }) to create or ensure an ephemeral task repository.",
                "2. Call generate_workflow({ jobPlan: {...}, repository: 'task-xxx' }) to generate and push the matrix workflow.",
                "3. Call trigger_run({ workflowFile: '...', repository: 'task-xxx' }) to start parallel cloud execution.",
                "4. Call poll_status({ runId: ..., repository: 'task-xxx' }) until completed.",
                "5. Call fetch_artifacts({ runId: ..., repository: 'task-xxx' }) to retrieve and merge results.",
                "6. Call delete_task_repo({ repository: 'task-xxx', confirm: true }) to wipe traces.",
              ],
              rules: [
                "NEVER build Docker containers or download tool binaries on the local host/laptop.",
                "NEVER run heavy commands locally.",
                "Use pre-built Docker images (call docker_images_help for available images).",
                "For custom shell execution, use push_workflow_file to upload raw YAML.",
              ],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  // ── docker_images_help ────────────────────────────────────────────────────
  server.tool(
    "docker_images_help",
    "Get the complete catalog of pre-built Docker Hub images available for cloud workflow execution.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              recommendedImages: {
                recon: {
                  image: "godfathercyb3r/kali-bb-recon:latest",
                  tools: ["subfinder", "assetfinder", "amass", "dnsx", "httpx", "massdns"],
                  purpose: "Subdomain enumeration, DNS brute-forcing, and host discovery",
                },
                fuzzing: {
                  image: "godfathercyb3r/kali-bb-fuzzing:latest",
                  tools: ["ffuf", "feroxbuster", "gobuster", "dirb", "katana", "httpx"],
                  purpose: "Directory brute-forcing, parameter discovery, and URL crawling",
                },
                scanning: {
                  image: "godfathercyb3r/kali-bb-scanner:latest",
                  tools: ["naabu", "nmap", "masscan", "nuclei"],
                  purpose: "Port scanning, service detection, and vulnerability probing",
                },
                exploit: {
                  image: "godfathercyb3r/kali-bb-exploit:latest",
                  tools: ["custom PoC execution suites"],
                  purpose: "Vulnerability analysis and payload testing",
                },
                fullSuite: {
                  image: "godfathercyb3r/kali-bugbounty:latest",
                  tools: ["Full Kali Linux Bug Bounty suite"],
                  purpose: "General bug bounty tasks",
                },
              },
              executionGuidance: {
                rule: "These images are bare Kali toolboxes (Entrypoint: null).",
                twoWaysToRun: [
                  "Way 1 (Recommended for Custom Commands): Use push_workflow_file to upload raw YAML containing explicit bash commands (e.g. docker run --rm -v $GITHUB_WORKSPACE/results:/results godfathercyb3r/kali-bb-fuzzing:latest bash -c 'ffuf ...').",
                  "Way 2 (For generate_workflow): Set runScriptPath: 'bash' in your JobPlan and pass your full shell command string inside extraArgs (e.g. -c 'ffuf -u $TARGET_URL/FUZZ -w ... -o /results/out.json').",
                ],
              },
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  // ── create_task_repo ──────────────────────────────────────────────────────
  server.tool(
    "create_task_repo",
    "Ensure a named GitHub task repository exists. Idempotent — safe to call on every task.",
    { repository: RepositoryNameSchema.optional().describe("Repository to create or reuse; defaults to GITHUB_REPO") },
    async ({ repository }) => {
      const coords = await ensureTaskRepo(repository);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, owner: coords.owner, repo: coords.repo }),
          },
        ],
      };
    },
  );

  // ── delete_task_repo ────────────────────────────────────────────────────
  server.tool(
    "delete_task_repo",
    "Permanently delete one named repository under GITHUB_OWNER. Requires confirm=true. Delete repositories individually rather than in bulk.",
    {
      repository: RepositoryNameSchema.describe("Repository to permanently delete"),
      confirm: z.literal(true).describe("Must be true to confirm permanent deletion"),
    },
    async ({ repository }) => {
      const coords = await deleteTaskRepo(repository);
      runCoordinator.releaseRepository(coords.repo);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, deleted: coords }) }] };
    },
  );

  // ── generate_workflow ─────────────────────────────────────────────────────
  server.tool(
    "generate_workflow",
    [
      "Generate a GitHub Actions workflow YAML from the LLM-authored job plan.",
      "NEVER build Docker images locally on the user's machine.",
      "Always specify pre-built public Docker images (e.g. godfathercyb3r/kali-bb-recon:latest, godfathercyb3r/kali-bb-fuzzing:latest, godfathercyb3r/kali-bb-scanner:latest, godfathercyb3r/kali-bugbounty:latest).",
      "Validates the job plan shape and scope allowlist.",
      "Each job's container receives RATE_LIMIT_PER_SEC env (program budget divided by job count) — reference $RATE_LIMIT_PER_SEC in command/extraArgs rate flags where the tool supports one.",
      "If dryRun=true, returns the YAML without pushing or triggering anything.",
      "If dryRun=false (default), pushes the YAML to the repo and returns the workflow file path.",
    ].join(" "),
    {
      jobPlan: JobPlanSchema,
      repository: RepositoryNameSchema.optional().describe("Repository that will contain the workflow; defaults to GITHUB_REPO"),
      dryRun: z.boolean().default(false).describe(
        "If true, return YAML only (no push). Useful for inspection before committing runner minutes.",
      ),
      commitMessage: z.string().optional().describe("Optional git commit message for the workflow file"),
    },
    async ({ jobPlan, repository, dryRun, commitMessage }) => {
      // Guardrails
      checkScope(jobPlan.targetUrl);
      checkVolumeCaps(jobPlan.jobs.length);
      const perLaneRate = checkRateBudget(jobPlan);

      const yamlContent = generateWorkflowYaml(jobPlan, perLaneRate);

      if (dryRun) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                dryRun: true,
                filePath: workflowFilePath(jobPlan.taskId),
                yaml: yamlContent,
              }),
            },
          ],
        };
      }

      const { owner, repo } = await ensureTaskRepo(repository);
      const filePath = workflowFilePath(jobPlan.taskId);
      await pushWorkflowFile(owner, repo, filePath, yamlContent, commitMessage);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, owner, repo, filePath }),
          },
        ],
      };
    },
  );

  // ── push_workflow_file ────────────────────────────────────────────────────
  server.tool(
    "push_workflow_file",
    "Push a raw workflow YAML string to the repo at the given path. Automatically validates YAML syntax and GitHub Actions structure before pushing.",
    {
      filePath: z.string().describe("e.g. .github/workflows/my-task.yml"),
      yamlContent: z.string().describe("Full workflow YAML content"),
      repository: RepositoryNameSchema.optional().describe("Repository that will contain the workflow; defaults to GITHUB_REPO"),
      commitMessage: z.string().optional(),
    },
    async ({ filePath, yamlContent, repository, commitMessage }) => {
      // Validate YAML syntax & GitHub Actions structure
      const validation = validateWorkflowYaml(yamlContent);
      if (!validation.valid) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "Workflow YAML validation failed",
                details: validation.errors,
              }),
            },
          ],
        };
      }

      const { owner, repo } = await ensureTaskRepo(repository);
      await pushWorkflowFile(owner, repo, filePath, yamlContent, commitMessage);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, owner, repo, filePath }),
          },
        ],
      };
    },
  );

  // ── trigger_run ───────────────────────────────────────────────────────────
  server.tool(
    "trigger_run",
    "Trigger a workflow_dispatch run for the given workflow file. Can accept a jobPlan or raw inputs key-value map. Concurrent runs are limited by MAX_CONCURRENT_RUNS.",
    {
      workflowFile: z.string().describe(
        "Workflow file path, e.g. .github/workflows/task-dirbust-2026-08-04-01.yml",
      ),
      jobPlan: JobPlanSchema.optional().describe("Optional JobPlan for matrix workflows"),
      inputs: z.record(z.string()).optional().describe("Optional raw inputs key-value map for workflow_dispatch"),
      repository: RepositoryNameSchema.optional().describe("Repository containing the workflow; defaults to GITHUB_REPO"),
    },
    async ({ workflowFile, jobPlan, inputs, repository }) => {
      if (jobPlan) {
        checkScope(jobPlan.targetUrl);
        checkVolumeCaps(jobPlan.jobs.length);
      }

      const { owner, repo } = await ensureTaskRepo(repository);
      const taskId = jobPlan?.taskId ?? `task-${Date.now()}`;
      const reservationId = runCoordinator.reserve(taskId);

      let runId: number;
      let capacity: RunCapacity;
      try {
        runId = await triggerRun(owner, repo, workflowFile, jobPlan, inputs);
        capacity = runCoordinator.activate(reservationId, runId, repo);
      } catch (err) {
        runCoordinator.releaseReservation(reservationId);
        throw err;
      }

      writeAuditLog({
        timestamp: new Date().toISOString(),
        taskId,
        targetUrl: jobPlan?.targetUrl ?? "",
        runId,
        action: "trigger_run",
        details: { repository: repo, workflowFile, jobCount: jobPlan?.jobs.length ?? 1 },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, owner, repo, runId, workflowFile, capacity }),
          },
        ],
      };
    },
  );

  // ── poll_status ───────────────────────────────────────────────────────────
  server.tool(
    "poll_status",
    "Get the current status and per-job conclusions for a workflow run. A completed tracked run releases one concurrency slot.",
    {
      runId: z.number().int().describe("The workflow run ID returned by trigger_run"),
      repository: RepositoryNameSchema.optional().describe("Repository containing the run; defaults to GITHUB_REPO"),
    },
    async ({ runId, repository }) => {
      const { owner, repo } = { owner: config.GITHUB_OWNER, repo: repository ?? config.GITHUB_REPO };
      const status = await pollStatus(owner, repo, runId);
      const capacity = runCoordinator.observeStatus(runId, status.status);
      return {
        content: [{ type: "text", text: JSON.stringify({ ...status, capacity }) }],
      };
    },
  );

  // ── get_run_capacity ─────────────────────────────────────────────────────
  server.tool(
    "get_run_capacity",
    "Get process-wide workflow-run capacity and the run IDs currently tracked against MAX_CONCURRENT_RUNS.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(runCoordinator.getCapacity()) }],
    }),
  );

  // ── get_job_logs ──────────────────────────────────────────────────────────
  server.tool(
    "get_job_logs",
    "Fetch the tail of a job's log output. Call this when poll_status shows a failure conclusion.",
    {
      jobId: z.number().int().describe("The job ID from poll_status"),
      repository: RepositoryNameSchema.optional().describe("Repository containing the job; defaults to GITHUB_REPO"),
      tailLines: z.number().int().min(10).max(500).default(80).describe(
        "How many lines from the end of the log to return (default 80)",
      ),
    },
    async ({ jobId, repository, tailLines }) => {
      const { owner, repo } = { owner: config.GITHUB_OWNER, repo: repository ?? config.GITHUB_REPO };
      const logs = await getJobLogs(owner, repo, jobId, tailLines);
      return {
        content: [{ type: "text", text: logs }],
      };
    },
  );

  // ── retry_job ─────────────────────────────────────────────────────────────
  server.tool(
    "retry_job",
    "Re-run a single job by its job ID. The LLM decides whether to retry based on get_job_logs.",
    {
      jobId: z.number().int(),
      repository: RepositoryNameSchema.optional().describe("Repository containing the job; defaults to GITHUB_REPO"),
    },
    async ({ jobId, repository }) => {
      const { owner, repo } = { owner: config.GITHUB_OWNER, repo: repository ?? config.GITHUB_REPO };
      await retryJob(owner, repo, jobId);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, jobId }) }],
      };
    },
  );

  // ── retry_failed_jobs ─────────────────────────────────────────────────────
  server.tool(
    "retry_failed_jobs",
    "Re-run all failed jobs in a workflow run at once.",
    {
      runId: z.number().int(),
      repository: RepositoryNameSchema.optional().describe("Repository containing the run; defaults to GITHUB_REPO"),
    },
    async ({ runId, repository }) => {
      const { owner, repo } = { owner: config.GITHUB_OWNER, repo: repository ?? config.GITHUB_REPO };
      await retryFailedJobs(owner, repo, runId);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, runId }) }],
      };
    },
  );

  // ── fetch_artifacts ───────────────────────────────────────────────────────
  server.tool(
    "fetch_artifacts",
    "Download and extract all artifacts for a completed run. Optionally merges text output across jobs.",
    {
      runId: z.number().int(),
      repository: RepositoryNameSchema.optional().describe("Repository containing the artifacts; defaults to GITHUB_REPO"),
      destDir: z.string().default("./artifacts-out").describe(
        "Local directory to extract artifacts into",
      ),
      mergeText: z.boolean().default(false).describe(
        "If true, also returns merged + deduplicated text from all .txt/.log/.csv files",
      ),
    },
    async ({ runId, repository, destDir, mergeText }) => {
      const { owner, repo } = { owner: config.GITHUB_OWNER, repo: repository ?? config.GITHUB_REPO };
      const results = await fetchArtifacts(owner, repo, runId, destDir);

      const response: Record<string, unknown> = {
        artifacts: results.map((r) => ({
          artifactId: r.artifactId,
          name: r.name,
          destDir: r.destDir,
          fileCount: r.files.length,
          files: r.files,
        })),
      };

      if (mergeText) {
        response["mergedText"] = await mergeTextResults(results);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    },
  );

  // ── cleanup_run ───────────────────────────────────────────────────────────
  server.tool(
    "cleanup_run",
    "Delete a workflow run from GitHub. Call this after artifacts are safely retrieved.",
    {
      runId: z.number().int(),
      repository: RepositoryNameSchema.optional().describe("Repository containing the run; defaults to GITHUB_REPO"),
      deleteWorkflowFile: z.boolean().default(false).describe(
        "Also delete the workflow YAML from the repo",
      ),
      workflowFile: z.string().optional().describe(
        "Required if deleteWorkflowFile=true. e.g. .github/workflows/task-xyz.yml",
      ),
    },
    async ({ runId, repository, deleteWorkflowFile, workflowFile }) => {
      const { owner, repo } = { owner: config.GITHUB_OWNER, repo: repository ?? config.GITHUB_REPO };
      await cleanupRun(owner, repo, runId);
      runCoordinator.releaseRun(runId);

      if (deleteWorkflowFile && workflowFile) {
        await cleanupWorkflowFile(owner, repo, workflowFile);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              runId,
              workflowFileDeleted: deleteWorkflowFile && !!workflowFile,
            }),
          },
        ],
      };
    },
  );

  return server;
}

// ─── Transport setup ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (config.MCP_TRANSPORT === "stdio") {
    // stdio mode — for local OpenCode use. Don't log to stdout.
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Process stays alive; stdio transport handles the event loop
    return;
  }

  // HTTP mode — for Replit hosting and remote clients
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "4mb" }));

  // Session map for stateful HTTP transport (one transport per client session)
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req, res) => {
    const existingSessionId = req.headers["mcp-session-id"] as string | undefined;

    if (existingSessionId && transports.has(existingSessionId)) {
      const transport = transports.get(existingSessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session
    const sessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });

    transport.onclose = () => {
      transports.delete(sessionId);
      logger.debug({ sessionId }, "MCP session closed");
    };

    transports.set(sessionId, transport);

    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: "Missing or unknown mcp-session-id" });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: "Missing or unknown mcp-session-id" });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
    transports.delete(sessionId);
  });

  // Health check
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", transport: "http", sessions: transports.size });
  });

  const port = config.PORT;
  app.listen(port, () => {
    logger.info({ port, transport: "http" }, "MCP server listening");
    logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
    logger.info(
      "OpenCode config snippet:\n" +
        JSON.stringify(
          {
            mcpServers: {
              "gh-actions-orchestrator": {
                type: "http",
                url: `http://localhost:${port}/mcp`,
              },
            },
          },
          null,
          2,
        ),
    );
  });
}

main().catch((err) => {
  logger.error({ err }, "MCP server fatal error");
  process.exit(1);
});
