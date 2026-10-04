import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./phase-complete.txt"

const PHASES = ["recon", "hypothesis", "testing", "reporting"] as const

const SELF_CHECK_QUESTIONS: Record<string, string[]> = {
  recon: [
    "Which discovery methods ran against this asset (subdomain, content, JS, API enum)?",
    "What surface types could still hide here that I have not looked at?",
    "What would prove my asset inventory incomplete?",
  ],
  hypothesis: [
    "Which vuln classes did I consider and which did I rule out without testing — why?",
    "What assumption in my leading hypothesis, if wrong, changes the conclusion?",
    "What evidence would force me to reopen a closed hypothesis?",
  ],
  testing: [
    "For each hypothesis: what exactly was tried, with what tool, and what was observed?",
    "Which negative results did I confirm versus merely fail to reproduce?",
    "What deeper variant (auth context, timing, encoding, chaining) remains untried?",
  ],
  reporting: [
    "Is every claim backed by captured evidence, not memory?",
    "Can a reader reproduce this from the evidence refs alone?",
    "Did human review actually happen before marking reported?",
  ],
}

export const Parameters = Schema.Struct({
  programId: Schema.String,
  host: Schema.String.annotate({ description: "Asset this phase closure applies to" }),
  phase: Schema.Literals(["recon", "hypothesis", "testing", "reporting"]),
  evidence: Schema.Array(Schema.String).annotate({
    description: "References to tool outputs backing this closure: runIds, flow ids, finding ids, screenshots",
  }),
  selfCheck: Schema.String.annotate({
    description: "Written answers to the phase self-check questions: what was tried, what remains, what would prove you wrong. Min 60 chars.",
  }),
})

type Metadata = { host: unknown; phase: unknown }

export const PhaseCompleteTool = Tool.define<typeof Parameters, Metadata, never>(
  "phase_complete",
  Effect.gen(function* () {
    return {
      description:
        DESCRIPTION +
        " Self-check questions per phase: " +
        PHASES.map((p) => `${p}: ${SELF_CHECK_QUESTIONS[p].join(" / ")}`).join(" | "),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "phase_complete", patterns: ["*"], always: ["*"], metadata: {} })
          if (!params.host.trim()) throw new Error("host must be non-empty")
          if (params.evidence.length === 0) throw new Error("evidence must reference at least one tool output")
          if (params.selfCheck.trim().length < 60)
            throw new Error("selfCheck must answer the phase questions in >= 60 chars — no hand-waving closures")
          return {
            title: `${params.phase} complete: ${params.host}`,
            output: JSON.stringify({
              programId: params.programId,
              host: params.host,
              phase: params.phase,
              evidence: params.evidence,
              selfCheck: params.selfCheck,
            }),
            metadata: { host: params.host, phase: params.phase },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
