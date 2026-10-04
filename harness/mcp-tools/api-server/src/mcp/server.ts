import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  terminalRunAndCapture,
  type TerminalCaptureFormat,
} from "./terminalCapture";
import {
  startBrowserScene,
  stopBrowserScene,
  type BrowserAction,
} from "./browserCapture";
import {
  startTerminalScene,
  stopTerminalScene,
  type TerminalSceneAction,
} from "./terminalScene";
import { composePocVideo, type ComposeClip } from "./compose";
import { runScenePlan, scenePlanSchema } from "./scenePlan";

const DEFAULT_OUTPUT_DIR = process.env["POC_OUTPUT_DIR"] || `${process.cwd()}/poc-output`;
const browserScenes = new Map<
  string,
  Awaited<ReturnType<typeof startBrowserScene>>
>();
const terminalScenes = new Map<
  string,
  Awaited<ReturnType<typeof startTerminalScene>>
>();

const terminalInput = {
  command: z.string().min(1).describe("The shell command to execute in a real pseudo-terminal."),
  format: z
    .enum(["png"])
    .default("png")
    .describe("The local capture format. PNG screenshots are supported in Phase 1."),
  typing_speed_wpm: z
    .number()
    .int()
    .min(20)
    .max(180)
    .default(55)
    .describe("Visible command typing speed in words per minute."),
  timeout_ms: z
    .number()
    .int()
    .min(250)
    .max(120_000)
    .default(30_000)
    .describe("Maximum time to allow the command to run."),
};

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "poc-capture-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  server.registerTool(
    "capture_status",
    {
      title: "Capture status",
      description:
        "Returns the local capabilities and output behavior of this POC capture server.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      outputSchema: {
        phase: z.string(),
        local_only: z.boolean(),
        supported_tools: z.array(z.string()),
      },
    },
    async () => {
      const result = {
        phase: "phase-4-scene-orchestration",
        local_only: true,
        supported_tools: [
          "capture_status",
          "terminal_run_and_capture",
          "terminal_scene_record_start",
          "terminal_scene_record_stop",
          "browser_scene_record_start",
          "browser_scene_record_stop",
          "compose_poc_video",
          "run_scene_plan",
        ],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "terminal_run_and_capture",
    {
      title: "Run terminal command and capture",
      description:
        "Runs one shell command in a real pseudo-terminal, renders the command and output in a local terminal-style browser page, and returns the local PNG path.",
      inputSchema: terminalInput,
      outputSchema: {
        path: z.string(),
        format: z.string(),
        command: z.string(),
        exit_code: z.number(),
        duration_ms: z.number(),
        output: z.string(),
      },
      annotations: {
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ command, format, typing_speed_wpm, timeout_ms }) => {
      const result = await terminalRunAndCapture({
        command,
        format: format as TerminalCaptureFormat,
        typingSpeedWpm: typing_speed_wpm,
        timeoutMs: timeout_ms,
        outputDir: DEFAULT_OUTPUT_DIR,
      });
      const structuredResult = {
        path: result.path,
        format: result.format,
        command: result.command,
        exit_code: result.exitCode,
        duration_ms: result.durationMs,
        output: result.output,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredResult, null, 2) }],
        structuredContent: structuredResult,
      };
    },
  );

  server.registerTool(
    "terminal_scene_record_start",
    {
      title: "Start terminal scene recording",
      description:
        "Starts a local video recording of one or more terminal commands. Call terminal_scene_record_stop with the returned scene_id to finalize the MP4.",
      inputSchema: {
        scene_id: z.string().min(1).optional(),
        actions: z
          .array(z.object({ kind: z.literal("run_command"), command: z.string().min(1) }))
          .min(1),
        typing_speed_wpm: terminalInput.typing_speed_wpm,
        timeout_ms: terminalInput.timeout_ms,
      },
      outputSchema: { scene_id: z.string(), status: z.string() },
    },
    async ({ scene_id, actions, typing_speed_wpm, timeout_ms }) => {
      const id = scene_id ?? `terminal-scene-${Date.now()}`;
      if (terminalScenes.has(id)) throw new Error(`Terminal scene "${id}" is already recording.`);
      const session = await startTerminalScene(
        id,
        actions as TerminalSceneAction[],
        typing_speed_wpm,
        timeout_ms,
        DEFAULT_OUTPUT_DIR,
      );
      terminalScenes.set(id, session);
      const result = { scene_id: id, status: "recording" };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "terminal_scene_record_stop",
    {
      title: "Stop terminal scene recording",
      description:
        "Stops a terminal scene, closes its Playwright video context, and returns the finalized local MP4 path.",
      inputSchema: { scene_id: z.string().min(1) },
      outputSchema: { scene_id: z.string(), path: z.string() },
    },
    async ({ scene_id }) => {
      const session = terminalScenes.get(scene_id);
      if (!session) throw new Error(`No terminal scene is recording for "${scene_id}".`);
      terminalScenes.delete(scene_id);
      const stopped = await stopTerminalScene(session);
      const result = { scene_id: stopped.sceneId, path: stopped.path };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "browser_scene_record_start",
    {
      title: "Start browser scene recording",
      description:
        "Executes browser navigation, click, type, wait, and highlight actions in a local Playwright video context.",
      inputSchema: {
        scene_id: z.string().min(1).optional(),
        actions: z.array(scenePlanSchema.shape.scenes.element.options[1].shape.actions.element).min(1),
      },
      outputSchema: { scene_id: z.string(), status: z.string() },
    },
    async ({ scene_id, actions }) => {
      const id = scene_id ?? `browser-scene-${Date.now()}`;
      if (browserScenes.has(id)) throw new Error(`Browser scene "${id}" is already recording.`);
      const session = await startBrowserScene(id, actions as BrowserAction[], DEFAULT_OUTPUT_DIR);
      browserScenes.set(id, session);
      const result = { scene_id: id, status: "recording" };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "browser_scene_record_stop",
    {
      title: "Stop browser scene recording",
      description:
        "Stops a browser scene, closes its Playwright video context, and returns the finalized local WebM path.",
      inputSchema: { scene_id: z.string().min(1) },
      outputSchema: { scene_id: z.string(), path: z.string() },
    },
    async ({ scene_id }) => {
      const session = browserScenes.get(scene_id);
      if (!session) throw new Error(`No browser scene is recording for "${scene_id}".`);
      browserScenes.delete(scene_id);
      const stopped = await stopBrowserScene(session);
      const result = { scene_id: stopped.sceneId, path: stopped.path };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "compose_poc_video",
    {
      title: "Compose POC video",
      description:
        "Composes local terminal/browser clips and screenshots in explicit order into one local MP4 with optional captions.",
      inputSchema: {
        clips: z
          .array(
            z.object({
              path: z.string().min(1),
              caption: z.string().optional(),
              order: z.number().int(),
              duration_ms: z.number().int().min(250).max(120_000).optional(),
            }),
          )
          .min(1),
        output_path: z.string().min(1).optional(),
      },
      outputSchema: { path: z.string(), clip_count: z.number() },
    },
    async ({ clips, output_path }) => {
      const outputPath = output_path ?? `${DEFAULT_OUTPUT_DIR}/poc-${Date.now()}.mp4`;
      const result = await composePocVideo(clips as ComposeClip[], outputPath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "run_scene_plan",
    {
      title: "Run scene plan",
      description:
        "Runs an ordered mix of terminal and browser scenes, then composes their local captures into one MP4.",
      inputSchema: {
        scene_plan: z
          .record(z.unknown())
          .describe("Scene Plan JSON with title, output, scenes, and optional disclosure settings."),
      },
      outputSchema: {
        path: z.string(),
        title: z.string(),
        scenes: z.array(
          z.object({
            path: z.string(),
            caption: z.string().optional(),
            order: z.number(),
            duration_ms: z.number().optional(),
          }),
        ),
      },
    },
    async ({ scene_plan }) => {
      const result = await runScenePlan(scene_plan, DEFAULT_OUTPUT_DIR);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  return server;
}