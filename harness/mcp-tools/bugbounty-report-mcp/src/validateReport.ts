import type { ReportTemplate, ValidationResult } from "./types.js";

export function validateReport(
  markdown: string,
  template: ReportTemplate,
): ValidationResult {
  const missing_fields = template.metadata.requiredSections.filter(
    (section) => !hasNonEmptySection(markdown, [section]),
  );
  const warnings: string[] = [];
  const errors: string[] = [];

  if (markdown.trim().length === 0) {
    errors.push("Report is empty.");
  }
  if (/\{\{[a-z_]+\}\}/u.test(markdown)) {
    errors.push("Report contains unfilled template placeholders.");
  }
  if (template.metadata.requiredFields.includes("severity") &&
      !/\b(?:Critical|High|Medium|Low|Info)\b/u.test(markdown)) {
    missing_fields.push("severity");
  }
  if (!/\b(?:CVSS|cvss)\b/u.test(markdown)) {
    warnings.push("CVSS information is not included.");
  }
  if (!template.metadata.requiredSections.some((section) =>
    /remediat|recommend|mitigat/iu.test(section) && hasNonEmptySection(markdown, [section]),
  )) {
    warnings.push("A remediation section is not included.");
  }

  return {
    valid: missing_fields.length === 0 && errors.length === 0,
    missing_fields: [...new Set(missing_fields)],
    warnings,
    ...(errors.length ? { errors } : {}),
  };
}

function hasNonEmptySection(markdown: string, titles: string[]): boolean {
  return titles.some((title) => {
    const section = getSection(markdown, title);
    return section !== undefined && section.trim().length > 0;
  });
}

function getSection(markdown: string, title: string): string | undefined {
  const escaped = escapeRegex(title);
  const section = markdown.match(
    new RegExp(
      `^#{1,6}[ \\t]+${escaped}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^#{1,6}[ \\t]+|\\s*$)`,
      "im",
    ),
  );
  return section?.[1];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}