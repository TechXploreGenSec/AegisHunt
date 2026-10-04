import { z } from "zod";
import "dotenv/config";
import path from "path";
import os from "os";

// ─── Config Schema ────────────────────────────────────────────────────────────

const DataBackendEnum = z.enum(["sqlite", "supabase"]);
const BlobBackendEnum = z.enum(["local", "s3"]);

const ConfigSchema = z.object({
  // ── Data backend ────────────────────────────────────────────────────────
  DATA_BACKEND: DataBackendEnum.default("sqlite"),

  // SQLite
  SQLITE_PATH: z.string().default(
    path.join(os.homedir(), ".mcp-memory", "data.db")
  ),

  // Supabase
  SUPABASE_URL: z.string().optional(),
  SUPABASE_KEY: z.string().optional(),

  // ── Blob backend ────────────────────────────────────────────────────────
  BLOB_BACKEND: BlobBackendEnum.default("local"),

  // Local FS
  LOCAL_STORAGE_PATH: z.string().default(
    path.join(os.homedir(), ".mcp-memory", "files")
  ),

  // S3-compatible
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Optional endpoint override for R2, B2, Supabase Storage, MinIO, etc. */
  S3_ENDPOINT: z.string().optional(),
  /** Set to "true" for MinIO and similar path-style services */
  S3_FORCE_PATH_STYLE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  // ── Server options ───────────────────────────────────────────────────────
  /** "stdio" (default) | "http" — transport to use */
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  /** Port when MCP_TRANSPORT=http */
  MCP_PORT: z
    .string()
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535))
    .default("3210"),

  /** Enable write-level audit log (SQLite backend only for now) */
  AUDIT_LOG: z
    .string()
    .transform((v) => v !== "false")
    .default("true"),

  /** Read-only mode — disables all mutation tools */
  READ_ONLY: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

// ─── Config Loader ────────────────────────────────────────────────────────────

export function loadConfig(): AppConfig {
  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    const msgs = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration error:\n${msgs}`);
  }

  const cfg = result.data;

  // Cross-field validation
  if (cfg.DATA_BACKEND === "supabase") {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) {
      throw new Error(
        "DATA_BACKEND=supabase requires SUPABASE_URL and SUPABASE_KEY to be set."
      );
    }
  }

  if (cfg.BLOB_BACKEND === "s3") {
    const missing: string[] = [];
    if (!cfg.S3_BUCKET) missing.push("S3_BUCKET");
    if (!cfg.S3_REGION) missing.push("S3_REGION");
    if (!cfg.S3_ACCESS_KEY_ID) missing.push("S3_ACCESS_KEY_ID");
    if (!cfg.S3_SECRET_ACCESS_KEY) missing.push("S3_SECRET_ACCESS_KEY");
    if (missing.length > 0) {
      throw new Error(
        `BLOB_BACKEND=s3 requires: ${missing.join(", ")}`
      );
    }
  }

  return cfg;
}
