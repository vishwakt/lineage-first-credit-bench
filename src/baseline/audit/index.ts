// Registry of per-integration audit logs. Adding a source adds one audit module, one
// migration creating its table, and one line here.

import type { SourceId } from "../../core/types.ts";
import type { SourceAudit } from "./types.ts";

export const AUDITS: Partial<Record<SourceId, SourceAudit>> = {};

export function auditFor(source: SourceId): SourceAudit {
  const a = AUDITS[source];
  if (!a) throw new Error(`no audit log registered for ${source}`);
  return a;
}
