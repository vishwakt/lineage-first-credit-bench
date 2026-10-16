// Baseline design: each integration writes its own audit log next to its adapter, and the
// decision service keeps a decision log that names the sources it used. This is the common
// pattern, built as competently as we could (shared helper, correlation by decision id,
// tenant column and row-level security on every table, model version recorded). How much
// each integration captures is a configurable discipline level, see docs/BASELINE_DESIGN.md:
//
//   parsed      the adapter's parsed response object
//   normalized  the adapter's normalized output
//   raw         the raw payload as text, its format version, and the normalized output

import type pg from "pg";
import { adapterFor } from "../adapters/index.ts";
import { assemble, dictionaryAt, type DecisionRun } from "../core/pipeline.ts";
import type { Part, SourceId } from "../core/types.ts";
import type { QualityMode } from "../quality/layer.ts";
import type { Design, Replay, StoredDecision } from "../designs/types.ts";
import { auditFor } from "./audit/index.ts";

export type CaptureMode = "parsed" | "normalized" | "raw";
export const CAPTURE_MODES: readonly CaptureMode[] = ["parsed", "normalized", "raw"];

export function baselineDesign(capture: CaptureMode): Design {
  return {
    name: `baseline_${capture}`,

    async persist(c: pg.ClientBase, run: DecisionRun, quality: QualityMode): Promise<void> {
      const req = run.request;
      for (const r of run.retrievals) {
        const audit = auditFor(r.source);
        const row: Record<string, unknown> = {
          decision_id: req.decisionId,
          tenant_id: req.tenantId,
          requester: req.requester,
          purpose: req.purpose,
          ...audit.columns(r),
        };
        if (capture === "parsed") row.response = JSON.stringify(r.decoded);
        if (capture === "normalized" || capture === "raw") row.normalized = JSON.stringify(r.part);
        if (capture === "raw") {
          row.raw_text = r.bytes.toString(audit.encoding);
          row.format_version = r.decoded.formatVersion;
        }
        const cols = Object.keys(row);
        await c.query(
          `INSERT INTO ${audit.table} (${cols.join(",")}) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")})`,
          Object.values(row),
        );
      }
      await c.query(
        `INSERT INTO baseline.decision_log (decision_id, tenant_id, consumer_id, as_of, requester, purpose, model_version, quality_mode,
           sources, outcome, reasons, quarantined)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [req.decisionId, req.tenantId, req.consumerId, req.asOf, req.requester, req.purpose, run.decision.modelVersion, quality,
          run.retrievals.map((r) => r.source), run.decision.outcome, JSON.stringify(run.decision.reasons), JSON.stringify(run.file.quarantined)],
      );
    },

    async replay(c: pg.ClientBase, decisionId: string, now: string): Promise<Replay | null> {
      const d = (await c.query("SELECT * FROM baseline.decision_log WHERE decision_id = $1", [decisionId])).rows[0];
      if (!d) return null;
      const raw: Partial<Record<SourceId, Buffer | null>> = {};
      const parts: Partial<Record<SourceId, Part>> = {};
      let complete = true;
      for (const source of d.sources as SourceId[]) {
        const audit = auditFor(source);
        const row = (await c.query(`SELECT * FROM ${audit.table} WHERE decision_id = $1 ORDER BY id LIMIT 1`, [decisionId])).rows[0];
        if (!row) {
          complete = false;
          raw[source] = null;
          continue;
        }
        raw[source] = row.raw_text == null ? null : Buffer.from(row.raw_text, audit.encoding);
        if (row.normalized != null) parts[source] = row.normalized;
        else if (row.response != null) {
          // Only the parsed response was kept: normalize it again with the reference data
          // this system holds now, since the adapter's dictionary is updated in place.
          const adapter = adapterFor(source);
          parts[source] = adapter.normalize(row.response, dictionaryAt(adapter.dictionary, now));
        } else complete = false;
      }
      if (!complete) return { decisionId, raw, modelInput: null, decision: null, integrity: "unchecked" };
      const asOf = d.as_of instanceof Date ? d.as_of.toISOString().slice(0, 10) : String(d.as_of);
      const { modelInput, decision } = assemble(d.consumer_id, asOf, parts, d.quality_mode, d.model_version);
      return { decisionId, raw, modelInput, decision, integrity: "unchecked" };
    },

    async readDecision(c: pg.ClientBase, decisionId: string): Promise<StoredDecision | null> {
      const d = (await c.query("SELECT decision_id, tenant_id, consumer_id, outcome FROM baseline.decision_log WHERE decision_id = $1", [decisionId])).rows[0];
      return d ? { decisionId: d.decision_id, tenantId: d.tenant_id, consumerId: d.consumer_id, outcome: d.outcome } : null;
    },
  };
}
