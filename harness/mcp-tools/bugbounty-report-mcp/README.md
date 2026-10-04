# Bug Bounty Report Generator MCP

A local, deterministic MCP server that helps an MCP-compatible host draft,
validate, render, and save bug bounty reports. It does not submit reports,
discover vulnerabilities, or call an LLM.

## Run locally

```sh
pnpm --filter @workspace/bugbounty-report-mcp run build
pnpm --filter @workspace/bugbounty-report-mcp run test
pnpm --filter @workspace/bugbounty-report-mcp run dev
```

The `dev` command uses stdio and is intended to be launched by an MCP client.
For a packaged install, use `pnpm run build` and point the client's MCP
configuration at `dist/server.js`.

## MCP configuration

```json
{
  "mcpServers": {
    "bugbounty-report": {
      "command": "node",
      "args": ["/absolute/path/to/tools/bugbounty-report-mcp/dist/server.js"]
    }
  }
}
```

Set `BUGBOUNTY_REPORT_ROOT` to choose the local directory used by `save_report`
and `render_pdf`. Report contents are never logged by the server.

`render_pdf` writes a self-contained local PDF without requiring Pandoc,
WeasyPrint, LaTeX, or a bundled LLM. It supports `plain` and `platform` styles
and refuses empty reports or reports containing unfilled `{{placeholders}}`.

## Included templates

- Bugcrowd generic
- HackerOne generic
- Intigriti generic
- YesWeHack generic
- Synack generic
- Microsoft MSRC generic
- Google VRP generic
- Generic VDP

Template metadata includes a version and explicitly describes the intended
structure. Platform policies can change; this tool does not guarantee current
platform acceptance.

## Available MCP capabilities

### Tools

- `list_platforms`
- `get_template`
- `validate_finding`
- `validate_report`
- `render_markdown`
- `render_pdf`
- `calculate_cvss`
- `save_report`

### Resources and prompts

- `bugbounty://templates/<platform>/<variant>.md`
- `bugbounty://schemas/finding.schema.json`
- `generate_report`

The test suite includes deterministic core tests plus an MCP client test that
exercises stdio initialization, tool discovery, resource reads, prompt reads,
structured tool results, and invalid-input errors:

```sh
pnpm --filter @workspace/bugbounty-report-mcp run test
```