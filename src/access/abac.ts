// Attribute-based access policy for the API layer. The data layer enforces the tenant
// attribute independently (row-level security, or a separate database per tenant).

import type { Principal } from "../core/types.ts";

export type Action = "decision:create" | "decision:read" | "decision:replay";
export type ResourceAttrs = { tenantId: string; consumerId: string; outcome?: string };
export type Verdict = { allow: boolean; rule: string };

export function authorize(p: Principal, action: Action, r: ResourceAttrs): Verdict {
  if (p.tenantId !== r.tenantId) return { allow: false, rule: "tenant_mismatch" };
  switch (p.role) {
    case "admin":
      return { allow: true, rule: "tenant_admin" };
    case "service":
      return action === "decision:create" ? { allow: true, rule: "service_create" } : { allow: false, rule: "service_read_denied" };
    case "loan_officer": {
      if (action === "decision:replay") return { allow: false, rule: "officer_replay_denied" };
      const assigned = p.assignedConsumers?.includes(r.consumerId) ?? false;
      return { allow: assigned, rule: assigned ? "officer_assigned" : "officer_not_assigned" };
    }
    case "auditor": {
      if (action === "decision:create") return { allow: false, rule: "auditor_create_denied" };
      const flagged = r.outcome === "DECLINE"; // adverse decisions are flagged for review
      return { allow: flagged, rule: flagged ? "auditor_flagged" : "auditor_not_flagged" };
    }
  }
}
