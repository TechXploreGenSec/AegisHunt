import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { terminalRunAndCapture } from "./terminalCapture";

export interface TerminalSceneAction {
  kind: "run_command";
  command: string;
}

export interface TerminalSceneSession {
  sceneId: string;
  context: BrowserContext;
  page: Page;
  videoPath: Promise<string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          html, body { margin: 0; width: 100%; height: 100%; background: #101114; }
          body { color: #f2f4f8; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
          main { box-sizing: border-box; min-height: 100%; padding: 48px 42px; }
          .chrome { display: flex; gap: 9px; margin-bottom: 26px; }
          .dot { width: 13px; height: 13px; border-radius: 50%; }
          .red { background: #ff5f57; } .yellow { background: #febc2e; } .green { background: #28c840; }
          #terminal { white-space: pre-wrap; line-height: 1.5; }
          .prompt { color: #7ee787; } .command { color: #f2f4f8; }
          .output { color: #d6dae3; }
          .cursor { display: inline-block; width: 10px; height: 1.1em; background: #f2f4f8; vertical-align: -0.18em; margin-left: 5px; }
        </style>
      </head>
      <body><main><div class="chrome"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></div><div id="terminal"></div></main></body>
    </html>
  `);
  return page;
}

export async function startTerminalScene(
  sceneId: string,
  actions: TerminalSceneAction[],
  typingSpeedWpm: number,
  timeoutMs: number,
  outputDir: string,
): Promise<TerminalSceneSession> {
  await mkdir(outputDir, { recursive: true });
  const context = await chromium.launchPersistentContext(
    path.join(outputDir, `.terminal-profile-${randomUUID()}`),
    {
      headless: true,
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
    },
  );
  const page = await createPage(context);
  const video = page.video();
  if (!video) {
    await context.close();
    throw new Error("Playwright did not create a video recorder for the terminal scene.");
  }

  const videoPath = video.path();
  let terminalText = "";
  for (const action of actions) {
    terminalText += `${terminalText ? "\n" : ""}capture@local:~$ ${action.command}\n`;
    await page.locator("#terminal").evaluate((element, text) => {
      element.textContent = text;
    }, terminalText);
    await page.locator("#terminal").pressSequentially("", { delay: 0 });
    await sleep(Math.max(250, 60000 / (typingSpeedWpm * 5) * action.command.length));
    const result = await terminalRunAndCapture({
      command: action.command,
      format: "png",
      typingSpeedWpm,
      timeoutMs,
      outputDir,
    });
    terminalText += `${result.output.trimEnd()}\n`;
    await page.locator("#terminal").evaluate((element, text) => {
      element.textContent = text;
    }, terminalText);
    await sleep(350);
  }
  return { sceneId, context, page, videoPath };
}

export async function stopTerminalScene(
  session: TerminalSceneSession,
): Promise<{ sceneId: string; path: string }> {
  await session.context.close();
  return { sceneId: session.sceneId, path: await session.videoPath };
}