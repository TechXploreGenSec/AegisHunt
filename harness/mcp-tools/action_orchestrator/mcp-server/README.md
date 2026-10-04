# gh-runner MCP — GitHub Actions Compute Orchestrator

> **MCP server name:** `mcp-gh-actions-orchestrator` (v1.0.0)
> **Exposed to OpenCode as:** `gh-runner`
> **Purpose:** Offload heavy recon / scanning / fuzzing / exploit work from your laptop to ephemeral GitHub Actions cloud runners using pre-built Kali Docker images.

Instead of running `nmap`, `ffuf`, `nuclei`, `subfinder` locally, the LLM authors a `JobPlan` JSON, this MCP generates a GitHub Actions workflow YAML, pushes it to a task repo, triggers the run, polls status, and fetches result artifacts back.

---

## 1. How it works (architecture)

```
OpenCode Agent (LLM)
      │  MCP tools (stdio or HTTP)
      ▼
gh-runner MCP (Node.js + @modelcontextprotocol/sdk)
      │  Octokit REST API (GITHUB_TOKEN)
      ▼
GitHub task repo (e.g. Godf-Cyb3r-1/TASK_RUNNER)
  ├── .github/workflows/task-<taskId>.yml  (generated matrix workflow)
  └── Actions run (ubuntu-latest + Docker)
        ├── docker run godfathercyb3r/kali-bb-recon:latest ...
        ├── docker run godfathercyb3r/kali-bb-fuzzing:latest ...
        ├── docker run godfathercyb3r/kali-bb-scanner:latest ...
        └── upload /results/* as Actions artifacts
      │
      ▼
MCP fetch_artifacts → ./artifacts-out/ (+ optional merged text)
```

**Standard 6-step flow:**

1. `create_task_repo({ repository: 'task-xxx' })` — ensure ephemeral repo exists (idempotent).
2. `generate_workflow({ jobPlan, repository })` — validate + generate YAML + push. Use `dryRun:true` first to inspect YAML without spending runner minutes.
3. `trigger_run({ workflowFile, jobPlan, repository })` — `workflow_dispatch` run, reserves a concurrency slot.
4. `poll_status({ runId })` — poll until `completed`. Releases slot on completion.
5. `fetch_artifacts({ runId, mergeText:true })` — download + extract all artifacts.
6. `cleanup_run({ runId, deleteWorkflowFile:true })` + `delete_task_repo({ repository, confirm:true })` — wipe traces.

> Rules enforced by the server: **never build Docker images locally**, **never run heavy commands locally**, always use pre-built public images, always save outputs to `/results/` inside the container so they become artifacts.

---

## 2. Tools exposed (15 tools)

| Tool | What it does |
|------|--------------|
| `ping` | Health check → `pong` |
| `tool_help` | Architecture + execution flow + rules |
| `docker_images_help` | Catalog of pre-built Kali images |
| `create_task_repo` | Ensure named task repo exists |
| `delete_task_repo` | Permanently delete one repo (requires `confirm:true`) |
| `generate_workflow` | Generate workflow YAML from `JobPlan`, validate scope/caps, push (or `dryRun`) |
| `push_workflow_file` | Push raw YAML (validates YAML + Actions structure first) |
| `trigger_run` | Trigger `workflow_dispatch`, enforce `MAX_CONCURRENT_RUNS` |
| `poll_status` | Run status + per-job conclusions |
| `get_run_capacity` | `{ maxConcurrentRuns, activeRuns, availableSlots, trackedRunIds }` |
| `get_job_logs` | Tail of a job log (10–500 lines, default 80). Use on failure |
| `retry_job` | Re-run single job by `jobId` |
| `retry_failed_jobs` | Re-run all failed jobs in a run |
| `fetch_artifacts` | Download + extract artifacts to `destDir`, optional `mergeText` dedup of `.txt/.log/.csv` |
| `cleanup_run` | Delete workflow run; optionally delete workflow YAML too |

---

## 3. Pre-built Docker images

