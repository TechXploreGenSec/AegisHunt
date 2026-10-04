import yaml from "yaml";
import { z } from "zod";

/**
 * Zod Schema to validate GitHub Actions Workflow structure.
 * Validates that YAML syntax is valid AND required GitHub Actions fields are present.
 */
export const GitHubWorkflowSchema = z.object({
  name: z.string().min(1, "Workflow must have a name"),
  on: z.union([
    z.string(),
    z.array(z.string()),
    z.record(z.unknown()),
  ]).refine((val) => val !== undefined, "Workflow must specify an 'on' trigger"),
  jobs: z
    .record(
      z.object({
        "runs-on": z.string().min(1, "Job must specify 'runs-on'"),
        steps: z
          .array(
            z.object({
              name: z.string().optional(),
              uses: z.string().optional(),
              run: z.string().optional(),
              shell: z.string().optional(),
              with: z.record(z.unknown()).optional(),
              env: z.record(z.unknown()).optional(),
            })
          )
          .min(1, "Job must have at least one step"),
      })
    )
    .refine((jobs) => Object.keys(jobs).length > 0, "Workflow must have at least one job"),
});

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Validates a raw YAML string for valid YAML syntax and GitHub Actions schema correctness.
 */
export function validateWorkflowYaml(yamlString: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = yaml.parse(yamlString);
  } catch (err: unknown) {
    const parseError = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [`Invalid YAML syntax: ${parseError}`],
    };
  }

  const result = GitHubWorkflowSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".") || "root"}: ${e.message}`);
    return {
      valid: false,
      errors,
    };
  }

  return { valid: true };
}
