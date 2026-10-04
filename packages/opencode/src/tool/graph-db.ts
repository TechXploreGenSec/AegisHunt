// Shared Neo4j driver helper for adapted bug-bounty graph tools.
// Real opencode tools use Effect + Schema (see packages/opencode/src/tool/webfetch.ts).
// This helper keeps neo4j-driver as an OPTIONAL peer: no static import, so
// `bun typecheck` passes without the dep. Install with:
//   bun add neo4j-driver
// Required env: NEO4J_URI (default neo4j://localhost:7687), NEO4J_USER, NEO4J_PASSWORD
import { Effect } from "effect"

type DriverLike = {
  session: (config?: Record<string, unknown>) => {
    run: (cypher: string, params?: Record<string, unknown>) => Promise<{ records: Array<{ toObject: () => Record<string, unknown> }> }>
    close: () => Promise<void>
  }
  close: () => Promise<void>
}

let cached: DriverLike | null = null

export function getDriverEffect() {
  return Effect.promise(async () => {
    if (cached) return cached
    const uri = process.env.NEO4J_URI ?? "neo4j://localhost:7687"
    const user = process.env.NEO4J_USER ?? "neo4j"
    const pass = process.env.NEO4J_PASSWORD
    if (!pass) throw new Error("NEO4J_PASSWORD not set")
    const mod: unknown = await import("neo4j-driver").catch(() => null)
    if (!mod) throw new Error('neo4j-driver not installed — run "bun add neo4j-driver" in packages/opencode')
    const neo4j = (mod as { default: { driver: (uri: string, auth: unknown) => DriverLike; auth: { basic: (u: string, p: string) => unknown } } }).default
    cached = neo4j.driver(uri, neo4j.auth.basic(user, pass))
    return cached
  })
}

export function runWriteEffect(cypher: string, params: Record<string, unknown>) {
  return Effect.gen(function* () {
    const driver = yield* getDriverEffect()
    const db = process.env.NEO4J_DATABASE
    const session = db ? driver.session({ database: db }) : driver.session()
    try {
      const result = yield* Effect.promise(() => session.run(cypher, params))
      return result.records.map((r) => r.toObject())
    } finally {
      yield* Effect.promise(() => session.close())
    }
  })
}

export function runReadEffect(cypher: string, params: Record<string, unknown>) {
  return runWriteEffect(cypher, params)
}
