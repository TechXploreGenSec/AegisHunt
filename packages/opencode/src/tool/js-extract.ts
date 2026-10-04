import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { recordToolCall } from "./tool_call_audit"
import DESCRIPTION from "./js-extract.txt"
import { getLoadedScope, isInScope } from "./scope-gate"
import { runWriteEffect } from "./graph-db"

// High-recall, deliberately broad. False positives get filtered downstream
// by whatever actually tests them. Precision isn't extraction's job.
const ENDPOINT_PATTERNS = [
  /["'`](\/[a-zA-Z0-9_\-/]{2,}(?:\.[a-zA-Z]{2,4})?)["'`]/g,
  /["'`](https?:\/\/[a-zA-Z0-9.\-]+\/[a-zA-Z0-9_\-/]+)["'`]/g,
]

const SECRET_CANDIDATE_PATTERNS = [
  /["'`]?(?:api[_-]?key|apikey|secret|token|auth[_-]?key)["'`]?\s*[:=]\s*["'`]([a-zA-Z0-9_\-]{16,})["'`]/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
]

const ASSET_EXT = /\.(png|jpg|jpeg|svg|css|woff2?|ttf|map)$/i

export const Parameters = Schema.Struct({
  programId: Schema.String,
  jsUrl: Schema.String.annotate({ description: "Absolute URL of the JS bundle to fetch and mine" }),
})

type Metadata = { nodesWritten: unknown; edgesWritten: unknown; secretCandidates: unknown }

export const JsExtractTool = Tool.define<typeof Parameters, Metadata, never>(
  "js_extract_endpoints",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "content_discovery", patterns: [params.jsUrl], always: [], metadata: {} })
          const scope = getLoadedScope(params.programId)
          if (!isInScope(scope, params.jsUrl)) throw new Error(`Scope violation: ${params.jsUrl}`)
          const text = yield* Effect.promise(async () => {
            const res = await fetch(params.jsUrl)
            if (!res.ok) throw new Error(`JS fetch failed: ${res.status}`)
            return res.text()
          })
          const host = new URL(params.jsUrl).hostname
          const endpoints = new Set<string>()
          for (const pattern of ENDPOINT_PATTERNS) {
            for (const match of text.matchAll(pattern)) {
              const candidate = match[1]
              if (ASSET_EXT.test(candidate) || candidate.length < 3) continue
              endpoints.add(candidate)
            }
          }
          const secretCandidates = new Set<string>()
          for (const pattern of SECRET_CANDIDATE_PATTERNS) {
            for (const match of text.matchAll(pattern)) {
              secretCandidates.add(match[1] ?? match[0])
            }
          }
          yield* runWriteEffect(`MERGE (a:Asset {id: $host}) SET a.program_id = $programId RETURN a`, {
            host,
            programId: params.programId,
          })
          let nodesWritten = 1
          let edgesWritten = 0
          for (const endpoint of endpoints) {
            const endpointUrl = endpoint.startsWith("http") ? endpoint : `https://${host}${endpoint}`
            yield* runWriteEffect(
              `MERGE (e:Endpoint {id: $key}) SET e.url = $url, e.discovered_by = 'js_extraction', e.source_js = $jsUrl RETURN e`,
              { key: endpointUrl, url: endpointUrl, jsUrl: params.jsUrl },
            )
            nodesWritten++
            yield* runWriteEffect(
              `MATCH (a:Asset {id: $host}) MATCH (e:Endpoint {id: $key}) MERGE (a)-[r:EXPOSES]->(e) RETURN r`,
              { host, key: endpointUrl },
            )
            edgesWritten++
          }
          recordToolCall(params.programId, "js_extract_endpoints", params.jsUrl)
          return {
            title: `${endpoints.size} endpoints from JS`,
            output: JSON.stringify({
              endpointsFound: [...endpoints].slice(0, 50),
              secretCandidates: [...secretCandidates].slice(0, 20),
              note: "Secret shapes are CANDIDATES — confirm with a real scanner before trusting them.",
            }),
            metadata: { nodesWritten, edgesWritten, secretCandidates: [...secretCandidates] },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
