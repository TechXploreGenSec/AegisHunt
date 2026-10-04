#!/usr/bin/env node
/**
 * MCP Memory & Storage Server
 *
 * Entrypoint — reads config, constructs the correct adapters, registers all
 * MCP tools, and connects the server transport (stdio by default).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";

import { loadConfig } from "./config/loadConfig.js";
import { SQLiteAdapter } from "./adapters/data/SQLiteAdapter.js";
import { SupabaseAdapter } from "./adapters/data/SupabaseAdapter.js";
import { LocalFsAdapter } from "./adapters/blob/LocalFsAdapter.js";
import { S3Adapter } from "./adapters/blob/S3Adapter.js";
import type { DataAdapter } from "./adapters/data/DataAdapter.js";
import type { BlobAdapter } from "./adapters/blob/BlobAdapter.js";
import { registerDbTools } from "./tools/db.js";
import { registerFileTools } from "./tools/files.js";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Load and validate configuration
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    process.stderr.write(`[mcp-memory] Config error: ${String(e)}\n`);
    process.exit(1);
  }

  // 2. Construct data adapter
  let dataAdapter: DataAdapter;
  if (cfg.DATA_BACKEND === "supabase") {
    dataAdapter = new SupabaseAdapter(cfg.SUPABASE_URL!, cfg.SUPABASE_KEY!);
  } else {
    dataAdapter = new SQLiteAdapter(cfg.SQLITE_PATH);
  }

  // 3. Construct blob adapter
  let blobAdapter: BlobAdapter;
  if (cfg.BLOB_BACKEND === "s3") {
    blobAdapter = new S3Adapter({
      bucket: cfg.S3_BUCKET!,
      region: cfg.S3_REGION!,
      accessKeyId: cfg.S3_ACCESS_KEY_ID!,
      secretAccessKey: cfg.S3_SECRET_ACCESS_KEY!,
      endpoint: cfg.S3_ENDPOINT,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    });
  } else {
    blobAdapter = new LocalFsAdapter(cfg.LOCAL_STORAGE_PATH);
  }

  // 4. Connect adapters (open DB connections, initialise dirs, etc.)
  try {
    await dataAdapter.connect();
    await blobAdapter.connect();
  } catch (e) {
    process.stderr.write(`[mcp-memory] Adapter init failed: ${String(e)}\n`);
    process.exit(1);
  }

  // 5. Create the MCP server
  const server = new McpServer({
    name: "mcp-memory",
    version: "0.1.0",
  });

  // 6. Register all tools
  registerDbTools(server, dataAdapter, cfg);
  registerFileTools(server, blobAdapter, dataAdapter, cfg);

  // 7. Connect transport
  if (cfg.MCP_TRANSPORT === "http") {
    await startHttpTransport(server, cfg.MCP_PORT);
  } else {
    await startStdioTransport(server);
  }

  // 8. Graceful shutdown
  const shutdown = async () => {
    process.stderr.write("[mcp-memory] Shutting down...\n");
    await dataAdapter.disconnect();
    await blobAdapter.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

// ─── Transport helpers ────────────────────────────────────────────────────────

async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[mcp-memory] Ready (stdio transport)\n");
}

async function startHttpTransport(
  server: McpServer,
  port: number
): Promise<void> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    // CORS headers for browser-based MCP clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. Use POST /mcp" }));
      return;
    }

    if (req.method === "POST") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => Math.random().toString(36).slice(2),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
        await server.connect(transport);
      }

      await transport.handleRequest(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing session id" }));
        return;
      }
      await transports.get(sessionId)!.handleRequest(req, res);
      return;
    }

    res.writeHead(405);
    res.end();
  });

  httpServer.listen(port, () => {
    process.stderr.write(
      `[mcp-memory] Ready (HTTP transport) — listening on port ${port}\n`
    );
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((e) => {
  process.stderr.write(`[mcp-memory] Fatal: ${String(e)}\n`);
  process.exit(1);
});
