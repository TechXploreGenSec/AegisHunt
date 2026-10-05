import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./scope-set.txt"
import { setScopeConfig, scopeFilePath, currentScopeFile } from "./scope-gate"

export const Parameters = Schema.Struct({
  programId: Schema.String.annotate({ description: "Program/engagement id, e.g. bb-acme-2026-09-30" }),
  inScope: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "In-scope patterns, e.g. ['*.example.com', 'api.example.com']. May be empty — empty declares no boundary (unrestricted).",
  }),
  outOfScope: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Explicit exclusions, always win over inScope — honored even when unrestricted",
  }),
  allowedTestTypes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "e.g. ['active-recon', 'interaction']. Advisory only; undeclared types are logged, never refused.",
  }),
  maxRequestsPerSecond: Schema.Number.annotate({ description: "Program rate budget, divided per lane. Non-positive values fall back to 5." }),
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
          const rate = params.maxRequestsPerSecond > 0 ? params.maxRequestsPerSecond : 5
          const scope = setScopeConfig({
            programId: params.programId,
            inScope: params.inScope,
            outOfScope: params.outOfScope ?? [],
            allowedTestTypes: params.allowedTestTypes ?? [],
            maxRequestsPerSecond: rate,
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
              unrestricted: scope.unrestricted ?? false,
              scopeFile: file,
            }),
            metadata: { programId: scope.programId, scopeFile: file },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
