import { z } from "zod";

export const JobEntrySchema = z.object({
  index: z.number().int().min(0).describe("Zero-based job index"),
  command: z
    .string()
    .optional()
    .describe(
      "FULL BASH OR PYTHON SCRIPT / COMMAND to run inside container. Supports multi-line bash scripts, loops, subshells, inline python scripts ('python3 -c ...'), and nested pipelines. All final output files MUST be saved in /results/ directory to be uploaded as artifacts!"
    ),
  wordlist: z.string().optional().describe("Path or URL to wordlist if using standard wordlist runner"),
  delaySeconds: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Seconds to sleep before starting work (stagger)"),
  extraArgs: z
    .string()
    .default("")
    .describe("Additional CLI flags for the tool"),
});

export type JobEntry = z.infer<typeof JobEntrySchema>;

export const JobPlanSchema = z.object({
  taskId: z
    .string()
    .min(1)
    .regex(/^[\w\-\.]+$/, "taskId must be alphanumeric/dash/dot")
    .describe("Unique identifier for this task run, e.g. dirbust-2026-08-04-01"),
  targetUrl: z
    .string()
    .url()
    .describe("The target URL that all jobs will operate against"),
  toolImage: z
    .string()
    .min(1)
    .default("godfathercyb3r/kali-bugbounty:latest")
    .describe(
      "Docker image to run in cloud runners. NEVER BUILD IMAGES LOCALLY ON USER'S LAPTOP. Use one of these pre-built public Docker images:\n" +
      " - godfathercyb3r/kali-bb-recon:latest (Recon & subdomain enumeration: subfinder, assetfinder, amass, dnsx, etc.)\n" +
      " - godfathercyb3r/kali-bb-fuzzing:latest (Directory fuzzing & web scanning: ffuf, feroxbuster, gobuster, etc.)\n" +
      " - godfathercyb3r/kali-bb-scanner:latest (Port scanning & network probing: naabu, nmap, masscan, nuclei, etc.)\n" +
      " - godfathercyb3r/kali-bb-exploit:latest (Vulnerability assessment & PoC execution)\n" +
      " - godfathercyb3r/kali-bugbounty:latest (Full Bug Bounty Kali suite)\n" +
      " - godfathercyb3r/kali-bb-base:latest (Base Kali environment)\n" +
      "Or any standard public Docker Hub / GHCR image."
    ),
  timeoutMinutes: z
    .number()
    .int()
    .min(1)
    .max(350)
    .default(300)
    .describe("Per-job timeout in minutes (clamped to ≤350 by the generator)"),
  jobs: z
    .array(JobEntrySchema)
    .min(1)
    .describe("Per-job plan authored by the LLM"),
  secretsRequired: z
    .array(z.string())
    .default([])
    .describe("GitHub secret names the workflow jobs will need (e.g. TARGET_AUTH_TOKEN)"),
  runScriptPath: z
    .string()
    .optional()
    .describe("Optional path inside the container to a shell script. Defaults to running the image entrypoint."),
});

export type JobPlan = z.infer<typeof JobPlanSchema>;
