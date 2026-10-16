import type { SourceAudit } from "./types.ts";

export const utilityYAudit: SourceAudit = {
  source: "utility_y",
  table: "baseline.audit_utility_y",
  encoding: "utf8",
  columns: (r) => ({ record_count: r.part.altPayments.length }),
};
