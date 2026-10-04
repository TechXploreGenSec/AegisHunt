import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./scope-set.txt"
import { setScopeConfig, scopeFilePath, currentScopeFile } from "./scope-gate"

export const Parameters = Schema.Struct({
  programId: Schema.String.annotate({ description: "Program/engagement id, e.g. bb-acme-2026-09-30" }),
  inScope: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "In-scope patterns, e.g. ['*.example.com', 'api.example.com']. Must be non-empty.",
  }),
  outOfScope: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Explicit exclusions, always win over inScope",
  }),
  allowedTestTypes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "e.g. ['active-recon', 'interaction']. Interaction-tier tools require 'interaction'.",
  }),
  maxRequestsPerSecond: Schema.Number.annotate({ description: "Program rate budget, divided per lane" }),
  executionMode: Schema.optional(Schema.Literals(["local", "gh-runner", "auto"])),
})

type Metadata = { programId: unknown; scopeFile: unknown }

export const ScopeSetTool = Tool.define<typeof Parameters, Metadata, never>(
  "scope_set",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "scope",
            patterns: ["*"],
            always: ["*"],
            metadata: { programId: params.programId },
          })
          if (!params.programId.trim()) throw new Error("programId must be non-empty")
          if (!params.inScope.length) throw new Error("inScope must be non-empty — fail-closed")
          if (!(params.maxRequestsPerSecond > 0)) throw new Error("maxRequestsPerSecond must be positive")
          const scope = setScopeConfig({
            programId: params.programId,
            inScope: params.inScope,
            outOfScope: params.outOfScope ?? [],
            allowedTestTypes: params.allowedTestTypes ?? [],
            maxRequestsPerSecond: params.maxRequestsPerSecond,
            executionMode: params.executionMode ?? "local",
          })
          const file = scopeFilePath(params.programId)
          yield* Effect.promise(async () => {
            const { mkdir, writeFile } = await import("node:fs/promises")
            const { dirname } = await import("node:path")
            await mkdir(dirname(file), { recursive: true })
            const body = JSON.stringify(scope, null, 2)
            await writeFile(file, body, "utf-8")
            await writeFile(currentScopeFile(), body, "utf-8")
          })
          return {
            title: `scope ${params.programId}`,
            output: JSON.stringify({
              programId: scope.programId,
              inScope: scope.inScope,
              outOfScope: scope.outOfScope,
              maxRequestsPerSecond: scope.maxRequestsPerSecond,
              executionMode: scope.executionMode,
              scopeFile: file,
            }),
            metadata: { programId: scope.programId, scopeFile: file },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
