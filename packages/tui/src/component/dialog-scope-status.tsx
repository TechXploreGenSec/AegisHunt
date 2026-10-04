import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { For, Show, createMemo } from "solid-js"

export type DialogScopeStatusProps = {}

export function DialogScopeStatus() {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()

  const scopes = createMemo(() => Object.values(sync.data.scope))
  const blockedTasks = createMemo(() =>
    Object.values(sync.data.agent_task)
      .flat()
      .filter((t) => t.status === "blocked"),
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Scope Status
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show
        when={scopes().length > 0}
        fallback={<text fg={theme.textMuted}>No scope loaded — testing tools will refuse to run</text>}
      >
        <For each={scopes()}>
          {(s) => (
            <box>
              <text fg={theme.text}>Program: {s.programId}</text>
              <text fg={theme.textMuted}>
                {s.inScope.length} in-scope pattern{s.inScope.length === 1 ? "" : "s"}, {s.maxRequestsPerSecond}{" "}
                req/s budget
              </text>
              <text fg={theme.textMuted}>Mode: {s.executionMode}</text>
            </box>
          )}
        </For>
      </Show>

      <box paddingTop={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Pending replies ({blockedTasks().length})
        </text>
        <Show
          when={blockedTasks().length > 0}
          fallback={<text fg={theme.textMuted}>Nothing waiting on you right now</text>}
        >
          <For each={blockedTasks()}>
            {(task) => (
              <box flexDirection="row" gap={1}>
                <text fg={task.blocking ? theme.error : theme.textMuted} flexShrink={0}>
                  [{task.correlationCode}]
                </text>
                <text fg={theme.text}>{task.question}</text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </box>
  )
}
