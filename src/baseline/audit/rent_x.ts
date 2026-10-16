import type { SourceAudit } from "./types.ts";

export const rentXAudit: SourceAudit = {
  source: "rent_x",
  table: "baseline.audit_rent_x",
  encoding: "utf8",
  columns: (r) => ({ record_count: r.part.altPayments.length, missed_count: r.part.altPayments.filter((p) => p.status === "MISSED").length }),
};
