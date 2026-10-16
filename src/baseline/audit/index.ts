// Registry of per-integration audit logs. Adding a source adds one audit module, one
// migration creating its table, and one line here.

import type { SourceId } from "../../core/types.ts";
import type { SourceAudit } from "./types.ts";
import { bureauAAudit } from "./bureau_a.ts";
import { bureauBAudit } from "./bureau_b.ts";
import { bureauCAudit } from "./bureau_c.ts";
import { rentXAudit } from "./rent_x.ts";
import { utilityYAudit } from "./utility_y.ts";

export const AUDITS: Partial<Record<SourceId, SourceAudit>> = {
  bureau_a: bureauAAudit,
  bureau_b: bureauBAudit,
  bureau_c: bureauCAudit,
  rent_x: rentXAudit,
  utility_y: utilityYAudit,
};

export function auditFor(source: SourceId): SourceAudit {
  const a = AUDITS[source];
  if (!a) throw new Error(`no audit log registered for ${source}`);
  return a;
}
