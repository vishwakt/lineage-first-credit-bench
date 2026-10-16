import type { SourceAudit } from "./types.ts";

export const bankZAudit: SourceAudit = {
  source: "bank_z",
  table: "baseline.audit_bank_z",
  encoding: "utf8",
  columns: (r) => ({ holder: (r.decoded.record as any).holder, has_account: r.part.hit, txn_count: r.part.bankTxns.length }),
};
