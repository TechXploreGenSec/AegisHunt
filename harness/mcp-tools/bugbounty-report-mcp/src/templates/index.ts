import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Platform, ReportTemplate, TemplateMetadata } from "../types.js";

const templateRoot = join(dirname(fileURLToPath(import.meta.url)));

const definitions: Array<{
  platform: Platform;
  variant: string;
  file: string;
  metadata: Omit<TemplateMetadata, "requiredFields" | "optionalFields" | "requiredSections">;
  requiredFields: string[];
  optionalFields: string[];
  requiredSections: string[];
}> = [
  {
    platform: "bugcrowd",
    variant: "generic",
    file: "bugcrowd/generic.md",
    metadata: {
      platform: "bugcrowd",
      variant: "generic",
      version: "1.0.0",
      title: "Bugcrowd generic vulnerability report",
      description: "Bugcrowd-oriented report structure with a distinct business impact section.",
    },
    requiredFields: ["title", "severity", "target", "vulnerability_class", "summary", "steps_to_reproduce", "impact", "proof_of_concept"],
    optionalFields: ["cvss_vector", "cvss_score", "remediation", "affected_users", "discovered_at", "researcher_notes"],
    requiredSections: ["Summary", "Steps to Reproduce", "Proof of Concept", "Business Impact", "Remediation"],
  },
  {
    platform: "hackerone",
    variant: "generic",
    file: "hackerone/generic.md",
    metadata: {
      platform: "hackerone",
      variant: "generic",
      version: "1.0.0",
      title: "HackerOne generic vulnerability report",
      description: "HackerOne-oriented report structure using weakness, impact, and supporting material terminology.",
    },
    requiredFields: ["title", "severity", "target", "vulnerability_class", "summary", "steps_to_reproduce", "impact", "proof_of_concept"],
    optionalFields: ["cvss_vector", "cvss_score", "remediation", "affected_users", "discovered_at", "researcher_notes"],
    requiredSections: ["Summary", "Steps to Reproduce", "Impact", "Supporting Material/References"],
  },
  {
    platform: "intigriti",
    variant: "generic",
    file: "intigriti/generic.md",
    metadata: {
      platform: "intigriti",
      variant: "generic",
      version: "1.0.0",
      title: "Intigriti generic vulnerability report",
      description: "Intigriti-oriented report structure for a concise vulnerability submission.",
    },
    requiredFields: ["title", "severity", "target", "vulnerability_class", "summary", "steps_to_reproduce", "impact", "proof_of_concept"],
    optionalFields: ["cvss_vector", "cvss_score", "remediation", "affected_users", "discovered_at", "researcher_notes"],
    requiredSections: ["Summary", "Steps to Reproduce", "Proof of Concept", "Impact", "Remediation"],
  },
  {
    platform: "yeswehack",
    variant: "generic",
    file: "yeswehack/generic.md",
    metadata: {
      platform: "yeswehack",
      variant: "generic",
      version: "1.0.0",
      title: "YesWeHack generic vulnerability report",
      description: "YesWeHack-oriented report structure with category, impact, and recommendation fields.",
    },
    requiredFields: ["title", "severity", "target", "vulnerability_class", "summary", "steps_to_reproduce", "impact", "proof_of_concept"],
    optionalFields: ["cvss_vector", "cvss_score", "remediation", "affected_users", "discovered_at", "researcher_notes"],
    requiredSections: ["Summary", "Steps to Reproduce", "Proof of Concept", "Impact", "Recommendation"],
  },
  {
    platform: "synack",
    variant: "generic",
    file: "synack/generic.md",
    metadata: {
      platform: "synack",
      variant: "generic",
      version: "1.0.0",
      title: "Synack generic vulnerability report",
      description: "Synack-oriented report structure for executive summary, reproduction, and assessment details.",
    },
    requiredFields: ["title", "severity", "target", "vulnerability_class", "summary", "steps_to_reproduce", "impact", "proof_of_concept"],
    optionalFields: ["cvss_vector", "cvss_score", "remediation", "affected_users", "discovered_at", "researcher_notes"],
    requiredSections: ["Executive Summary", "Reproduction Steps", "Proof of Concept", "Impact", "Remediation"],
  },
  {
    platform: "msrc",
    variant: "generic",
    file: "msrc/generic.md",
    metadata: {
      platform: "msrc",
      variant: "generic",
      version: "1.0.0",
      title: "Microsoft MSRC generic vulnerability report",
      description: "MSRC-oriented report structure for product vulnerability triage.",
    },
    requiredFields: ["title", "severity", "target", "vulnerability_class", "summary", "steps_to_reproduce", "impact", "proof_of_concept"],
    optionalFields: ["cvss_vector", "cvss_score", "remediation", "affected_users", "discovered_at", "researcher_notes"],
    requiredSections: ["Vulnerability Details", "Reproduction Steps", "Impact", "Mitigations"],
  },
  {
    platform: "google-vrp",
    variant: "generic",
    file: "google-vrp/generic.md",
    metadata: {
      platform: "google-vrp",
      variant: "generic",
      version: "1.0.0",
      title: "Google VRP generic vulnerability report",
      description: "Google VRP-oriented report structure for issue summary, reproducibility, and impact.",
    },
    requiredFields: ["title", "severity", "target", "vulnerability_class", "summary", "steps_to_reproduce", "impact", "proof_of_concept"],
    optionalFields: ["cvss_vector", "cvss_score", "remediation", "affected_users", "discovered_at", "researcher_notes"],
    requiredSections: ["Issue Summary", "Steps to Reproduce", "Impact", "Proof of Concept", "Remediation"],
  },
  {
    platform: "generic",
    variant: "vdp",
    file: "generic/vdp.md",
    metadata: {
      platform: "generic",
      variant: "vdp",
      version: "1.0.0",
      title: "Generic vulnerability disclosure report",
      description: "Neutral VDP report structure suitable for programs without a known platform format.",
    },
    requiredFields: ["title", "severity", "target", "vulnerability_class", "summary", "steps_to_reproduce", "impact", "proof_of_concept"],
    optionalFields: ["cvss_vector", "cvss_score", "remediation", "affected_users", "discovered_at", "researcher_notes"],
    requiredSections: ["Summary", "Steps to Reproduce", "Proof of Concept", "Impact", "Remediation"],
  },
];

export function listTemplates(): ReportTemplate[] {
  return definitions.map(loadTemplate);
}

export function getTemplate(platform: string, variant = "generic"): ReportTemplate | undefined {
  const definition = definitions.find(
    (item) => item.platform === platform && item.variant === variant,
  );
  return definition ? loadTemplate(definition) : undefined;
}

function loadTemplate(
  definition: (typeof definitions)[number],
): ReportTemplate {
  const metadata: TemplateMetadata = {
    ...definition.metadata,
    requiredFields: definition.requiredFields,
    optionalFields: definition.optionalFields,
    requiredSections: definition.requiredSections,
  };
  return {
    metadata,
    markdown: readFileSync(join(templateRoot, definition.file), "utf8"),
  };
}