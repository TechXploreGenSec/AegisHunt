import { z } from "zod";
import dotenv from "dotenv";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env");

// Sanitize any unexpanded {env:...} placeholders passed by external orchestrators like OpenCode
for (const key of ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"]) {
  if (process.env[key] && process.env[key]!.startsWith("{env:")) {
    delete process.env[key];
  }
}

// Load .env only for variables not already defined in process.env (override: false)
dotenv.config({ path: envPath, override: false, quiet: true });

const envSchema = z.object({
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  GITHUB_OWNER: z.string().min(1, "GITHUB_OWNER is required"),
  GITHUB_REPO: z.string().min(1, "GITHUB_REPO is required"),
  GITHUB_DEFAULT_BRANCH: z.string().default("main"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("http"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3456),
  SCOPE_CONFIG_PATH: z.string().min(1, "SCOPE_CONFIG_PATH is required — point at the same scope file scope-gate.ts loads"),
  MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).default(5),
  MAX_JOBS_PER_PLAN: z.coerce.number().int().min(1).max(256).default(20),
  AUDIT_LOG_PATH: z.string().default("./audit.log"),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration error:\n${errors}`);
  }
  return result.data;
}

export type Config = z.infer<typeof envSchema>;

// Parsed and validated configuration — call once at startup
export const config: Config = loadConfig();

export interface SharedScopeFile {
  programId: string;
  inScope: string[];
  outOfScope: string[];
  maxRequestsPerSecond: number;
}

/**
 * Loads the SAME scope file scope-gate.ts reads — single source of truth.
 * Replaces the old SCOPE_ALLOWLIST env parsing (fail-open) with a
 * fail-closed shared file: empty inScope rejects everything.
 */
export function getSharedScope(): SharedScopeFile {
  const raw = readFileSync(config.SCOPE_CONFIG_PATH, "utf8");
  return JSON.parse(raw) as SharedScopeFile;
}
