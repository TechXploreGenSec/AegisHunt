import Ajv2020Module, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import findingSchema from "./finding.schema.json" with { type: "json" };
import type { Finding } from "../types.js";

const Ajv2020 = (Ajv2020Module as unknown as { default: typeof Ajv2020Module }).default || Ajv2020Module;
const addFormats = (addFormatsModule as unknown as { default: typeof addFormatsModule }).default || addFormatsModule;

const ajv = new (Ajv2020 as unknown as new (opts: object) => typeof ajv)({ allErrors: true, strict: true });
(addFormats as unknown as (ajv: unknown) => void)(ajv);
const validate: ValidateFunction<Finding> = ajv.compile(findingSchema);

export function validateFinding(value: unknown): {
  valid: boolean;
  errors: string[];
} {
  if (validate(value)) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: (validate.errors ?? []).map(formatAjvError),
  };
}

function formatAjvError(error: ErrorObject): string {
  const path = error.instancePath || "finding";
  if (error.keyword === "required") {
    return `${path}: missing required property "${String(error.params.missingProperty)}"`;
  }
  if (error.keyword === "additionalProperties") {
    return `${path}: unexpected property "${String(error.params.additionalProperty)}"`;
  }
  return `${path}: ${error.message ?? "invalid value"}`;
}