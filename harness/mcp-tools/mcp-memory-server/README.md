# mcp-memory-server

A production-quality **MCP (Model Context Protocol) server** that gives LLM-powered CLI tools and agents structured memory and file storage through standard MCP tool calls.

- **Zero-config local mode** — defaults to SQLite + local filesystem, no accounts needed
- **Cloud-ready** — swap to Supabase/Postgres + S3-compatible storage (Cloudflare R2, Backblaze B2, MinIO, Supabase Storage) via env vars alone
- **Schema-free** — the LLM creates collections freely at runtime; no predefined tables
- **Drop-in compatible** — works with OpenCode, Claude Code, Codex CLI, Cursor, Windsurf, and any other MCP client

---

## Table of Contents

1. [Quick Start (local, zero-config)](#quick-start-local-zero-config)
2. [Tool Reference](#tool-reference)
3. [Configuration Reference](#configuration-reference)
4. [Setting Up Cloud Backends](#setting-up-cloud-backends)
   - [Supabase (Postgres)](#supabase-postgres)
   - [Cloudflare R2 (S3-compatible)](#cloudflare-r2-s3-compatible)
   - [Backblaze B2 (S3-compatible)](#backblaze-b2-s3-compatible)
   - [MinIO (self-hosted)](#minio-self-hosted)
5. [Configuring MCP Clients](#configuring-mcp-clients)
   - [OpenCode](#opencode)
   - [Claude Code / Claude Desktop](#claude-code--claude-desktop)
   - [Codex CLI](#codex-cli)
   - [Cursor / Windsurf / other clients](#cursor--windsurf--other-clients)
6. [Architecture](#architecture)
7. [Development & Contributing](#development--contributing)

---

## Quick Start (local, zero-config)

### Option A — Run directly from this repository

```bash
# In this repo
cd packages/mcp-memory-server
pnpm install
pnpm build
node dist/server.js
```

Data goes to `~/.mcp-memory/data.db` (SQLite) and `~/.mcp-memory/files/` (file storage) automatically.

### Option B — Test with a single tool call

With the server running, send it a JSON-RPC ping to verify it works:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/server.js
```

You should see a JSON response listing all 14 tools.

---

## Tool Reference

All tools follow the MCP protocol and return structured JSON. Every mutation tool is disabled when `READ_ONLY=true`.

### Database / structured storage

| Tool | Description |
|---|---|
| `db_create_collection` | Create a new collection (table/namespace). Idempotent. |
| `db_insert` | Insert a record. Auto-assigns UUID `id`, `createdAt`, `updatedAt`. |
| `db_query` | Query with field-level conditions, full-text search, sort, limit, offset. |
| `db_update` | Partial patch a record by id. |
| `db_delete` | Hard-delete a record by id. |
| `db_list_collections` | List all existing collections. |
| `db_get_schema` | Return the inferred field→type schema for a collection. |

### Convenience note tools

| Tool | Description |
|---|---|
| `save_note` | Quickly save a titled text note with optional tags. |
| `search_notes` | Text-search + tag-filter notes. |

### File / blob storage

| Tool | Description |
|---|---|
| `upload_file` | Upload any file (pass content as base64). Returns `fileId`. |
| `download_file` | Download a file by `fileId`. Returns base64 content. |
| `list_files` | List stored files, optionally filtered by path prefix. |
| `delete_file` | Permanently delete a file. |
| `get_file_url` | Get a temporary signed URL (60s–7 days). |

### Admin

| Tool | Description |
|---|---|
| `test_connection` | Verify backend is reachable. Returns backend type + collection count. |
| `set_active_backend` | Report currently active backends (informational — switching requires restart). |

### Query filter syntax

`db_query` accepts a `conditions` array of objects with:

```jsonc
{
  "field": "status",          // field name in the stored record
  "op": "eq",                 // eq | neq | gt | gte | lt | lte | contains | startsWith | in
  "value": "active"           // any JSON value; use array for "in"
}
```

Example tool call (as the LLM would send it):

```json
{
  "tool": "db_query",
  "arguments": {
    "collection": "findings",
    "conditions": [
      { "field": "severity", "op": "eq", "value": "high" },
      { "field": "resolved", "op": "eq", "value": false }
    ],
    "sort": { "field": "createdAt", "direction": "desc" },
    "limit": 20
  }
}
```

---

## Configuration Reference

All configuration is via environment variables. Copy `.env.example` to `.env` in the package directory and fill in what you need, or pass env vars directly in your MCP client config.

| Variable | Default | Description |
|---|---|---|
| `DATA_BACKEND` | `sqlite` | Data backend: `sqlite` or `supabase` |
| `SQLITE_PATH` | `~/.mcp-memory/data.db` | SQLite database file path |
| `SUPABASE_URL` | — | Supabase project URL (required when `DATA_BACKEND=supabase`) |
| `SUPABASE_KEY` | — | Supabase anon or service-role key |
| `BLOB_BACKEND` | `local` | File backend: `local` or `s3` |
| `LOCAL_STORAGE_PATH` | `~/.mcp-memory/files` | Directory for local file storage |
| `S3_BUCKET` | — | S3 bucket name |
| `S3_REGION` | — | S3 region (e.g. `us-east-1`, `auto` for R2) |
| `S3_ACCESS_KEY_ID` | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | — | S3 secret key |
| `S3_ENDPOINT` | — | Custom endpoint for R2/B2/MinIO (omit for AWS) |
| `S3_FORCE_PATH_STYLE` | `false` | Set `true` for MinIO |
| `MCP_TRANSPORT` | `stdio` | `stdio` (default, all clients) or `http` |
| `MCP_PORT` | `3210` | Port when `MCP_TRANSPORT=http` |
| `READ_ONLY` | `false` | Set `true` to disable all mutation tools |
| `AUDIT_LOG` | `true` | Enable write/delete audit log (SQLite backend) |

---

## Setting Up Cloud Backends

### Supabase (Postgres)

1. Create a free project at [supabase.com](https://supabase.com).
2. In **Database → SQL Editor**, run:

```sql
CREATE TABLE IF NOT EXISTS mcp_records (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_records_collection ON mcp_records(collection);
CREATE INDEX IF NOT EXISTS mcp_records_data ON mcp_records USING GIN(data);

CREATE TABLE IF NOT EXISTS mcp_meta (
  name       TEXT PRIMARY KEY,
  schema     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

3. Get your **Project URL** and **anon key** from **Settings → API**.
4. Set env vars:

```env
DATA_BACKEND=supabase
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-anon-key
```

> **Tip:** For a private memory server, use the `service_role` key instead of `anon` and enable Row Level Security on `mcp_records` if you need multi-user isolation.

---

### Cloudflare R2 (S3-compatible)

1. Create an R2 bucket in your Cloudflare dashboard.
2. Under **R2 → Manage R2 API Tokens**, create a token with **Object Read & Write** on that bucket.
3. Note your **Account ID** (found in the R2 dashboard URL).
4. Set env vars:

```env
BLOB_BACKEND=s3
S3_BUCKET=my-memory-bucket
S3_REGION=auto
S3_ACCESS_KEY_ID=your-r2-key-id
S3_SECRET_ACCESS_KEY=your-r2-secret
S3_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
```

---

### Backblaze B2 (S3-compatible)

1. Create a B2 bucket (private) in your Backblaze account.
2. Under **App Keys**, create an application key with Read & Write on that bucket.
3. Note the endpoint from the bucket details page.

```env
BLOB_BACKEND=s3
S3_BUCKET=my-memory-bucket
S3_REGION=us-west-004          # must match your bucket region
S3_ACCESS_KEY_ID=your-b2-keyId
S3_SECRET_ACCESS_KEY=your-b2-applicationKey
S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
```

---

### MinIO (self-hosted)

```env
BLOB_BACKEND=s3
S3_BUCKET=my-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://localhost:9000
S3_FORCE_PATH_STYLE=true
```

---

## Configuring MCP Clients

The server always runs via `node /path/to/dist/server.js` (or `npx mcp-memory-server` if published to npm). The only difference between clients is where the config file lives.

### OpenCode

Add to `opencode.json` in your project root (or `~/.config/opencode/opencode.json` for global config):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "memory": {
      "type": "local",
      "command": ["node", "/absolute/path/to/packages/mcp-memory-server/dist/server.js"],
      "enabled": true,
      "environment": {
        "DATA_BACKEND": "sqlite",
        "BLOB_BACKEND": "local"
      }
    }
  }
}
```

**With Supabase + R2** (cloud mode):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "memory": {
      "type": "local",
      "command": ["node", "/absolute/path/to/packages/mcp-memory-server/dist/server.js"],
      "enabled": true,
      "environment": {
        "DATA_BACKEND": "supabase",
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_KEY": "your-key",
        "BLOB_BACKEND": "s3",
        "S3_BUCKET": "my-bucket",
        "S3_REGION": "auto",
        "S3_ACCESS_KEY_ID": "your-r2-key",
        "S3_SECRET_ACCESS_KEY": "your-r2-secret",
        "S3_ENDPOINT": "https://your-account-id.r2.cloudflarestorage.com"
      }
    }
  }
}
```

> **Security:** Never commit `opencode.json` if it contains real secrets. Use OS env var substitution (`${SUPABASE_KEY}`) where OpenCode supports it, or reference a `.env` file instead.

---

### Claude Code / Claude Desktop

**Claude Code** — add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-memory-server/dist/server.js"],
      "env": {
        "DATA_BACKEND": "sqlite",
        "BLOB_BACKEND": "local"
      }
    }
  }
}
```

Or run interactively:

```bash
claude mcp add memory node /absolute/path/to/dist/server.js
```

**Claude Desktop** — add to `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-memory-server/dist/server.js"],
      "env": {
        "DATA_BACKEND": "sqlite",
        "BLOB_BACKEND": "local"
      }
    }
  }
}
```

---

### Codex CLI

Add to `~/.codex/config.toml` (global) or `.codex/config.toml` (project, trusted projects only):

```toml
[mcp_servers.memory]
command = "node"
args = ["/absolute/path/to/packages/mcp-memory-server/dist/server.js"]

[mcp_servers.memory.env]
DATA_BACKEND = "sqlite"
BLOB_BACKEND = "local"
```

---

### Cursor / Windsurf / other clients

Nearly every MCP client uses the same `mcpServers` shape. Add to your client's MCP config file:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-memory-server/dist/server.js"],
      "env": {
        "DATA_BACKEND": "sqlite",
        "BLOB_BACKEND": "local"
      }
    }
  }
}
```

Cursor: `~/.cursor/mcp.json`
Windsurf: `~/.codeium/windsurf/mcp_config.json`

---

## Architecture

```
MCP Client (OpenCode / Claude / Codex / Cursor / etc.)
    │ MCP protocol (stdio or HTTP)
    ▼
┌─────────────────────────────────┐
│          MCP Tool Layer          │
│  db_* tools   │  file_* tools   │
└────────┬───────┴────────┬────────┘
         │                │
    DataAdapter       BlobAdapter
    (interface)       (interface)
         │                │
  ┌──────┴──────┐   ┌─────┴──────────────┐
  │   SQLite    │   │   LocalFs  │  S3    │
  │  Supabase   │   │  (R2/B2/   │ (S3)  │
  └─────────────┘   │  MinIO)    └────────┘
                     └──────────┘
```

**Layered design principles:**

- The **tool layer** is backend-agnostic. It calls only the `DataAdapter` and `BlobAdapter` interfaces — never a concrete adapter directly.
- The **config layer** reads env vars, validates them with Zod, and constructs the right adapter instances at startup. No adapter-switching at runtime — restart with different env vars to change backends.
- **Credentials never pass through tool arguments.** All backend config lives server-side in env vars. The LLM caller cannot see or leak them.
- **Freeform schema:** `db_create_collection` degrades gracefully per backend — SQLite creates a typed table with a JSON data column; Supabase uses a single `mcp_records` table with JSONB, indexed for fast querying. The tool API is identical either way.
- **Audit log:** All writes and deletes are logged to `_mcp_audit` (SQLite backend) with timestamp, tool name, collection, and record/file id. Set `AUDIT_LOG=false` to disable.

---

## Development & Contributing

```bash
# Install deps
pnpm install

# Type-check
pnpm --filter mcp-memory-server run typecheck

# Build
pnpm --filter mcp-memory-server run build

# Watch mode (dev)
pnpm --filter mcp-memory-server run dev

# Run with custom config
DATA_BACKEND=sqlite SQLITE_PATH=/tmp/test.db node dist/server.js
```

### Adding a new data backend

1. Create `src/adapters/data/YourAdapter.ts` implementing the `DataAdapter` interface exactly.
2. Add a new enum value to `DataBackendEnum` in `src/config/loadConfig.ts`.
3. Add a branch in `src/server.ts` to construct the new adapter when selected.
4. No changes to the tool layer needed.

### Adding a new blob backend

Same pattern via the `BlobAdapter` interface.

### Running the full type check

```bash
pnpm --filter mcp-memory-server run typecheck
```
