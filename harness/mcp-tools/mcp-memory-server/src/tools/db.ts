import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataAdapter } from "../adapters/data/DataAdapter.js";
import type { SQLiteAdapter } from "../adapters/data/SQLiteAdapter.js";
import type { AppConfig } from "../config/loadConfig.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

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
  adapter: DataAdapter,
  entry: Parameters<SQLiteAdapter["auditLog"]>[0]
): void {
  if (typeof (adapter as SQLiteAdapter).auditLog === "function") {
    (adapter as SQLiteAdapter).auditLog(entry);
  }
}

// ─── Condition schema ─────────────────────────────────────────────────────────

const ConditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "startsWith", "in"]),
  value: z.unknown(),
});

// ─── Tool Registrations ───────────────────────────────────────────────────────

export function registerDbTools(
  server: McpServer,
  adapter: DataAdapter,
  cfg: AppConfig
): void {
  const readOnly = cfg.READ_ONLY;

  // ── db_list_collections ──────────────────────────────────────────────────
  server.tool(
    "db_list_collections",
    "List all existing collections (tables/namespaces) in the database.",
    {},
    async () => {
      try {
        const names = await adapter.listCollections();
        return ok({ collections: names, count: names.length });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── db_create_collection ──────────────────────────────────────────────────
  server.tool(
    "db_create_collection",
    readOnly
      ? "[DISABLED — server is in read-only mode]"
      : "Create a new collection (table/namespace). Idempotent — safe to call even if the collection already exists. Provide an optional schemaHint object mapping field names to types (e.g. { title: 'string', done: 'boolean' }) to help adapters that support typed columns.",
    {
      name: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Name must be alphanumeric/underscores, not start with a digit")
        .describe("Collection name"),
      schemaHint: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional map of field names to JS types (string | number | boolean | object)"),
    },
    async ({ name, schemaHint }) => {
      if (readOnly) return err("Server is in read-only mode.");
      try {
        await adapter.createCollection(name, schemaHint);
        tryAudit(adapter, { tool: "db_create_collection", collection: name, summary: `created collection "${name}"` });
        return ok({ ok: true, collection: name });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── db_insert ─────────────────────────────────────────────────────────────
  server.tool(
    "db_insert",
    readOnly
      ? "[DISABLED — server is in read-only mode]"
      : "Insert a new record into a collection. The adapter assigns a UUID id and sets createdAt/updatedAt automatically. Returns the new record id.",
    {
      collection: z.string().min(1).describe("Target collection name"),
      data: z
        .record(z.string(), z.unknown())
        .describe("Key-value record to store. Any JSON-serialisable object."),
    },
    async ({ collection, data }) => {
      if (readOnly) return err("Server is in read-only mode.");
      try {
        const id = await adapter.insert(collection, data);
        tryAudit(adapter, { tool: "db_insert", collection, recordId: id, summary: `inserted record ${id} into "${collection}"` });
        return ok({ ok: true, id, collection });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── db_query ──────────────────────────────────────────────────────────────
  server.tool(
    "db_query",
    "Query records from a collection. Supports field-level conditions, full-text search, sorting, limit, and offset. Returns an array of records each with an id, createdAt, updatedAt, and all stored fields.",
    {
      collection: z.string().min(1).describe("Collection to query"),
      conditions: z
        .array(ConditionSchema)
        .optional()
        .describe(
          "Array of field-level filter conditions. Each has: field (string), op (eq|neq|gt|gte|lt|lte|contains|startsWith|in), value."
        ),
      search: z
        .string()
        .optional()
        .describe("Full-text search string — matches anywhere in the record data"),
      sort: z
        .object({
          field: z.string().describe("Field name to sort by, or 'createdAt'/'updatedAt'"),
          direction: z.enum(["asc", "desc"]).default("desc"),
        })
        .optional()
        .describe("Sort configuration"),
      limit: z.number().int().min(1).max(1000).default(50).describe("Max records to return (default 50)"),
      offset: z.number().int().min(0).default(0).describe("Pagination offset"),
    },
    async ({ collection, conditions, search, sort, limit, offset }) => {
      try {
        const records = await adapter.query(collection, {
          conditions: conditions as Parameters<typeof adapter.query>[1]["conditions"],
          search,
          sort,
          limit,
          offset,
        });
        return ok({ records, count: records.length, collection });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── db_update ─────────────────────────────────────────────────────────────
  server.tool(
    "db_update",
    readOnly
      ? "[DISABLED — server is in read-only mode]"
      : "Partially update an existing record by id. Only the fields you supply are changed — other fields are preserved. updatedAt is set automatically.",
    {
      collection: z.string().min(1).describe("Collection containing the record"),
      id: z.string().uuid().describe("Record id (UUID)"),
      patch: z
        .record(z.string(), z.unknown())
        .describe("Fields to update (partial patch)"),
    },
    async ({ collection, id, patch }) => {
      if (readOnly) return err("Server is in read-only mode.");
      try {
        await adapter.update(collection, id, patch);
        tryAudit(adapter, { tool: "db_update", collection, recordId: id, summary: `updated record ${id} in "${collection}"` });
        return ok({ ok: true, id, collection });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── db_delete ─────────────────────────────────────────────────────────────
  server.tool(
    "db_delete",
    readOnly
      ? "[DISABLED — server is in read-only mode]"
      : "Hard-delete a record by id from a collection. This is permanent — use with care.",
    {
      collection: z.string().min(1).describe("Collection containing the record"),
      id: z.string().uuid().describe("Record id (UUID) to delete"),
    },
    async ({ collection, id }) => {
      if (readOnly) return err("Server is in read-only mode.");
      try {
        await adapter.delete(collection, id);
        tryAudit(adapter, { tool: "db_delete", collection, recordId: id, summary: `deleted record ${id} from "${collection}"` });
        return ok({ ok: true, id, collection, deleted: true });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── db_get_schema ─────────────────────────────────────────────────────────
  server.tool(
    "db_get_schema",
    "Return the known schema (field → type map) for a collection. For SQLite the schema is inferred from stored records; for typed backends it reflects the declared types.",
    {
      collection: z.string().min(1).describe("Collection name"),
    },
    async ({ collection }) => {
      try {
        const schema = await adapter.getSchema(collection);
        return ok({ collection, schema });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── save_note ─────────────────────────────────────────────────────────────
  server.tool(
    "save_note",
    readOnly
      ? "[DISABLED — server is in read-only mode]"
      : "Convenience wrapper: quickly save a text note with optional tags. Notes are stored in the built-in 'notes' collection. Returns the note id.",
    {
      title: z.string().min(1).max(512).describe("Note title"),
      content: z.string().describe("Note body (markdown supported)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Optional tags / categories for the note"),
    },
    async ({ title, content, tags }) => {
      if (readOnly) return err("Server is in read-only mode.");
      try {
        await adapter.createCollection("notes");
        const id = await adapter.insert("notes", {
          title,
          content,
          tags: tags ?? [],
          type: "note",
        });
        tryAudit(adapter, { tool: "save_note", collection: "notes", recordId: id, summary: `saved note "${title}"` });
        return ok({ ok: true, id, collection: "notes", title });
      } catch (e) {
        return err(String(e));
      }
    }
  );

  // ── search_notes ──────────────────────────────────────────────────────────
  server.tool(
    "search_notes",
    "Convenience wrapper: search notes by text and/or tags. Returns matching notes from the built-in 'notes' collection.",
    {
      query: z.string().optional().describe("Full-text search string"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags (any match)"),
      limit: z.number().int().min(1).max(200).default(20).describe("Max results"),
    },
    async ({ query, tags, limit }) => {
      try {
        const conditions =
          tags && tags.length > 0
            ? [{ field: "tags", op: "contains" as const, value: tags[0] }]
            : undefined;

        const records = await adapter.query("notes", {
          conditions,
          search: query,
          limit,
          sort: { field: "updatedAt", direction: "desc" },
        });
        return ok({ notes: records, count: records.length });
      } catch (e) {
        // notes collection may not exist yet
        return ok({ notes: [], count: 0 });
      }
    }
  );

  // ── test_connection ───────────────────────────────────────────────────────
  server.tool(
    "test_connection",
    "Verify that the current data backend is reachable and operational. Returns backend type and collection count.",
    {},
    async () => {
      try {
        const collections = await adapter.listCollections();
        return ok({
          ok: true,
          backend: cfg.DATA_BACKEND,
          collectionsCount: collections.length,
          readOnly: cfg.READ_ONLY,
        });
      } catch (e) {
        return err(`Connection test failed: ${String(e)}`);
      }
    }
  );
}
