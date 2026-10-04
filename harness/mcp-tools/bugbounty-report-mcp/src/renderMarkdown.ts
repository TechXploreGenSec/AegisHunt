import type { Finding, ReportTemplate } from "./types.js";

export function renderMarkdown(finding: Finding, template: ReportTemplate): string {
  const replacements: Record<string, string> = {
    title: finding.title,
    target: finding.target,
    vulnerability_class: finding.vulnerability_class,
    severity: finding.severity,
    cvss_vector: finding.cvss_vector ?? "Not provided",
    cvss_score: finding.cvss_score === undefined ? "Not provided" : String(finding.cvss_score),
    summary: finding.summary,
    steps_to_reproduce: finding.steps_to_reproduce
      .map((step, index) => `${index + 1}. ${step}`)
      .join("\n"),
    proof_of_concept: formatProofOfConcept(finding),
    impact: finding.impact,
    remediation: finding.remediation ?? "Not provided",
    affected_users: finding.affected_users ?? "Not provided",
    discovered_at: finding.discovered_at,
    researcher_notes: finding.researcher_notes ?? "",
  };

  return template.markdown
    .replace(/^<!--[\s\S]*?-->\s*/u, "")
    .replace(/\{\{([a-z_]+)\}\}/gu, (_match, key: string) => replacements[key] ?? "");
}

function formatProofOfConcept(finding: Finding): string {
  const parts = [finding.proof_of_concept.description];
  if (finding.proof_of_concept.request) {
    parts.push(`### Request\n\`\`\`http\n${finding.proof_of_concept.request}\n\`\`\``);
  }
  if (finding.proof_of_concept.response) {
    parts.push(`### Response\n\`\`\`\n${finding.proof_of_concept.response}\n\`\`\``);
  }
  if (finding.proof_of_concept.screenshots?.length) {
    parts.push(
      `### Screenshots\n${finding.proof_of_concept.screenshots
        .map((screenshot) => `- ${screenshot}`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}