| Image | Tools | Use for |
|-------|-------|---------|
| `godfathercyb3r/kali-bb-recon:latest` | subfinder, assetfinder, amass, dnsx, httpx, massdns | Subdomain enum, DNS, host discovery |
| `godfathercyb3r/kali-bb-fuzzing:latest` | ffuf, feroxbuster, gobuster, dirb, katana, httpx | Dir fuzzing, params, crawling |
| `godfathercyb3r/kali-bb-scanner:latest` | naabu, nmap, masscan, nuclei | Ports, services, vuln probing |
| `godfathercyb3r/kali-bb-exploit:latest` | custom PoC suites | Vuln analysis, payload testing |
| `godfathercyb3r/kali-bugbounty:latest` | full Kali bug-bounty suite | General tasks |
| `godfathercyb3r/kali-bb-base:latest` | base Kali env | Custom builds |

These are bare toolboxes (`Entrypoint: null`). Two ways to run:

- **Way 1 (recommended, custom commands):** `push_workflow_file` with explicit bash, e.g. `docker run --rm -v $GITHUB_WORKSPACE/results:/results godfathercyb3r/kali-bb-fuzzing:latest bash -c 'ffuf ... -o /results/out.json'`
- **Way 2 (`generate_workflow`):** set `runScriptPath: 'bash'` in `JobPlan` and put full shell in `extraArgs`, e.g. `-c 'ffuf -u $TARGET_URL/FUZZ -w ... -o /results/out.json'`

---

## 4. Prerequisites

- Node.js 20+
- A GitHub account + fine-grained PAT with **Contents: Read & write**, **Actions: Read & write**
- A task repo (can be auto-created, e.g. `TASK_RUNNER`)
- OpenCode (or any MCP client) for local use, or HTTP access for remote/Replit use

---

## 5. Install (on new system)

```bash
# 1. Unzip this package
unzip gh-runner-mcp-migration.zip -d gh-runner-mcp
cd gh-runner-mcp/mcp-server   # or wherever src/package.json lives

# 2. Install deps
npm install
# (repo scripts reference pnpm; npm works fine too: npm run build / npm start)

# 3. Configure env
cp .env.example .env
# then edit .env — see section 6

# 4. Build
npm run build

# 5. (optional) Typecheck
npm run typecheck
```

This zip intentionally **excludes** `node_modules/`, `dist/`, `.env` (secret), `audit.log`, `artifacts-out/`, `.tsbuildinfo`, `*.db`. Rebuild `dist/` on the new box with `npm run build`.

---

## 6. Configuration (.env)

Copy `.env.example` → `.env` (or set real env vars — env vars take precedence over `.env`):

```env
# Fine-grained PAT
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=your-github-username
GITHUB_REPO=mcp-task-runner
GITHUB_DEFAULT_BRANCH=main

# Scope guardrail: comma-separated allowed target prefixes, or "*" / blank = allow all
SCOPE_ALLOWLIST=*
# SCOPE_ALLOWLIST=https://target.example.com,https://ctf.lab.internal

MAX_CONCURRENT_RUNS=5
MAX_JOBS_PER_PLAN=20
AUDIT_LOG_PATH=./audit.log

# stdio = local OpenCode over stdin/stdout | http = remote/Replit over SSE
MCP_TRANSPORT=stdio
PORT=3456
```

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `GITHUB_TOKEN` | yes | — | PAT, Contents+Actions RW. Never commit |
| `GITHUB_OWNER` | yes | — | User or org owning task repos |
| `GITHUB_REPO` | yes | — | Default task repo |
| `GITHUB_DEFAULT_BRANCH` | no | `main` | Branch for workflow pushes |
| `SCOPE_ALLOWLIST` | no | `""` (allow all) | `generate_workflow`/`trigger_run` reject off-scope `targetUrl` |
| `MAX_CONCURRENT_RUNS` | no | `5` | `trigger_run` blocks when full |
| `MAX_JOBS_PER_PLAN` | no | `20` | GitHub Free matrix cap is 20 |
| `AUDIT_LOG_PATH` | no | `./audit.log` | JSON-lines audit of `trigger_run` |
| `MCP_TRANSPORT` | no | `http` | `stdio` for OpenCode local, `http` for remote |
| `PORT` | http only | `3456` | HTTP listen port |

