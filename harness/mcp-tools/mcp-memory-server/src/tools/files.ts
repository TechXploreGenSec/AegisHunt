import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BlobAdapter } from "../adapters/blob/BlobAdapter.js";
import type { DataAdapter } from "../adapters/data/DataAdapter.js";
import type { SQLiteAdapter } from "../adapters/data/SQLiteAdapter.js";
import type { AppConfig } from "../config/loadConfig.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
    isError: true as const,
  };
}

function tryAudit(
  dataAdapter: DataAdapter,
  entry: Parameters<SQLiteAdapter["auditLog"]>[0]
): void {
  if (typeof (dataAdapter as SQLiteAdapter).auditLog === "function") {
    (dataAdapter as SQLiteAdapter).auditLog(entry);
  }
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB hard limit

// ─── Tool Registrations ───────────────────────────────────────────────────────

export function registerFileTools(
  server: McpServer,
  blob: BlobAdapter,
  data: DataAdapter,
  cfg: AppConfig
): void {
  const readOnly = cfg.READ_ONLY;

  // ── upload_file ───────────────────────────────────────────────────────────
  server.tool(
    "upload_file",
    readOnly
      ? "[DISABLED — server is in read-only mode]"
      : "Upload a file (note, image, zip, etc.) to configured blob storage. Pass the file content as a base64-encoded string. Returns the fileId to use for subsequent operations.",
    {
      path: z
        .string()
        .min(1)
        .max(512)
        .describe(
          "Storage path / key for the file, e.g. 'notes/2024-01-15.md' or 'images/screenshot.png'"
        ),
      contentBase64: z
        .string()
        .describe("File contents encoded as a base64 string"),
      contentType: z
        .string()
        .default("application/octet-stream")
        .describe("MIME type, e.g. 'text/markdown', 'image/png', 'application/zip'"),
    },
    async ({ path: storagePath, contentBase64, contentType }) => {
      if (readOnly) return err("Server is in read-only mode.");
      try {
        const buf = Buffer.from(contentBase64, "base64");
        if (buf.length > MAX_UPLOAD_BYTES) {
          return err(`File too large: ${buf.length} bytes (limit ${MAX_UPLOAD_BYTES} bytes / 50 MB)`);
        }
        const fileId = await blob.upload(storagePath, buf, contentType);
        tryAudit(data, { tool: "upload_file", fileId, summary: `uploaded file "${storagePath}"` });
        return ok({ ok: true, fileId, path: storagePath, sizeBytes: buf.length });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── upload_local_file ─────────────────────────────────────────────────────
  server.tool(
    "upload_local_file",
    readOnly
      ? "[DISABLED — server is in read-only mode]"
      : "Upload a file directly from local disk path into blob storage (e.g. Storj S3 / local storage). Avoids needing base64 encoding in tool arguments.",
    {
      localFilePath: z
        .string()
        .min(1)
        .describe("Absolute or relative path to the local file on disk"),
      storagePath: z
        .string()
        .min(1)
        .max(512)
        .describe("Target storage path / key in blob storage, e.g. 'reports/report.pdf'"),
      contentType: z
        .string()
        .default("application/octet-stream")
        .describe("MIME type, e.g. 'application/pdf', 'image/png'"),
    },
    async ({ localFilePath, storagePath, contentType }) => {
      if (readOnly) return err("Server is in read-only mode.");
      try {
        const fs = await import("fs/promises");
        const pathModule = await import("path");
        const resolvedPath = pathModule.resolve(localFilePath);
        const buf = await fs.readFile(resolvedPath);
        if (buf.length > MAX_UPLOAD_BYTES) {
          return err(`File too large: ${buf.length} bytes (limit ${MAX_UPLOAD_BYTES} bytes / 50 MB)`);
        }
        const fileId = await blob.upload(storagePath, buf, contentType);
        tryAudit(data, { tool: "upload_local_file", fileId, summary: `uploaded local file "${resolvedPath}" to "${storagePath}"` });
        return ok({ ok: true, fileId, path: storagePath, sizeBytes: buf.length });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── download_file ─────────────────────────────────────────────────────────
  server.tool(
    "download_file",
    "Download a stored file by its fileId. Returns the file contents as a base64-encoded string and its MIME type.",
    {
      fileId: z.string().min(1).describe("File id returned by upload_file or list_files"),
    },
    async ({ fileId }) => {
      try {
        const buf = await blob.download(fileId);
        return ok({
          ok: true,
          fileId,
          contentBase64: buf.toString("base64"),
          sizeBytes: buf.length,
        });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── list_files ────────────────────────────────────────────────────────────
  server.tool(
    "list_files",
    "List stored files. Optionally filter by a path prefix (e.g. 'notes/' to list only notes). Returns fileId, path, contentType, size, and createdAt for each file.",
    {
      prefix: z
        .string()
        .optional()
        .describe("Optional path prefix to filter results, e.g. 'images/'"),
    },
    async ({ prefix }) => {
      try {
        const files = await blob.list(prefix);
        return ok({ files, count: files.length });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── delete_file ───────────────────────────────────────────────────────────
  server.tool(
    "delete_file",
    readOnly
      ? "[DISABLED — server is in read-only mode]"
      : "Permanently delete a stored file by its fileId. This is irreversible.",
    {
      fileId: z.string().min(1).describe("File id to delete"),
    },
    async ({ fileId }) => {
      if (readOnly) return err("Server is in read-only mode.");
      try {
        await blob.delete(fileId);
        tryAudit(data, { tool: "delete_file", fileId, summary: `deleted file "${fileId}"` });
        return ok({ ok: true, fileId, deleted: true });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── get_file_url ──────────────────────────────────────────────────────────
  server.tool(
    "get_file_url",
    "Get a temporary signed URL for a stored file. The URL expires after the specified number of seconds (default 3600 = 1 hour). For local-fs storage this returns a file:// URI.",
    {
      fileId: z.string().min(1).describe("File id to generate a URL for"),
      expiresInSec: z
        .number()
        .int()
        .min(60)
        .max(604800)
        .default(3600)
        .describe("URL expiry in seconds (60–604800, default 3600 = 1 hour)"),
    },
    async ({ fileId, expiresInSec }) => {
      try {
        const url = await blob.getSignedUrl(fileId, expiresInSec);
        const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();
        return ok({ ok: true, fileId, url, expiresAt, expiresInSec });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── set_active_backend ────────────────────────────────────────────────────
  server.tool(
    "set_active_backend",
    "Admin tool: report the currently active data and blob backends. Switching backends at runtime is not supported — restart the server with different env vars to change backends. This tool is informational only.",
    {},
    async () => {
      return ok({
        dataBackend: cfg.DATA_BACKEND,
        blobBackend: cfg.BLOB_BACKEND,
        readOnly: cfg.READ_ONLY,
        note: "To switch backends, set the appropriate env vars and restart the server.",
        dataConfig:
          cfg.DATA_BACKEND === "sqlite"
            ? { path: cfg.SQLITE_PATH }
            : { url: cfg.SUPABASE_URL ? cfg.SUPABASE_URL.replace(/key=.*/i, "key=***") : undefined },
        blobConfig:
          cfg.BLOB_BACKEND === "local"
            ? { path: cfg.LOCAL_STORAGE_PATH }
            : { bucket: cfg.S3_BUCKET, region: cfg.S3_REGION, endpoint: cfg.S3_ENDPOINT },
      });
    }
  );
}
