import type { CvssResult } from "./types.js";

const weights = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR: {
    U: { N: 0.85, L: 0.62, H: 0.27 },
    C: { N: 0.85, L: 0.68, H: 0.5 },
  },
  UI: { N: 0.85, R: 0.62 },
  S: { U: 6.42, C: 7.52 },
  C: { H: 0.56, L: 0.22, N: 0 },
  I: { H: 0.56, L: 0.22, N: 0 },
  A: { H: 0.56, L: 0.22, N: 0 },
} as const;

export function calculateCvss(vector: string): CvssResult {
  const metrics = parseVector(vector);
  const scopeChanged = metrics.S === "C";
  const iss = 1 - (1 - weights.C[metrics.C]) * (1 - weights.I[metrics.I]) * (1 - weights.A[metrics.A]);
  if (iss <= 0) {
    return { version: "3.1", score: 0, severity: "None", vector };
  }

  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss;
  const exploitability =
    8.22 *
    weights.AV[metrics.AV] *
    weights.AC[metrics.AC] *
    weights.PR[scopeChanged ? "C" : "U"][metrics.PR] *
    weights.UI[metrics.UI];
  const base = scopeChanged
    ? Math.min(10, 1.08 * (impact + exploitability))
    : Math.min(10, impact + exploitability);
  const score = roundUpOneDecimal(base);

  return {
    version: "3.1",
    score,
    severity: severityForScore(score),
    vector,
  };
}

function parseVector(vector: string): {
  AV: keyof typeof weights.AV;
  AC: keyof typeof weights.AC;
  PR: keyof typeof weights.PR.U;
  UI: keyof typeof weights.UI;
  S: keyof typeof weights.S;
  C: keyof typeof weights.C;
  I: keyof typeof weights.I;
  A: keyof typeof weights.A;
} {
  const parts = vector.split("/");
  if (parts.shift() !== "CVSS:3.1") {
    throw new Error("CVSS vector must start with CVSS:3.1.");
  }
  const values = new Map(parts.map((part) => part.split(":") as [string, string]));
  const required = ["AV", "AC", "PR", "UI", "S", "C", "I", "A"] as const;
  for (const key of required) {
    if (!values.get(key)) {
      throw new Error(`CVSS vector is missing ${key}.`);
    }
  }
  const result = Object.fromEntries(required.map((key) => [key, values.get(key)])) as ReturnType<typeof parseVector>;
  if (!(result.AV in weights.AV) || !(result.AC in weights.AC) || !(result.PR in weights.PR.U) ||
      !(result.UI in weights.UI) || !(result.S in weights.S) || !(result.C in weights.C) ||
      !(result.I in weights.I) || !(result.A in weights.A)) {
    throw new Error("CVSS vector contains an unsupported metric value.");
  }
  return result;
}

function roundUpOneDecimal(value: number): number {
  return Math.ceil(value * 10) / 10;
}

function severityForScore(score: number): CvssResult["severity"] {
  if (score === 0) return "None";
  if (score <= 3.9) return "Low";
  if (score <= 6.9) return "Medium";
  if (score <= 8.9) return "High";
  return "Critical";
}