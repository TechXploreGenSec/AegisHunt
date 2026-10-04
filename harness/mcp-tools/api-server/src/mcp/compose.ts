import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export interface ComposeClip {
  path: string;
  caption?: string;
  order: number;
  duration_ms?: number;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env["FFMPEG_PATH"] || "ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function escapeFilterText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll(",", "\\,")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function escapeConcatPath(filePath: string): string {
  return filePath.replaceAll("'", "'\\''");
}

export async function composePocVideo(
  clips: ComposeClip[],
  outputPath: string,
): Promise<{ path: string; clip_count: number }> {
  if (clips.length === 0) throw new Error("At least one clip is required.");
  const sorted = [...clips].sort((a, b) => a.order - b.order);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "poc-capture-"));
  try {
    const normalizedPaths: string[] = [];
    for (const [index, clip] of sorted.entries()) {
      const normalizedPath = path.join(tempDir, `clip-${index}.mp4`);
      const caption = clip.caption?.trim();
      const captionFilter = caption
        ? `,drawtext=text='${escapeFilterText(caption)}':fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6:x=24:y=h-56`
        : "";
      const isImage = /\.(png|jpe?g|webp)$/i.test(clip.path);
      const args = ["-y"];
      if (isImage) {
        args.push("-loop", "1", "-i", clip.path, "-t", String((clip.duration_ms ?? 3000) / 1000));
      } else {
        args.push("-i", clip.path);
      }
      args.push(
        "-vf",
        `scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=black${captionFilter}`,
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-an",
        normalizedPath,
      );
      await runFfmpeg(args);
      normalizedPaths.push(normalizedPath);
    }

    const concatPath = path.join(tempDir, "concat.txt");
    await writeFile(
      concatPath,
      normalizedPaths.map((filePath) => `file '${escapeConcatPath(filePath)}'`).join("\n"),
      "utf8",
    );
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    return { path: outputPath, clip_count: sorted.length };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}