> `src/config.ts` loads `.env` with `override:false`, so real environment variables win. Placeholders like `{env:...}` are stripped.

---

## 7. Run the server

```bash
# stdio mode (OpenCode local) — no stdout logging, stays alive on stdin
MCP_TRANSPORT=stdio npm start
# = node --enable-source-maps ./dist/index.mjs

# http mode (Replit / remote)
MCP_TRANSPORT=http PORT=3456 npm start
# health:  GET http://localhost:3456/healthz
# MCP:     POST http://localhost:3456/mcp  (header mcp-session-id after first handshake)
```

Dev shortcut (build + start, `NODE_ENV=development`):

```bash
npm run dev
```

---

## 8. Connect to OpenCode

**Local (stdio) — recommended for WSL/Kali:**

```json
{
  "mcp": {
    "gh-runner": {
      "type": "local",
      "command": ["node", "--enable-source-maps", "/ABS/PATH/TO/mcp-server/dist/index.mjs"],
      "cwd": "/ABS/PATH/TO/mcp-server",
      "enabled": true,
      "environment": {
        "MCP_TRANSPORT": "stdio",
        "GITHUB_TOKEN": "ghp_xxxx",
        "GITHUB_OWNER": "you",
        "GITHUB_REPO": "TASK_RUNNER",
        "GITHUB_DEFAULT_BRANCH": "main",
        "SCOPE_ALLOWLIST": "*",
        "MAX_JOBS_PER_PLAN": "20",
        "MAX_CONCURRENT_RUNS": "5",
        "AUDIT_LOG_PATH": "/ABS/PATH/TO/mcp-server/audit.log"
      }
    }
  }
}
```

**Remote (http):**

```json
{
  "mcpServers": {
    "gh-actions-orchestrator": { "type": "http", "url": "http://localhost:3456/mcp" }
  }
}
```

Verify: call `ping` → `pong`, `get_run_capacity` → slots available, `docker_images_help` → image catalog.

---

## 9. Usage example (JobPlan)

Minimal `generate_workflow` input:

```json
{
  "taskId": "dirbust-2026-09-16-01",
  "targetUrl": "https://target.example.com",
  "toolImage": "godfathercyb3r/kali-bb-fuzzing:latest",
  "timeoutMinutes": 30,
  "runScriptPath": "bash",
  "jobs": [
    { "index": 0, "extraArgs": "-c 'ffuf -u $TARGET_URL/FUZZ -w /wordlists/common.txt -o /results/ffuf.json'", "delaySeconds": 0 },
    { "index": 1, "extraArgs": "-c 'feroxbuster -u $TARGET_URL --output /results/ferox.txt'", "delaySeconds": 10 }
  ],
  "secretsRequired": [],
  "repository": "TASK_RUNNER",
  "dryRun": true
}
```

Then: `dryRun:true` → inspect YAML → `dryRun:false` (push) → `trigger_run({ workflowFile: ".github/workflows/task-dirbust-2026-09-16-01.yml", jobPlan })` → `poll_status` loop → `fetch_artifacts({ runId, mergeText:true })` → `cleanup_run` → `delete_task_repo` when done.

**JobPlan field notes (`src/schemas/jobPlan.ts`):**

- `taskId`: `/^[\w\-\.]+$/`, also becomes workflow filename.
- `targetUrl`: must be URL, checked against `SCOPE_ALLOWLIST`.
- `toolImage`: default `kali-bugbounty:latest`; always use a pre-built public image.
- `timeoutMinutes`: 1–350, default 300.
- `jobs[].command`: full bash/python script; **all final outputs MUST go to `/results/`**.
- `jobs[].delaySeconds`: stagger to avoid thundering herd.
- `secretsRequired`: GitHub secret names jobs need.
- `runScriptPath`: e.g. `bash` when using `extraArgs -c '...'` style.

