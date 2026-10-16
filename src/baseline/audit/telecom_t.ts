import type { SourceAudit } from "./types.ts";

export const telecomTAudit: SourceAudit = {
  source: "telecom_t",
  table: "baseline.audit_telecom_t",
  encoding: "latin1",
  columns: (r) => ({ record_count: r.part.altPayments.length }),
};
