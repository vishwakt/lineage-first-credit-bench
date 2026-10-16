import type { SourceAudit } from "./types.ts";

export const bureauBAudit: SourceAudit = {
  source: "bureau_b",
  table: "baseline.audit_bureau_b",
  encoding: "latin1",
  columns: (r) => ({ subject_ref: (r.decoded.record as any).subject, hit: r.part.hit, score_value: r.part.scores[0]?.value ?? null, tradeline_count: r.part.tradelines.length }),
};
