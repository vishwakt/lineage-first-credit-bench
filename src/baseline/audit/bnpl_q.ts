import type { SourceAudit } from "./types.ts";

export const bnplQAudit: SourceAudit = {
  source: "bnpl_q",
  table: "baseline.audit_bnpl_q",
  encoding: "utf8",
  columns: (r) => ({ record_count: r.part.altPayments.length }),
};
