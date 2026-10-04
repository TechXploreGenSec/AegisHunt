export const PLATFORMS = [
  "bugcrowd",
  "hackerone",
  "intigriti",
  "yeswehack",
  "synack",
  "msrc",
  "google-vrp",
  "generic",
] as const;

export type Platform = (typeof PLATFORMS)[number];
export type Severity = "Critical" | "High" | "Medium" | "Low" | "Info";

export interface ProofOfConcept {
  description: string;
  request?: string;
  response?: string;
  screenshots?: string[];
}

export interface Finding {
  title: string;
  target: string;
  vulnerability_class: string;
  severity: Severity;
  cvss_vector?: string;
  cvss_score?: number;
  summary: string;
  steps_to_reproduce: string[];
  proof_of_concept: ProofOfConcept;
  impact: string;
  remediation?: string;
  affected_users?: string;
  discovered_at: string;
  researcher_notes?: string;
}

export interface TemplateMetadata {
  platform: Platform;
  variant: string;
  version: string;
  title: string;
  description: string;
  requiredFields: string[];
  optionalFields: string[];
  requiredSections: string[];
}

export interface ReportTemplate {
  metadata: TemplateMetadata;
  markdown: string;
}

export interface ValidationResult {
  valid: boolean;
  missing_fields: string[];
  warnings: string[];
  errors?: string[];
}

export interface CvssResult {
  version: "3.1";
  score: number;
  severity: "None" | "Low" | "Medium" | "High" | "Critical";
  vector: string;
}

export type PdfStyle = "platform" | "plain";