# POC Capture MCP

This package contains the local MCP server for capturing terminal and browser-based proof-of-concept scenes. The server communicates over MCP stdio and keeps all generated files on the local machine.

## Current tools

- `capture_status` — reports the current phase and available tools.
- `terminal_run_and_capture` — executes one shell command in a real pseudo-terminal, renders the command and output in a terminal-style Chromium page, and returns the local PNG path.
- `terminal_scene_record_start` / `terminal_scene_record_stop` — record one or more terminal commands to a local video.
- `browser_scene_record_start` / `browser_scene_record_stop` — run Playwright navigation, click, typing, wait, and highlight actions and return a local video.
- `compose_poc_video` — order local screenshots/videos, add captions, and compose a local MP4 with ffmpeg.
- `run_scene_plan` — execute the uploaded plan shape end to end and compose the result.

All capture outputs are local paths. Browser videos are finalized when the matching stop tool closes its Playwright context.

## Run locally

From the repository root:

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run mcp
```

The second command starts a long-lived stdio process for an MCP client. Do not print ordinary logs to stdout while it is running; stdout is reserved for MCP messages.

Generated captures are written to `artifacts/api-server/poc-output/` by default. Set `POC_OUTPUT_DIR` to choose another local directory:

```bash
POC_OUTPUT_DIR=/tmp/poc-captures pnpm --filter @workspace/api-server run mcp
```

## MCP client configuration

Point an MCP client at the repository root and use:

```json
{
  "command": "pnpm",
  "args": ["--filter", "@workspace/api-server", "run", "mcp"],
  "cwd": "/absolute/path/to/this/repository"
}
```

Build once before the client starts the process:

```bash
pnpm --filter @workspace/api-server run build
```

If the client supports an environment block, `POC_OUTPUT_DIR` can be set there to keep output in a client-specific folder.

## Safety boundary

`terminal_run_and_capture` deliberately executes the supplied command with the server process's local user permissions. Only connect trusted MCP clients and only call it with commands you intend to run. The server does not upload command output or images.