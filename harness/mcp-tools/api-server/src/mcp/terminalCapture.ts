import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node-pty";
import { chromium } from "playwright";

export type TerminalCaptureFormat = "png";

export interface TerminalCaptureOptions {
  command: string;
  format: TerminalCaptureFormat;
  typingSpeedWpm: number;
  timeoutMs: number;
  outputDir: string;
}

export interface TerminalCaptureResult {
  path: string;
  format: TerminalCaptureFormat;
  command: string;
  exitCode: number;
  durationMs: number;
  output: string;
}

const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 32;

function shellPath(): string {
  return process.env["SHELL"] || (process.platform === "win32" ? "powershell.exe" : "/bin/sh");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runInPty(
  command: string,
  timeoutMs: number,
): Promise<{ output: string; exitCode: number }> {
  const pty = spawn(shellPath(), process.platform === "win32" ? [] : ["-lc", command], {
    name: "xterm-color",
    cols: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    cwd: process.cwd(),
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
    encoding: "utf8",
  });

  let output = "";
  let settled = false;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        pty.kill("SIGTERM");
        reject(new Error(`Command timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);

    pty.onData((data) => {
      output += data;
    });

    pty.onExit(({ exitCode }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output, exitCode });
    });
  });
}

function stripTerminalControlCodes(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function renderTerminalPage(
  command: string,
  output: string,
  typingSpeedWpm: number,
  exitCode: number,
  outputDir: string,
): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const cleanOutput = stripTerminalControlCodes(output).trimEnd() || "(no output)";
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            html, body { margin: 0; width: 100%; height: 100%; background: #101114; }
            body { color: #f2f4f8; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
            .window { box-sizing: border-box; height: 100%; padding: 48px 42px; }
            .chrome { display: flex; gap: 9px; margin-bottom: 26px; }
            .dot { width: 13px; height: 13px; border-radius: 50%; }
            .red { background: #ff5f57; } .yellow { background: #febc2e; } .green { background: #28c840; }
            .prompt { color: #7ee787; } .command { color: #f2f4f8; }
            .output { white-space: pre-wrap; line-height: 1.5; margin-top: 14px; color: #d6dae3; }
            .status { margin-top: 20px; color: ${exitCode === 0 ? "#7ee787" : "#ff7b72"}; }
            .cursor { display: inline-block; width: 10px; height: 1.1em; background: #f2f4f8; vertical-align: -0.18em; margin-left: 5px; animation: blink 1s steps(2, start) infinite; }
            @keyframes blink { 50% { opacity: 0; } }
          </style>
        </head>
        <body>
          <main class="window">
            <div class="chrome"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></div>
            <div><span class="prompt">capture@local:~$ </span><span id="command" class="command"></span><span class="cursor"></span></div>
            <pre class="output">${escapeHtml(cleanOutput)}</pre>
            <div class="status">${exitCode === 0 ? "Process exited successfully." : `Process exited with code ${exitCode}.`}</div>
          </main>
        </body>
      </html>
    `);

    const perCharacterMs = Math.max(8, 60000 / (typingSpeedWpm * 5));
    await page.locator("#command").pressSequentially(command, {
      delay: perCharacterMs,
    });
    await sleep(300);

    const outputPath = path.join(outputDir, `terminal-${Date.now()}-${randomUUID()}.png`);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: true });
    return outputPath;
  } finally {
    await browser.close();
  }
}

export async function terminalRunAndCapture(
  options: TerminalCaptureOptions,
): Promise<TerminalCaptureResult> {
  if (!options.command.trim()) {
    throw new Error("command must not be empty.");
  }

  const startedAt = Date.now();
  await mkdir(options.outputDir, { recursive: true });
  const { output, exitCode } = await runInPty(options.command, options.timeoutMs);
  const outputPath = await renderTerminalPage(
    options.command,
    output,
    options.typingSpeedWpm,
    exitCode,
    options.outputDir,
  );

  return {
    path: outputPath,
    format: options.format,
    command: options.command,
    exitCode,
    durationMs: Date.now() - startedAt,
    output: stripTerminalControlCodes(output),
  };
}

export async function removeCapture(pathToRemove: string): Promise<void> {
  await rm(pathToRemove, { force: true });
}

export async function readCapture(pathToRead: string): Promise<Buffer> {
  return readFile(pathToRead);
}