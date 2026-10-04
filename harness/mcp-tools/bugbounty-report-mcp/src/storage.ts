import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

export function getReportRoot(): string {
  return resolve(process.env["BUGBOUNTY_REPORT_ROOT"] ?? ".bugbounty-reports");
}

export async function saveReport(
  findingId: string,
  markdown: string,
  pdfPath?: string,
): Promise<{ saved_path: string; pdf_path?: string }> {
  const root = getReportRoot();
  const safeId = sanitizeSegment(findingId);
  const reportPath = join(root, `${safeId}.md`);
  assertInside(root, reportPath);
  await mkdir(dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, markdown, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, reportPath);

  if (!pdfPath) {
    return { saved_path: reportPath };
  }
  const resolvedPdf = resolve(pdfPath);
  if (!isAbsolute(pdfPath) || !resolvedPdf.startsWith(`${root}${"/"}`)) {
    throw new Error("pdf_path must be an absolute path inside BUGBOUNTY_REPORT_ROOT.");
  }
  return { saved_path: reportPath, pdf_path: normalize(resolvedPdf) };
}

export function sanitizeSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/gu, "-");
  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error("finding_id must contain at least one safe filename character.");
  }
  return sanitized.slice(0, 120);
}

export function assertInside(root: string, target: string): void {
  const normalizedRoot = `${resolve(root)}${"/"}`;
  if (!resolve(target).startsWith(normalizedRoot)) {
    throw new Error("Report path escapes BUGBOUNTY_REPORT_ROOT.");
  }
}