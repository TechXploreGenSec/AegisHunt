import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertInside, getReportRoot, sanitizeSegment } from "./storage.js";
import type { PdfStyle } from "./types.js";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_TOP = PAGE_HEIGHT - 72;
const CONTENT_BOTTOM = 58;

export async function renderPdf(
  markdown: string,
  style: PdfStyle = "plain",
  findingId = "rendered-report",
): Promise<{ pdf_path: string; pages: number; bytes: number; style: PdfStyle }> {
  validatePdfInput(markdown);
  const safeId = sanitizeSegment(findingId);
  const digest = createHash("sha256").update(markdown).digest("hex").slice(0, 12);
  const root = getReportRoot();
  const pdfPath = join(root, `${safeId}-${digest}.pdf`);
  assertInside(root, pdfPath);
  const document = buildPdf(markdown, style);
  await mkdir(root, { recursive: true });
  await writeFile(pdfPath, document.buffer);
  return { pdf_path: pdfPath, pages: document.pages, bytes: document.buffer.length, style };
}

function validatePdfInput(markdown: string): void {
  if (!markdown.trim()) {
    throw new Error("Cannot render an empty report.");
  }
  if (/\{\{[a-z_]+\}\}/u.test(markdown)) {
    throw new Error("Cannot render a report with unfilled template placeholders.");
  }
}

function buildPdf(markdown: string, style: PdfStyle): { buffer: Buffer; pages: number } {
  const lines = markdownToLines(markdown);
  const pageContents: string[][] = [];
  let current: string[] = [];
  let y = CONTENT_TOP;
  let pageNumber = 1;

  const startPage = () => {
    current = [];
    y = CONTENT_TOP;
    drawPageHeader(current, style, pageNumber);
  };
  const finishPage = () => {
    drawPageFooter(current, pageNumber);
    pageContents.push(current);
    pageNumber += 1;
  };

  startPage();
  for (const line of lines) {
    const lineHeight = line.kind === "heading" ? 23 : line.kind === "title" ? 30 : 15;
    if (y - lineHeight < CONTENT_BOTTOM) {
      finishPage();
      startPage();
    }
    drawLine(current, line, y, style);
    y -= lineHeight;
  }
  finishPage();

  const pages = pageContents.map((content) => content.join("\n"));
  const buffer = serializePdf(pages);
  return { buffer, pages: pages.length };
}

type RenderLine = {
  text: string;
  kind: "title" | "heading" | "body" | "bullet" | "code";
};

function markdownToLines(markdown: string): RenderLine[] {
  const result: RenderLine[] = [];
  let inCode = false;
  for (const raw of markdown.replace(/\r\n?/gu, "\n").split("\n")) {
    if (/^```/u.test(raw.trim())) {
      inCode = !inCode;
      continue;
    }
    if (!raw.trim()) {
      result.push({ text: "", kind: "body" });
      continue;
    }

    const heading = raw.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      const kind = heading[1].length === 1 ? "title" : "heading";
      result.push(...wrapLine(stripMarkdown(heading[2]), kind));
      continue;
    }
    const bullet = raw.match(/^\s*[-*]\s+(.+)$/u);
    if (bullet) {
      result.push(...wrapLine(`• ${stripMarkdown(bullet[1])}`, "bullet"));
      continue;
    }
    const ordered = raw.match(/^\s*(\d+)\.\s+(.+)$/u);
    if (ordered) {
      result.push(...wrapLine(`${ordered[1]}. ${stripMarkdown(ordered[2])}`, "bullet"));
      continue;
    }
    result.push(...wrapLine(stripMarkdown(raw), inCode ? "code" : "body"));
  }
  return result;
}

function wrapLine(value: string, kind: RenderLine["kind"]): RenderLine[] {
  const maxCharacters = kind === "title" ? 52 : kind === "heading" ? 68 : kind === "code" ? 92 : 96;
  const words = value.split(/\s+/u);
  const lines: RenderLine[] = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxCharacters) {
      lines.push({ text: current, kind });
      current = word;
    } else {
      current = next;
    }
  }
  if (current || !lines.length) lines.push({ text: current, kind });
  return lines;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/gu, "[$1: $2]")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1 ($2)")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/[*_~]/gu, "");
}

function drawPageHeader(content: string[], style: PdfStyle, pageNumber: number): void {
  const accent = style === "platform" ? "0.91 0.46 0.15" : "0.15 0.39 0.75";
  content.push(`${accent} rg`);
  content.push(`0 ${PAGE_HEIGHT - 42} ${PAGE_WIDTH} 42 re f`);
  content.push("0.1 0.1 0.1 rg");
  content.push(textCommand("Bug Bounty Report", MARGIN, PAGE_HEIGHT - 28, 9, "F1"));
  content.push(textCommand(`Page ${pageNumber}`, PAGE_WIDTH - MARGIN - 42, PAGE_HEIGHT - 28, 8, "F1"));
}

function drawPageFooter(content: string[], pageNumber: number): void {
  content.push("0.55 0.55 0.55 rg");
  content.push(textCommand("Prepared locally • Verify platform requirements before submission", MARGIN, 30, 7, "F1"));
  content.push(textCommand(String(pageNumber), PAGE_WIDTH - MARGIN, 30, 7, "F1", "right"));
}

function drawLine(content: string[], line: RenderLine, y: number, style: PdfStyle): void {
  if (!line.text) return;
  const x = line.kind === "bullet" ? MARGIN + 10 : MARGIN;
  if (line.kind === "title") {
    content.push(style === "platform" ? "0.91 0.46 0.15 rg" : "0.15 0.39 0.75 rg");
    content.push(textCommand(line.text, x, y, 18, "F2"));
    return;
  }
  if (line.kind === "heading") {
    content.push(style === "platform" ? "0.73 0.31 0.08 rg" : "0.08 0.25 0.50 rg");
    content.push(textCommand(line.text, x, y, 12, "F2"));
    return;
  }
  content.push("0.12 0.12 0.12 rg");
  content.push(textCommand(line.text, x, y, line.kind === "code" ? 8 : 9.5, line.kind === "code" ? "F3" : "F1"));
}

function textCommand(
  value: string,
  x: number,
  y: number,
  size: number,
  font: "F1" | "F2" | "F3",
  align: "left" | "right" = "left",
): string {
  const escaped = pdfEscape(value);
  const adjustedX = align === "right" ? x - value.length * size * 0.48 : x;
  return `BT /${font} ${size} Tf 1 0 0 1 ${adjustedX.toFixed(2)} ${y.toFixed(2)} Tm (${escaped}) Tj ET`;
}

function pdfEscape(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/gu, "?")
    .replace(/\\/gu, "\\\\")
    .replace(/\(/gu, "\\(")
    .replace(/\)/gu, "\\)");
}

function serializePdf(pageContents: string[]): Buffer {
  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontRegularId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const fontMonoId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const pageIds: number[] = [];

  for (const content of pageContents) {
    const stream = `${content}\n`;
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R /F3 ${fontMonoId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let output = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index++) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}