import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCvss } from "../src/cvss.js";
import { renderPdf } from "../src/pdf.js";
import { renderMarkdown } from "../src/renderMarkdown.js";
import { getTemplate } from "../src/templates/index.js";
import { validateFinding } from "../src/schema/validateFinding.js";
import type { Finding } from "../src/types.js";
import { validateReport } from "../src/validateReport.js";

const finding: Finding = {
  title: "Cross-account object access",
  target: "https://example.test/api/invoices/123",
  vulnerability_class: "IDOR",
  severity: "High",
  cvss_vector: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N",
  cvss_score: 8.1,
  summary: "An authenticated user can read another account's invoice.",
  steps_to_reproduce: ["Log in as account A.", "Request account B's invoice identifier."],
  proof_of_concept: {
    description: "The response contains account B's invoice data.",
    request: "GET /api/invoices/123 HTTP/1.1",
    response: "{\"owner\":\"account-b\"}",
  },
  impact: "Confidential invoice data is disclosed across tenant boundaries.",
  remediation: "Authorize the invoice owner before returning the object.",
  affected_users: "Any authenticated customer.",
  discovered_at: "2026-08-07T12:00:00.000Z",
};

test("validates the canonical finding shape", () => {
  assert.deepEqual(validateFinding(finding), { valid: true, errors: [] });
});

test("renders platform markdown without placeholders", () => {
  const template = getTemplate("bugcrowd");
  assert.ok(template);
  const markdown = renderMarkdown(finding, template);
  assert.match(markdown, /Business Impact/);
  assert.doesNotMatch(markdown, /\{\{/u);
  assert.equal(validateReport(markdown, template).valid, true);
});

test("calculates a CVSS 3.1 reference vector", () => {
  const result = calculateCvss("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
  assert.equal(result.score, 9.8);
  assert.equal(result.severity, "Critical");
});

test("rejects unfilled template placeholders", () => {
  const template = getTemplate("generic", "vdp");
  assert.ok(template);
  const result = validateReport("# Finding\n\n{{impact}}", template);
  assert.equal(result.valid, false);
  assert.ok(result.errors?.includes("Report contains unfilled template placeholders."));
});

test("renders a local PDF with a valid PDF signature", async () => {
  const template = getTemplate("generic", "vdp");
  assert.ok(template);
  const markdown = renderMarkdown(finding, template);
  const previousRoot = process.env["BUGBOUNTY_REPORT_ROOT"];
  process.env["BUGBOUNTY_REPORT_ROOT"] = ".tmp-bugbounty-pdf-test";
  try {
    const result = await renderPdf(markdown, "plain", "pdf-test");
    assert.ok(result.pages >= 1);
    assert.ok(result.bytes > 500);
    const { readFile } = await import("node:fs/promises");
    const pdf = await readFile(result.pdf_path);
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  } finally {
    if (previousRoot === undefined) delete process.env["BUGBOUNTY_REPORT_ROOT"];
    else process.env["BUGBOUNTY_REPORT_ROOT"] = previousRoot;
  }
});

test("renders every registered platform template", () => {
  for (const platform of [
    "bugcrowd",
    "hackerone",
    "intigriti",
    "yeswehack",
    "synack",
    "msrc",
    "google-vrp",
    "generic",
  ] as const) {
    const template = getTemplate(platform, platform === "generic" ? "vdp" : "generic");
    assert.ok(template, `missing ${platform} template`);
    const markdown = renderMarkdown(finding, template);
    assert.equal(validateReport(markdown, template).valid, true, platform);
  }
});