// Tool-call audit log — plain infrastructure, not a Tool. Every
// live-target tool calls recordToolCall() as its last step before
// returning, so test_execution_record can verify a claimed test is backed
// by a real, recent tool invocation against that exact target — instead
// of accepting the model's free-text word for it.
import { Database } from "bun:sqlite"

const DB_PATH = process.env.AUDIT_DB_PATH ?? "./tool_call_audit.db"

let db: Database | null = null

function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        program_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        target TEXT NOT NULL,
        hypothesis_id TEXT,
        called_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_target_time ON tool_calls(program_id, target, called_at);
      CREATE INDEX IF NOT EXISTS idx_hyp_time ON tool_calls(program_id, hypothesis_id, called_at);
    `)
  }
  return db
}

function hostOf(target: string): string {
  try {
    return new URL(target.includes("://") ? target : `https://${target}`).hostname.toLowerCase()
  } catch {
    return ""
  }
}

export function recordToolCall(programId: string, toolName: string, target: string, hypothesisId?: string): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO tool_calls (id, program_id, tool_name, target, hypothesis_id, called_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, programId, toolName, target, hypothesisId ?? null, Date.now())
  return id
}

export interface MatchingCall {
  id: string
  toolName: string
  calledAt: number
}

// Debug helper for the tool_call_audit_get tool (read-only).
export function recentToolCalls(
  programId: string,
  limit = 20,
  target?: string,
): Array<{ id: string; programId: string; toolName: string; target: string; hypothesisId: string | null; calledAt: number }> {
  const rows = target
    ? getDb()
        .prepare(
          `SELECT id, program_id, tool_name, target, hypothesis_id, called_at FROM tool_calls
           WHERE program_id = ? AND target = ? ORDER BY called_at DESC LIMIT ?`,
        )
        .all(programId, target, limit)
    : getDb()
        .prepare(
          `SELECT id, program_id, tool_name, target, hypothesis_id, called_at FROM tool_calls
           WHERE program_id = ? ORDER BY called_at DESC LIMIT ?`,
        )
        .all(programId, limit)
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r["id"]),
    programId: String(r["program_id"]),
    toolName: String(r["tool_name"]),
    target: String(r["target"]),
    hypothesisId: r["hypothesis_id"] === null ? null : String(r["hypothesis_id"]),
    calledAt: Number(r["called_at"]),
  }))
}

// A claim against targetUrl is backed if EITHER a recent call hit that
// exact URL (or its host — ffuf/browser land on hosts, replay/fuzz on
// exact flow URLs), OR a recent oob_plant_payload names the same
// hypothesis (blind vulns never touch the endpoint URL directly).
export function findMatchingToolCall(
  programId: string,
  targetUrl: string,
  hypothesisId?: string,
  maxAgeMinutes = 15,
): MatchingCall | null {
  const cutoff = Date.now() - maxAgeMinutes * 60 * 1000
  const database = getDb()
  if (hypothesisId) {
    const plant = database
      .prepare(
        `SELECT id, tool_name, called_at FROM tool_calls
         WHERE program_id = ? AND hypothesis_id = ? AND called_at >= ?
         ORDER BY called_at DESC LIMIT 1`,
      )
      .get(programId, hypothesisId, cutoff) as
      | { id: string; tool_name: string; called_at: number }
      | undefined
    if (plant) return { id: plant.id, toolName: plant.tool_name, calledAt: plant.called_at }
  }
  const wantHost = hostOf(targetUrl)
  const rows = database
    .prepare(
      `SELECT id, tool_name, target, called_at FROM tool_calls
       WHERE program_id = ? AND called_at >= ?
       ORDER BY called_at DESC LIMIT 50`,
    )
    .all(programId, cutoff) as Array<{ id: string; tool_name: string; target: string; called_at: number }>
  for (const row of rows) {
    if (row.target === targetUrl) return { id: row.id, toolName: row.tool_name, calledAt: row.called_at }
    const gotHost = hostOf(row.target)
    if (wantHost && gotHost && wantHost === gotHost)
      return { id: row.id, toolName: row.tool_name, calledAt: row.called_at }
  }
  return null
}
