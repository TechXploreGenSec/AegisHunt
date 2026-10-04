# AegisHunt — autonomous bug-bounty harness (opencode fork)

> **Version identifier: `1.18.33`** — every binary built from this repo is
> stamped `OPENCODE_VERSION=1.18.33`. The model/provider setup this harness
> runs against expects exactly this build; do not change the stamp without
> re-validating model access.

AegisHunt turns stock opencode into a scope-safe, evidence-gated,
never-stop bug-bounty agent: native graph-backed tools, permission-scoped
agents, mechanical enforcement (refusals, not suggestions), and Telegram
bot ops. The interactive TUI is stock upstream — the harness lives in
`packages/opencode/src/tool`, `src/agent`, and `src/session`.

## Layout

```
packages/opencode/src/tool/     40+ native tools (graph, findings, scope,
                                recon, browser, mitm, oob, telegram, bots,
                                asset progress, completion engine, audit)
packages/opencode/src/agent/    coordinator / recon / verification / reporting
                                (+ prompts with single-asset methodology)
packages/opencode/src/session/  idle watchdog (host-level resume, not a tool)
harness/agents/                 native agent definitions (orchestrator, bugbounty, …)
harness/skills/                 skill library (recon, methodology, reporting, …)
harness/scopes/                 engagement scope files (initial set)
harness/config/                 opencode.json + .env.bb.example (SECRETS REDACTED —
                                see harness/config/SECRETS.md), models.env, cli.json
harness/mcp-tools/              external MCP servers (gh-runner, memory, telegram
                                bots, report, poc-capture, man) + install.sh
```

## Enforcement model (why this isn't just prompts)

| Misbehavior | Mechanical control |
|---|---|
| curl-the-target instead of session tools | `target-guard` refuses shell/webfetch hitting loaded scope |
| Stopping to ask the operator | `question` denied at permission level; notify-and-continue only |
| Fabricated test results | `test_execution_record` requires a matching recent tool call (audit log) or OOB plant |
| Declaring "done" early | `endpoint_mark_assessed` refuses unless coverage score is complete |
| Stopping with work left | `bot_notify_hold` refuses unless queue empty + asset complete; idle watchdog resumes otherwise |
| 5-item summary plans | `asset_generate_test_plan` → bulk `todowrite` → `todo_coverage_check` gate |

## Get a working binary (CI)

Pushes to `main` and tags `v*` trigger `.github/workflows/build.yml`:
pinned `bun 1.3.14`, `bun install`, then the stamped build. Tagged builds
(`v1.18.33-bb.*`) attach the binary to a GitHub Release automatically.
No secrets are needed for the build.

## Run it (needs the secure bundle for secrets)

1. Take a Release binary **or** build locally: `bun install`, then
   `OPENCODE_VERSION=1.18.33 bun run --cwd packages/opencode build --single --skip-embed-web-ui`
2. Restore secrets per `harness/config/SECRETS.md` → `~/.config/opencode/`
3. Install MCP deps: `bash harness/mcp-tools/install.sh`
4. Provide scope via the `scope_set` tool (coordinator rule #1), or
   pre-seed `~/.config/opencode/scopes/`
5. Launch through an env-loading wrapper (sources `.env.bb` first) —
   never the bare binary, or `SUPABASE_*`/`NEO4J_*`/`TELEGRAM_*` are unset.

## Scope discipline

Scope checks are the authorization boundary and stay on. `*.sky.de` does
not match `mysky.de` (different root); bare `sky.de` doesn't cover
subdomains. `scope_set` loads the in-memory cache once per session —
until then, live-target tools correctly refuse.
