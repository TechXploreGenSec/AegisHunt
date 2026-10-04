import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type BrowserAction =
  | { kind: "navigate"; url: string }
  | { kind: "click"; selector: string }
  | { kind: "type"; selector: string; text: string; typing_speed_wpm?: number }
  | { kind: "fill"; selector: string; text: string }
  | { kind: "wait_for_selector"; selector: string; timeout_ms?: number }
  | { kind: "highlight"; selector: string; duration_ms?: number }
  | { kind: "wait"; duration_ms: number };

export interface BrowserSceneSession {
  sceneId: string;
  context: BrowserContext;
  page: Page;
  videoPath: Promise<string>;
}

let browserPromise: Promise<Browser> | undefined;

async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true });
  return browserPromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeCss(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

export async function executeBrowserActions(
  page: Page,
  actions: BrowserAction[],
): Promise<void> {
  for (const action of actions) {
    switch (action.kind) {
      case "navigate":
        await page.goto(action.url, { waitUntil: "domcontentloaded" });
        break;
      case "click":
        await page.locator(action.selector).click();
        break;
      case "type":
        await page.locator(action.selector).pressSequentially(action.text, {
          delay: Math.max(8, 60000 / ((action.typing_speed_wpm ?? 55) * 5)),
        });
        break;
      case "fill":
        await page.locator(action.selector).fill(action.text);
        break;
      case "wait_for_selector":
        await page.locator(action.selector).waitFor({
          state: "visible",
          timeout: action.timeout_ms ?? 30_000,
        });
        break;
      case "highlight": {
        const selector = escapeCss(action.selector);
        await page.locator(action.selector).evaluate((element, cssSelector) => {
          const node = element as {
            style: { outline: string; outlineOffset: string };
            setAttribute(name: string, value: string): void;
          };
          node.style.outline = "3px solid #fbbf24";
          node.style.outlineOffset = "4px";
          node.setAttribute("data-poc-highlight", cssSelector);
        }, selector);
        await sleep(action.duration_ms ?? 800);
        break;
      }
      case "wait":
        await sleep(action.duration_ms);
        break;
    }
  }
}

export async function startBrowserScene(
  sceneId: string,
  actions: BrowserAction[],
  outputDir: string,
): Promise<BrowserSceneSession> {
  await mkdir(outputDir, { recursive: true });
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const video = page.video();
  if (!video) {
    await context.close();
    throw new Error("Playwright did not create a video recorder for the browser scene.");
  }

  const videoPath = video.path();
  await executeBrowserActions(page, actions);
  return { sceneId, context, page, videoPath };
}

export async function stopBrowserScene(
  session: BrowserSceneSession,
): Promise<{ sceneId: string; path: string }> {
  await session.context.close();
  return { sceneId: session.sceneId, path: await session.videoPath };
}

export async function browserCaptureScreenshot(
  actions: BrowserAction[],
  outputDir: string,
): Promise<{ path: string }> {
  await mkdir(outputDir, { recursive: true });
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = await context.newPage();
    await executeBrowserActions(page, actions);
    const outputPath = path.join(outputDir, `browser-${Date.now()}-${randomUUID()}.png`);
    await page.screenshot({ path: outputPath, fullPage: true });
    return { path: outputPath };
  } finally {
    await context.close();
  }
}