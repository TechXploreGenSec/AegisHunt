import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import type { DataAdapter } from "./DataAdapter.js";
import type { QueryFilter, StoredRecord, Condition } from "../../types.js";

// ─── SQLite Adapter ──────────────────────────────────────────────────────────
//
// Default local backend.  Each collection is a separate SQLite table.
// Records are stored as JSON in a `data` column; indexed via generated columns
// for common query patterns.
//
// Schema per collection:
//   id         TEXT PRIMARY KEY
//   data       TEXT NOT NULL   (JSON blob)
//   created_at INTEGER NOT NULL
//   updated_at INTEGER NOT NULL
//
// A special `_mcp_meta` table tracks collection names and schema hints.

const VALID_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertValidName(name: string): void {
  if (!VALID_NAME.test(name)) {
    throw new Error(
      `Invalid collection name "${name}". Use letters, numbers, and underscores only; must not start with a digit.`
    );
  }
  if (name.startsWith("_mcp_")) {
    throw new Error(`Collection names starting with "_mcp_" are reserved.`);
  }
}

export class SQLiteAdapter implements DataAdapter {
  private db!: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");

    // Meta table — tracks collections and their schema hints
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _mcp_meta (
        name       TEXT PRIMARY KEY,
        schema     TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
    `);

    // Audit log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _mcp_audit (
        id         TEXT PRIMARY KEY,
        ts         INTEGER NOT NULL,
        tool       TEXT NOT NULL,
        collection TEXT,
        record_id  TEXT,
        file_id    TEXT,
        summary    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS _mcp_audit_ts ON _mcp_audit(ts);
    `);
  }

  async disconnect(): Promise<void> {
    this.db?.close();
  }

  async createCollection(name: string, schemaHint?: Record<string, string>): Promise<void> {
    assertValidName(name);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${name}" (
        id         TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "${name}_created_at" ON "${name}"(created_at);
    `);

    const schema = JSON.stringify(schemaHint ?? {});
    this.db
      .prepare(
        `INSERT OR IGNORE INTO _mcp_meta (name, schema, created_at) VALUES (?, ?, ?)`
      )
      .run(name, schema, Date.now());
  }

  async insert(collection: string, data: Record<string, unknown>): Promise<string> {
    assertValidName(collection);
    await this.ensureCollection(collection);

    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(`INSERT INTO "${collection}" (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, JSON.stringify(data), now, now);

    return id;
  }

  async query(collection: string, filter: QueryFilter): Promise<StoredRecord[]> {
    assertValidName(collection);
    await this.ensureCollection(collection);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.conditions) {
      for (const c of filter.conditions) {
        const expr = this.buildCondition(c, params);
        if (expr) conditions.push(expr);
      }
    }

    if (filter.search) {
      conditions.push(`data LIKE ?`);
      params.push(`%${filter.search}%`);
    }

    let sql = `SELECT id, data, created_at, updated_at FROM "${collection}"`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    if (filter.sort) {
      const dir = filter.sort.direction === "desc" ? "DESC" : "ASC";
      if (filter.sort.field === "createdAt") {
        sql += ` ORDER BY created_at ${dir}`;
      } else if (filter.sort.field === "updatedAt") {
        sql += ` ORDER BY updated_at ${dir}`;
      } else {
        sql += ` ORDER BY json_extract(data, '$.${filter.sort.field}') ${dir}`;
      }
    } else {
      sql += ` ORDER BY created_at DESC`;
    }

    const limit = Math.min(filter.limit ?? 100, 1000);
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, filter.offset ?? 0);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      data: string;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      ...(JSON.parse(row.data) as Record<string, unknown>),
    }));
  }

  async update(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
    assertValidName(collection);

    const row = this.db
      .prepare(`SELECT data FROM "${collection}" WHERE id = ?`)
      .get(id) as { data: string } | undefined;
    if (!row) throw new Error(`Record "${id}" not found in "${collection}"`);

    const merged = { ...(JSON.parse(row.data) as Record<string, unknown>), ...patch };
    this.db
      .prepare(`UPDATE "${collection}" SET data = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(merged), Date.now(), id);
  }

  async delete(collection: string, id: string): Promise<void> {
    assertValidName(collection);
    const info = this.db.prepare(`DELETE FROM "${collection}" WHERE id = ?`).run(id);
    if (info.changes === 0) throw new Error(`Record "${id}" not found in "${collection}"`);
  }

  async listCollections(): Promise<string[]> {
    const rows = this.db
      .prepare(`SELECT name FROM _mcp_meta ORDER BY name`)
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  async getSchema(collection: string): Promise<Record<string, string>> {
    assertValidName(collection);
    const row = this.db
      .prepare(`SELECT schema FROM _mcp_meta WHERE name = ?`)
      .get(collection) as { schema: string } | undefined;
    if (!row) return {};

    // Augment schema hint with field names actually present in recent records
    const sample = this.db
      .prepare(`SELECT data FROM "${collection}" ORDER BY created_at DESC LIMIT 20`)
      .all() as Array<{ data: string }>;

    const inferred: Record<string, string> = JSON.parse(row.schema) as Record<string, string>;
    for (const s of sample) {
      const obj = JSON.parse(s.data) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (!inferred[k]) inferred[k] = typeof v;
      }
    }
    return inferred;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async ensureCollection(name: string): Promise<void> {
    const exists = this.db
      .prepare(`SELECT 1 FROM _mcp_meta WHERE name = ?`)
      .get(name);
    if (!exists) {
      await this.createCollection(name);
    }
  }

  private buildCondition(c: Condition, params: unknown[]): string | null {
    const jsonPath = `json_extract(data, '$.${c.field}')`;
    switch (c.op) {
      case "eq":
        params.push(c.value);
        return `${jsonPath} = ?`;
      case "neq":
        params.push(c.value);
        return `${jsonPath} != ?`;
      case "gt":
        params.push(c.value);
        return `${jsonPath} > ?`;
      case "gte":
        params.push(c.value);
        return `${jsonPath} >= ?`;
      case "lt":
        params.push(c.value);
        return `${jsonPath} < ?`;
      case "lte":
        params.push(c.value);
        return `${jsonPath} <= ?`;
      case "contains":
        params.push(`%${c.value}%`);
        return `CAST(${jsonPath} AS TEXT) LIKE ?`;
      case "startsWith":
        params.push(`${c.value}%`);
        return `CAST(${jsonPath} AS TEXT) LIKE ?`;
      case "in":
        if (!Array.isArray(c.value) || c.value.length === 0) return null;
        for (const v of c.value) params.push(v);
        return `${jsonPath} IN (${(c.value as unknown[]).map(() => "?").join(", ")})`;
      default:
        return null;
    }
  }

  /** Append to the audit log (fire-and-forget — never throws) */
  auditLog(entry: {
    tool: string;
    collection?: string;
    recordId?: string;
    fileId?: string;
    summary: string;
  }): void {
    try {
      this.db
        .prepare(
          `INSERT INTO _mcp_audit (id, ts, tool, collection, record_id, file_id, summary)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          Date.now(),
          entry.tool,
          entry.collection ?? null,
          entry.recordId ?? null,
          entry.fileId ?? null,
          entry.summary
        );
    } catch {
      // audit failure must not surface to the LLM caller
    }
  }
}
