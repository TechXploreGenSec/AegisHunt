import type { QueryFilter, StoredRecord } from "../../types.js";

// ─── Data Adapter Interface ──────────────────────────────────────────────────
//
// Every data backend (SQLite, Supabase/Postgres, Neon, Turso, …) must satisfy
// this contract.  The MCP tool layer and all callers reference ONLY this
// interface — never a concrete adapter class.

export interface DataAdapter {
  /** Initialise the backend (open connections, run migrations, etc.) */
  connect(): Promise<void>;

  /** Tear down the backend gracefully */
  disconnect(): Promise<void>;

  /**
   * Create a new collection (table/namespace).
   * Must be idempotent — calling it twice with the same name is a no-op.
   *
   * @param name      Collection name.  Letters, numbers, underscores only.
   * @param schemaHint  Optional hint the LLM provides about field names/types.
   *                    Adapters that support typed columns may use this to
   *                    pre-create columns; JSONB/document adapters can ignore it.
   */
  createCollection(name: string, schemaHint?: Record<string, string>): Promise<void>;

  /**
   * Insert a record.  The adapter assigns a UUID `id` and sets
   * `createdAt` / `updatedAt` timestamps automatically.
   *
   * @returns The generated record id.
   */
  insert(collection: string, data: Record<string, unknown>): Promise<string>;

  /**
   * Query records from a collection with structured filters.
   * Never accepts raw SQL — the QueryFilter type is backend-agnostic.
   */
  query(collection: string, filter: QueryFilter): Promise<StoredRecord[]>;

  /** Update a record in-place (partial patch — only supplied fields change). */
  update(collection: string, id: string, patch: Record<string, unknown>): Promise<void>;

  /** Hard-delete a record by id. */
  delete(collection: string, id: string): Promise<void>;

  /** List the names of all existing collections. */
  listCollections(): Promise<string[]>;

  /**
   * Return a description of the schema for a collection.
   * For JSONB/document adapters this returns a best-effort shape inferred
   * from the stored data rather than a formal DDL schema.
   */
  getSchema(collection: string): Promise<Record<string, string>>;
}
