import yaml from "yaml";
import type { JobPlan } from "../schemas/jobPlan.js";

const MAX_TIMEOUT_MINUTES = 350; // GitHub cap is 360; stay safely under

// GitHub Actions expression syntax — these are YAML string values,
// not TypeScript template expressions. Using \${{ }} to prevent TS parsing errors.
const GH = {
  /** @returns `${{ <expr> }}` as a plain string value */
  expr: (expression: string) => `\${{ ${expression} }}`,
};

/**
 * Builds a GitHub Actions workflow object from the LLM's job plan.
 * Uses the dynamic-matrix + stagger-delay pattern described in the implementation plan.
 *
 * The returned string is valid YAML ready to be committed to `.github/workflows/`.
 */
export function generateWorkflowYaml(jobPlan: JobPlan, perLaneRate?: number): string {
  const clampedTimeout = Math.min(
    jobPlan.timeoutMinutes ?? 300,
    MAX_TIMEOUT_MINUTES,
  );

  // Build secret env flags for docker run, one per line
  const secretArgs = (jobPlan.secretsRequired ?? [])
    .map((s) => `  -e ${s}="${GH.expr(`secrets.${s}`)}"`)
    .join(" \\\n");

  const entrypointFlag = jobPlan.runScriptPath
    ? `--entrypoint "${jobPlan.runScriptPath}" \\\n`
    : `--entrypoint "bash" \\\n`;

  const dockerRunLines = [
    "mkdir -p \"$GITHUB_WORKSPACE/results\"",
    `sleep "${GH.expr("matrix.jobs.delaySeconds")}"`,
    `CMD_TO_RUN="\${{ matrix.jobs.command }}"`,
    'if [ -z "$CMD_TO_RUN" ]; then',
    `  CMD_TO_RUN="ffuf -u '${jobPlan.targetUrl}/FUZZ' -w '${GH.expr("matrix.jobs.wordlist")}' ${GH.expr("matrix.jobs.extraArgs")} -o /results/result-${GH.expr("matrix.jobs.index")}.json 2>/dev/null || subfinder -d '${jobPlan.targetUrl}' ${GH.expr("matrix.jobs.extraArgs")} -o /results/result-${GH.expr("matrix.jobs.index")}.txt 2>/dev/null || true"`,
    "fi",
    "docker run --rm \\",
    `  -e TARGET_URL="${jobPlan.targetUrl}" \\`,
    ...(perLaneRate !== undefined ? [`  -e RATE_LIMIT_PER_SEC="${perLaneRate.toFixed(2)}" \\`] : []),
    `  -v "$GITHUB_WORKSPACE/results:/results" \\`,
    ...(secretArgs ? [`${secretArgs} \\`] : []),
    entrypointFlag,
    `  "${jobPlan.toolImage}" \\`,
    `  -c "$CMD_TO_RUN"`,
  ];

  const toolRunStep = {
    name: "Run tool in cloud runner",
    shell: "bash",
    run: dockerRunLines.join("\n"),
  };

  // Parse step: validates JSON and emits the matrix output
  const parseScript = [
    "# Validate the input is parseable JSON before emitting the matrix",
    "INPUT=$(cat <<'PLAN_EOF'",
    GH.expr("inputs.job_plan"),
    "PLAN_EOF",
    ")",
    "echo \"$INPUT\" | jq empty || { echo '::error::job_plan is not valid JSON'; exit 1; }",
    'echo "matrix={\\"jobs\\":$(echo "$INPUT" | jq -c .)}" >> "$GITHUB_OUTPUT"',
  ].join("\n");

  const workflow = {
    name: `Task: ${jobPlan.taskId}`,
    on: {
      workflow_dispatch: {
        inputs: {
          job_plan: {
            required: true,
            type: "string",
            description:
              "JSON array of job entries (index, wordlist, delaySeconds, extraArgs)",
          },
        },
      },
    },
    jobs: {
      setup: {
        "runs-on": "ubuntu-latest",
        outputs: {
          matrix: GH.expr("steps.parse.outputs.matrix"),
        },
        steps: [
          {
            id: "parse",
            name: "Parse job plan into matrix",
            shell: "bash",
            run: parseScript,
          },
        ],
      },
      "run-chunk": {
        needs: "setup",
        strategy: {
          "fail-fast": false,
          matrix: GH.expr("fromJSON(needs.setup.outputs.matrix)"),
        },
        "runs-on": "ubuntu-latest",
        "timeout-minutes": clampedTimeout,
        steps: [
          toolRunStep,
          {
            if: "always()",
            uses: "actions/upload-artifact@v4",
            with: {
              name: `result-${GH.expr("matrix.jobs.index")}`,
              path: "${{ github.workspace }}/results",
              "if-no-files-found": "warn",
              "retention-days": 7,
            },
          },
        ],
      },
    },
  };

  return yaml.stringify(workflow, {
    // Preserve multi-line run scripts as block scalars (|) for readability
    lineWidth: 0,
  });
}

/**
 * Returns the conventional workflow file path for a given task.
 * e.g. ".github/workflows/task-dirbust-2026-08-04-01.yml"
 */
export function workflowFilePath(taskId: string): string {
  return `.github/workflows/task-${taskId}.yml`;
}
