import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./todo-honesty-check.txt"
import { Todo } from "../session/todo"
import { runReadEffect } from "./graph-db"

export const Parameters = Schema.Struct({})

type Metadata = { verified: unknown; unverified: unknown }

export const TodoHonestyCheckTool = Tool.define<typeof Parameters, Metadata, Todo.Service>(
  "todo_honesty_check",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "todo_coverage", patterns: ["*"], always: ["*"], metadata: {} })
          const list = yield* todo.get(ctx.sessionID)
          const done = list.filter((t) => t.status === "completed")
          const unverified: string[] = []
          let verified = 0
          for (const item of done) {
            const content = String(item.content ?? "")
            const sep = content.indexOf(": ")
            if (sep < 0) {
              unverified.push(`${content} (unparseable — must be "{vulnClass}: {endpointKey}")`)
              continue
            }
            const vulnClass = content.slice(0, sep).trim()
            const endpointKey = content.slice(sep + 2).trim()
            const rows = yield* runReadEffect(
              `MATCH (e:Endpoint {id: $key})
               OPTIONAL MATCH (e)-[:SUGGESTS]->(h:Hypothesis {vuln_class: $vc})-[:TESTED_BY]->(t:TestExecution)
               WHERE t IS NULL OR t.outcome IN ['confirmed', 'ruled_out']
               RETURN e.blocked_reason AS blocked, count(t) AS tests`,
              { key: endpointKey, vc: vulnClass },
            )
            const row = (rows[0] ?? {}) as Record<string, unknown>
            const tests = typeof row["tests"] === "number" ? row["tests"] : 0
            if (row["blocked"] || tests > 0) verified++
            else unverified.push(`${content} (no recorded test or blocker in graph)`)
          }
          if (unverified.length > 0) {
            const shown = unverified.slice(0, 10).join("; ")
            const more = unverified.length > 10 ? ` (+${unverified.length - 10} more)` : ""
            throw new Error(
              `${unverified.length}/${done.length} completed todos have NO matching graph outcome: ${shown}${more}. ` +
                `Unmark them (or do the work: test, then test_execution_record — or asset_mark_blocker with what was tried).`,
            )
          }
          return {
            title: `${verified} todos verified`,
            output: JSON.stringify({ verified, unverified: 0, checked: done.length }),
            metadata: { verified, unverified: 0 },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
