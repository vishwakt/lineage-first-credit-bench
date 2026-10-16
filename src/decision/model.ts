// Toy credit decision model: transparent, rule based, deterministic, and versioned. It is
// a test harness for the ingestion designs, not a contribution. Each score is compared
// with a cutoff on its own provider's scale; bureau reason codes and texts are carried
// verbatim into decline reasons, as an adverse-action notice would need them.

import { effectiveAt } from "../generator/calendar.ts";
import type { CreditFile, Decision, DecisionReason, Score } from "../core/types.ts";

type ModelVersion = {
  version: string;
  effective: string;
  cutoffs: Record<string, number>;
  altMinRecords: number;
  altOnTimeShare: number;
};

export const MODEL_VERSIONS: readonly ModelVersion[] = [
  { version: "m.1", effective: "2020-01-01", cutoffs: { bureau_a: 620, bureau_b: 600, bureau_c: 52 }, altMinRecords: 6, altOnTimeShare: 0.9 },
  { version: "m.2", effective: "2025-10-01", cutoffs: { bureau_a: 640, bureau_b: 610, bureau_c: 54 }, altMinRecords: 6, altOnTimeShare: 0.92 },
];

export function modelVersionAt(asOf: string): string {
  return effectiveAt(MODEL_VERSIONS, asOf).version;
}

function bureauReasons(scores: Score[]): DecisionReason[] {
  return scores.flatMap((s) => s.reasons.slice(0, 2).map((r) => ({ source: s.provider, code: r.code, text: r.text })));
}

export function decide(file: CreditFile, version: string): Decision {
  const m = MODEL_VERSIONS.find((x) => x.version === version);
  if (!m) throw new Error(`unknown model version ${version}`);
  const parts = Object.values(file.parts);
  const scores = parts.flatMap((p) => p!.scores).sort((a, b) => (a.provider < b.provider ? -1 : 1));
  const tradelines = parts.flatMap((p) => p!.tradelines);
  const alt = parts.flatMap((p) => p!.altPayments);
  const onTime = alt.filter((p) => p.status === "ONTIME").length;
  const missed = alt.filter((p) => p.status === "MISSED").length;
  const altGood = alt.length >= m.altMinRecords && onTime / alt.length >= m.altOnTimeShare && missed <= 1;
  const out = (outcome: Decision["outcome"], reasons: DecisionReason[]): Decision => ({ outcome, modelVersion: m.version, reasons });

  if (tradelines.some((t) => t.history.slice(-12).includes("3"))) {
    return out("DECLINE", [{ source: "model", code: "M01", text: "Serious delinquency on a credit account" }, ...bureauReasons(scores)]);
  }
  if (scores.length === 0) {
    if (alt.length < m.altMinRecords) return out("REFER", [{ source: "model", code: "M20", text: "Insufficient credit and payment history" }]);
    if (altGood) return out("APPROVE", [{ source: "model", code: "M10", text: "Approved on alternative payment history" }]);
    return out("DECLINE", [{ source: "model", code: "M03", text: "Alternative payment history shows late or missed payments" }]);
  }
  const passing = scores.filter((s) => s.value >= m.cutoffs[s.provider]).length;
  if (passing * 2 > scores.length) return out("APPROVE", []);
  const near = scores.every((s) => s.value >= m.cutoffs[s.provider] * 0.95);
  if (near && altGood) return out("APPROVE", [{ source: "model", code: "M11", text: "Approved with support from alternative payment history" }]);
  return out("DECLINE", [{ source: "model", code: "M02", text: "Credit score below the required level" }, ...bureauReasons(scores)]);
}
