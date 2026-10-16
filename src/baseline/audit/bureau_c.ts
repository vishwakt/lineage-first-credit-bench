import type { SourceAudit } from "./types.ts";

export const bureauCAudit: SourceAudit = {
  source: "bureau_c",
  table: "baseline.audit_bureau_c",
  encoding: "utf8",
  columns: (r) => {
    const doc = r.decoded.record as any;
    return { subject_ref: (doc.CreditReport ?? doc.Report).subject, hit: r.part.hit, score_value: r.part.scores[0]?.value ?? null };
  },
};
