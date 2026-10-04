import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { terminalRunAndCapture } from "./terminalCapture";
import {
  browserCaptureScreenshot,
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

const browserActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: z.string().url() }),
  z.object({ kind: z.literal("click"), selector: z.string().min(1) }),
  z.object({
    kind: z.literal("type"),
    selector: z.string().min(1),
    text: z.string(),
    typing_speed_wpm: z.number().int().min(20).max(180).optional(),
  }),
  z.object({ kind: z.literal("fill"), selector: z.string().min(1), text: z.string() }),
  z.object({
    kind: z.literal("wait_for_selector"),
    selector: z.string().min(1),
    timeout_ms: z.number().int().min(100).max(120_000).optional(),
  }),
  z.object({
    kind: z.literal("highlight"),
    selector: z.string().min(1),
    duration_ms: z.number().int().min(0).max(120_000).optional(),
  }),
  z.object({ kind: z.literal("wait"), duration_ms: z.number().int().min(0).max(120_000) }),
]);

const terminalActionSchema = z.object({
  kind: z.literal("run_command"),
  command: z.string().min(1),
});

const sceneSchema = z.discriminatedUnion("type", [
  z.object({
    order: z.number().int(),
    type: z.literal("terminal"),
    caption: z.string().optional(),
    actions: z.array(terminalActionSchema).min(1),
    capture: z.enum(["video", "screenshot"]),
    min_duration_ms: z.number().int().min(0).max(120_000).optional(),
    typing_speed_wpm: z.number().int().min(20).max(180).optional(),
    timeout_ms: z.number().int().min(250).max(120_000).optional(),
  }),
  z.object({
    order: z.number().int(),
    type: z.literal("browser"),
    caption: z.string().optional(),
    actions: z.array(browserActionSchema).min(1),
    capture: z.enum(["video", "screenshot"]),
    min_duration_ms: z.number().int().min(0).max(120_000).optional(),
  }),
]);

export const scenePlanSchema = z.object({
  title: z.string().min(1),
  output: z.object({
    format: z.literal("mp4"),
    path: z.string().min(1).optional(),
  }),
  scenes: z.array(sceneSchema).min(1),
  transitions: z
    .object({
      type: z.enum(["cut", "crossfade"]).default("cut"),
      duration_ms: z.number().int().min(0).max(5000).default(400),
    })
    .optional(),
  disclose_automated: z.boolean().default(false),
});

export type ScenePlan = z.infer<typeof scenePlanSchema>;

function sceneOutputPath(outputDir: string, plan: ScenePlan): string {
  if (!plan.output.path) return path.join(outputDir, "poc-output.mp4");
  return path.isAbsolute(plan.output.path)
    ? plan.output.path
    : path.resolve(process.cwd(), plan.output.path);
}

export async function runScenePlan(
  input: unknown,
  outputDir: string,
): Promise<{ path: string; title: string; scenes: ComposeClip[] }> {
  const plan = scenePlanSchema.parse(input);
  const clips: ComposeClip[] = [];
  for (const scene of [...plan.scenes].sort((a, b) => a.order - b.order)) {
    const sceneId = `scene-${scene.order}-${randomUUID()}`;
    if (scene.type === "terminal") {
      if (scene.capture === "screenshot") {
        const firstCommand = scene.actions[0];
        const result = await terminalRunAndCapture({
          command: firstCommand.command,
          format: "png",
          typingSpeedWpm: scene.typing_speed_wpm ?? 55,
          timeoutMs: scene.timeout_ms ?? 30_000,
          outputDir,
        });
        clips.push({
          path: result.path,
          caption: scene.caption,
          order: scene.order,
          duration_ms: scene.min_duration_ms,
        });
      } else {
        const session = await startTerminalScene(
          sceneId,
          scene.actions as TerminalSceneAction[],
          scene.typing_speed_wpm ?? 55,
          scene.timeout_ms ?? 30_000,
          outputDir,
        );
        if (scene.min_duration_ms) await new Promise((resolve) => setTimeout(resolve, scene.min_duration_ms));
        const result = await stopTerminalScene(session);
        clips.push({ path: result.path, caption: scene.caption, order: scene.order });
      }
    } else if (scene.capture === "screenshot") {
      const result = await browserCaptureScreenshot(
        scene.actions as BrowserAction[],
        outputDir,
      );
      clips.push({
        path: result.path,
        caption: scene.caption,
        order: scene.order,
        duration_ms: scene.min_duration_ms,
      });
    } else {
      const session = await startBrowserScene(
        sceneId,
        scene.actions as BrowserAction[],
        outputDir,
      );
      if (scene.min_duration_ms) await new Promise((resolve) => setTimeout(resolve, scene.min_duration_ms));
      const result = await stopBrowserScene(session);
      clips.push({ path: result.path, caption: scene.caption, order: scene.order });
    }
  }
  const outputPath = sceneOutputPath(outputDir, plan);
  const composed = await composePocVideo(clips, outputPath);
  return { path: composed.path, title: plan.title, scenes: clips };
}