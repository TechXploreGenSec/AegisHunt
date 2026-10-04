import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { DataAdapter } from "./DataAdapter.js";
import type { QueryFilter, StoredRecord, Condition } from "../../types.js";

// ─── Supabase / Postgres Adapter ──────────────────────────────────────────────
//
// Uses a single `mcp_records` table with a JSONB `data` column to avoid the
// need for dynamic DDL (Supabase client can't CREATE TABLE arbitrarily).
// Collections are distinguished by the `collection` column.
//
// Table DDL (run once via Supabase SQL editor or migration):
//
//   CREATE TABLE IF NOT EXISTS mcp_records (
//     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     collection TEXT NOT NULL,
//     data       JSONB NOT NULL DEFAULT '{}',
//     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
//     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
//   );
//   CREATE INDEX IF NOT EXISTS mcp_records_collection ON mcp_records(collection);
//   CREATE INDEX IF NOT EXISTS mcp_records_data ON mcp_records USING GIN(data);
//
// The adapter calls `createCollection()` which inserts a row into `mcp_meta`
// (also auto-created) and ensures the DDL above exists.

const SETUP_SQL_NOTE = `
Supabase adapter requires a one-time SQL setup.  Run the following in the
Supabase SQL editor (Database → SQL Editor):

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
`.trim();

export class SupabaseAdapter implements DataAdapter {
  private client!: SupabaseClient;
  private readonly url: string;
  private readonly key: string;

  constructor(url: string, key: string) {
    this.url = url;
    this.key = key;
  }

  async connect(): Promise<void> {
    this.client = createClient(this.url, this.key, {
      auth: { persistSession: false },
    });

    // Light connectivity check — if mcp_records doesn't exist the user gets
    // a helpful message with the setup SQL instead of a cryptic error.
    const { error } = await this.client
      .from("mcp_records")
      .select("id")
      .limit(1);

    if (error && error.code === "42P01") {
      throw new Error(
        `Supabase table "mcp_records" not found.\n\n${SETUP_SQL_NOTE}`
      );
    }
    if (error) {
      throw new Error(`Supabase connection error: ${error.message}`);
    }
  }

  async disconnect(): Promise<void> {
    // Supabase JS client holds no persistent connection; nothing to do.
  }

  async createCollection(
    name: string,
    schemaHint?: Record<string, string>
  ): Promise<void> {
    const { error } = await this.client
      .from("mcp_meta")
      .upsert(
        { name, schema: schemaHint ?? {} },
        { onConflict: "name", ignoreDuplicates: true }
      );
    if (error) throw new Error(`createCollection failed: ${error.message}`);
  }

  async insert(
    collection: string,
    data: Record<string, unknown>
  ): Promise<string> {
    await this.ensureCollection(collection);
    const { data: row, error } = await this.client
      .from("mcp_records")
      .insert({ collection, data })
      .select("id")
      .single();
    if (error) throw new Error(`insert failed: ${error.message}`);
    return (row as { id: string }).id;
  }

  async query(
    collection: string,
    filter: QueryFilter
  ): Promise<StoredRecord[]> {
    let q = this.client
      .from("mcp_records")
      .select("id, data, created_at, updated_at")
      .eq("collection", collection);

    if (filter.conditions) {
      for (const c of filter.conditions) {
        q = this.applyCondition(q, c);
      }
    }

    if (filter.search) {
      // Full-text across the JSONB field via Postgres text cast
      q = (q as ReturnType<typeof q.textSearch>).textSearch("data", filter.search, {
        type: "plain",
      });
    }

    const limit = Math.min(filter.limit ?? 100, 1000);
    q = q.limit(limit);
    if (filter.offset) q = q.range(filter.offset, filter.offset + limit - 1);

    if (filter.sort) {
      const asc = filter.sort.direction !== "desc";
      if (filter.sort.field === "createdAt") {
        q = q.order("created_at", { ascending: asc });
      } else if (filter.sort.field === "updatedAt") {
        q = q.order("updated_at", { ascending: asc });
      } else {
        // Sort on a JSONB path (Supabase supports this via arrow operator)
        q = q.order(`data->>${filter.sort.field}`, { ascending: asc } as Parameters<typeof q.order>[1]);
      }
    } else {
      q = q.order("created_at", { ascending: false });
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(`query failed: ${error.message}`);

    return (
      rows as Array<{
        id: string;
        data: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      }>
    ).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ...r.data,
    }));
  }

  async update(
    collection: string,
    id: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    // Fetch current data, merge, write back
    const { data: row, error: fetchErr } = await this.client
      .from("mcp_records")
      .select("data")
      .eq("collection", collection)
      .eq("id", id)
      .single();
    if (fetchErr || !row) {
      throw new Error(`Record "${id}" not found in "${collection}"`);
    }
    const merged = { ...(row as { data: Record<string, unknown> }).data, ...patch };
    const { error } = await this.client
      .from("mcp_records")
      .update({ data: merged, updated_at: new Date().toISOString() })
      .eq("collection", collection)
      .eq("id", id);
    if (error) throw new Error(`update failed: ${error.message}`);
  }

  async delete(collection: string, id: string): Promise<void> {
    const { error } = await this.client
      .from("mcp_records")
      .delete()
      .eq("collection", collection)
      .eq("id", id);
    if (error) throw new Error(`delete failed: ${error.message}`);
  }

  async listCollections(): Promise<string[]> {
    const { data, error } = await this.client
      .from("mcp_meta")
      .select("name")
      .order("name");
    if (error) throw new Error(`listCollections failed: ${error.message}`);
    return (data as Array<{ name: string }>).map((r) => r.name);
  }

  async getSchema(collection: string): Promise<Record<string, string>> {
    const { data, error } = await this.client
      .from("mcp_meta")
      .select("schema")
      .eq("name", collection)
      .single();
    if (error || !data) return {};
    return (data as { schema: Record<string, string> }).schema;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async ensureCollection(name: string): Promise<void> {
    const { data } = await this.client
      .from("mcp_meta")
      .select("name")
      .eq("name", name)
      .single();
    if (!data) await this.createCollection(name);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyCondition(q: any, c: Condition): any {
    const path = `data->>${c.field}`;
    switch (c.op) {
      case "eq":
        return q.eq(path, String(c.value));
      case "neq":
        return q.neq(path, String(c.value));
      case "gt":
        return q.gt(path, String(c.value));
      case "gte":
        return q.gte(path, String(c.value));
      case "lt":
        return q.lt(path, String(c.value));
      case "lte":
        return q.lte(path, String(c.value));
      case "contains":
        return q.ilike(path, `%${String(c.value)}%`);
      case "startsWith":
        return q.ilike(path, `${String(c.value)}%`);
      case "in":
        return q.in(path, (c.value as unknown[]).map(String));
      default:
        return q;
    }
  }
}