---

## 10. Project structure

```
mcp-server/
├── src/
│   ├── index.ts              # transport (stdio/http) + all 15 tool registrations
│   ├── config.ts             # zod-validated env (.env + process.env)
│   ├── github/
│   │   ├── repoManager.ts    # ensureTaskRepo / deleteTaskRepo / pushWorkflowFile
│   │   ├── workflowGenerator.ts  # JobPlan → Actions YAML + file path
│   │   ├── dispatcher.ts     # workflow_dispatch trigger
│   │   ├── monitor.ts        # pollStatus / getJobLogs
│   │   ├── retry.ts          # retryJob / retryFailedJobs
│   │   ├── artifactCollector.ts  # fetch + extract + mergeText
│   │   ├── cleanup.ts        # delete run / workflow file
│   │   ├── client.ts         # Octokit client
│   │   └── runCoordinator.ts # in-process concurrency slots
│   ├── guardrails/policy.ts  # checkScope / checkVolumeCaps / audit log
│   ├── schemas/
│   │   ├── jobPlan.ts        # JobPlan + JobEntry zod schemas
│   │   ├── jobStatus.ts      # status schemas
│   │   └── workflowValidator.ts  # raw-YAML validation for push_workflow_file
│   └── lib/logger.ts         # pino logger
├── build.mjs                 # esbuild bundle → dist/index.mjs (+sourcemap)
├── package.json              # @workspace/mcp-server, scripts: dev/build/start/typecheck
├── tsconfig.json             # ES2022, NodeNext, strict
├── .env.example              # copy to .env
└── README.md                 # this file
```

---

## 11. Migration / upgrade checklist

1. Unzip on new box, `npm install`, copy `.env.example` → `.env` and fill in fresh `GITHUB_TOKEN`/`OWNER`/`REPO` (do **not** reuse the old `.env` — it was excluded from this zip on purpose).
2. `npm run build && MCP_TRANSPORT=stdio npm start` — confirm `ping` works from your MCP client.
3. `dryRun:true` a small `JobPlan` first to validate YAML before spending runner minutes.
4. For upgrades: edit `src/`, bump version in `src/index.ts` (`McpServer version`), `npm run build`, restart the MCP client. Keep `SCOPE_ALLOWLIST` tight on shared boxes.
5. Rotate the PAT if the old box is decommissioned; delete stale task repos with `delete_task_repo`.

---

## 12. Troubleshooting

- `Configuration error: GITHUB_TOKEN is required` → `.env` missing or env not passed; check `cwd` in OpenCode config.
- `Scope rejected` → `targetUrl` not in `SCOPE_ALLOWLIST`; set `*` for testing or add the prefix.
- `Concurrency full` → `get_run_capacity` shows 0 slots; `poll_status` completed runs to release, or raise `MAX_CONCURRENT_RUNS`.
- `Workflow YAML validation failed` → read `details` from `push_workflow_file`; prefer `generate_workflow(dryRun:true)` to iterate.
- Empty artifacts → job didn't write to `/results/`; fix `command`/`extraArgs` to output there.
- HTTP `400 Missing mcp-session-id` → complete the POST `/mcp` handshake first, then reuse the session id for GET/DELETE.

---

## 13. Security notes

- `GITHUB_TOKEN` is a secret — never commit `.env`, never paste it into workflows or artifacts. This zip excludes `.env`.
- `SCOPE_ALLOWLIST` + `MAX_JOBS_PER_PLAN` + `MAX_CONCURRENT_RUNS` are cost/abuse guardrails — keep them tight on shared hosts.
- `AUDIT_LOG_PATH` records every `trigger_run` (timestamp, taskId, targetUrl, runId) — retain for review.
- `delete_task_repo` is destructive and requires `confirm:true`; delete repos individually, not in bulk.
