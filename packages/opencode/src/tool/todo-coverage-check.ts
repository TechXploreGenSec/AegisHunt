import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./todo-coverage-check.txt"
import { Todo } from "../session/todo"

export const Parameters = Schema.Struct({
  expectedMinimum: Schema.Number.annotate({
    description: "Minimum todowrite items required — set to asset_generate_test_plan's totalPlanItems",
  }),
})

type Metadata = { sufficient: unknown; current: unknown }

export const TodoCoverageCheckTool = Tool.define<typeof Parameters, Metadata, Todo.Service>(
  "todo_coverage_check",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "todo_coverage", patterns: ["*"], always: ["*"], metadata: {} })
          const list = yield* todo.get(ctx.sessionID)
          const current = list.length
          const sufficient = current >= params.expectedMinimum
          if (!sufficient) {
            throw new Error(
              `Only ${current} todos present, expected at least ${params.expectedMinimum} from the generated plan. ` +
                `The bulk todowrite call did not land — call todowrite ONCE with the full todos array built from every plan item, then retry this check.`,
            )
          }
          return {
            title: `${current} todos cover plan`,
            output: JSON.stringify({ sufficient: true, current, expectedMinimum: params.expectedMinimum }),
            metadata: { sufficient: true, current },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
