// ─── Shared domain types ────────────────────────────────────────────────────

export interface QueryFilter {
  /** Simple field-level conditions, e.g. { field: "status", op: "eq", value: "active" } */
  conditions?: Condition[];
  /** Full-text search string (applies to all text fields) */
  search?: string;
  /** Sort configuration */
  sort?: { field: string; direction: "asc" | "desc" };
  /** Maximum number of results (default 100, max 1000) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "in";

export interface Condition {
  field: string;
  op: FilterOperator;
  value: unknown;
}

export interface FileMeta {
  fileId: string;
  path: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface StoredRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface AuditEntry {
  id: string;
  ts: string;
  tool: string;
  collection?: string;
  recordId?: string;
  fileId?: string;
  summary: string;
}
