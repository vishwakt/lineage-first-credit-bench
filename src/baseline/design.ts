// Baseline design: each integration writes its own audit log next to its adapter, and the
// decision service keeps a decision log that names the sources it used. This is the common
// pattern, built as competently as we could (shared helper, correlation by decision id,
// tenant column and row-level security on every table, model version recorded). How much
// each integration captures is a configurable discipline level, see docs/BASELINE_DESIGN.md:
//
//   parsed      the adapter's parsed response object
//   normalized  the adapter's normalized output
//   raw         the raw payload as text, its format version, and the normalized output
//   hardened    the raw bytes, a SHA-256 hash, and the format, dictionary, and adapter
//               versions; the decision log keeps a model-input hash; replay reads every
//               audit table in one query and is verified against the stored hashes
//               (added in revision to separate centralization from capture discipline)

import type pg from "pg";
import { adapterFor } from "../adapters/index.ts";
import { sha256 } from "../core/canonical.ts";
import { assemble, dictionaryAt, retrieve, type DecisionRun } from "../core/pipeline.ts";
import type { Part, SourceId } from "../core/types.ts";
import type { QualityMode } from "../quality/layer.ts";
import { dictionaryVersion } from "../refdata/reasons.ts";
import type { Design, Replay, StoredDecision } from "../designs/types.ts";
import { auditFor } from "./audit/index.ts";

export type CaptureMode = "parsed" | "normalized" | "raw" | "hardened";
export const CAPTURE_MODES: readonly CaptureMode[] = ["parsed", "normalized", "raw", "hardened"];

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
        if (capture === "hardened") {
          row.raw_bytes = r.bytes;
          row.payload_sha256 = sha256(r.bytes);
          row.format_version = r.decoded.formatVersion;
          row.refdata_version = r.refdataVersion;
          row.adapter_version = adapterFor(r.source).version;
        }
        const cols = Object.keys(row);
        await c.query(
          `INSERT INTO ${audit.table} (${cols.join(",")}) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")})`,
          Object.values(row),
        );
      }
      await c.query(
        `INSERT INTO baseline.decision_log (decision_id, tenant_id, consumer_id, as_of, requester, purpose, model_version, quality_mode,
           sources, outcome, reasons, quarantined, model_input_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [req.decisionId, req.tenantId, req.consumerId, req.asOf, req.requester, req.purpose, run.decision.modelVersion, quality,
          run.retrievals.map((r) => r.source), run.decision.outcome, JSON.stringify(run.decision.reasons), JSON.stringify(run.file.quarantined),
          capture === "hardened" ? sha256(run.modelInput) : null],
      );
    },

    async replay(c: pg.ClientBase, decisionId: string, now: string): Promise<Replay | null> {
      const d = (await c.query("SELECT * FROM baseline.decision_log WHERE decision_id = $1", [decisionId])).rows[0];
      if (!d) return null;
      if (capture === "hardened") return replayHardened(c, d, decisionId);
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

// One query across every audit table the decision used, then the same verified re-derivation
// as the lineage design, from the raw bytes with the recorded versions.
async function replayHardened(c: pg.ClientBase, d: Record<string, any>, decisionId: string): Promise<Replay> {
  const sources = d.sources as SourceId[];
  const sql = sources
    .map((s, i) => `(SELECT '${s}'::text AS source, ${i} AS n, raw_bytes, payload_sha256, refdata_version FROM ${auditFor(s).table} WHERE decision_id = $1 ORDER BY id LIMIT 1)`)
    .join(" UNION ALL ");
  const rows = sources.length ? (await c.query(sql + " ORDER BY n", [decisionId])).rows : [];
  let ok = rows.length === sources.length;
  const raw: Partial<Record<SourceId, Buffer | null>> = {};
  const parts: Partial<Record<SourceId, Part>> = {};
  for (const row of rows) {
    const source = row.source as SourceId;
    if (!row.raw_bytes || !sha256(row.raw_bytes).equals(row.payload_sha256)) ok = false;
    const key = adapterFor(source).dictionary;
    const dict = row.refdata_version && key ? dictionaryVersion(key, row.refdata_version) : null;
    raw[source] = row.raw_bytes;
    parts[source] = retrieve(source, row.raw_bytes, "", dict).part;
  }
  const asOf = d.as_of instanceof Date ? d.as_of.toISOString().slice(0, 10) : String(d.as_of);
  const { modelInput, decision } = assemble(d.consumer_id, asOf, parts, d.quality_mode, d.model_version);
  if (!d.model_input_sha256 || !sha256(modelInput).equals(d.model_input_sha256)) ok = false;
  return { decisionId, raw, modelInput, decision, integrity: ok ? "verified" : "mismatch" };
}
