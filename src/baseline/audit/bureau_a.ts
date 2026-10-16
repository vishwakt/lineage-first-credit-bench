import type { SourceAudit } from "./types.ts";

export const bureauAAudit: SourceAudit = {
  source: "bureau_a",
  table: "baseline.audit_bureau_a",
  encoding: "utf8",
  columns: (r) => ({ subject_ref: (r.decoded.record as any).inquiry?.subjectRef ?? (r.decoded.record as any).subject?.ref, hit: r.part.hit, score_value: r.part.scores[0]?.value ?? null }),
};
