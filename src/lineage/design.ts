// Lineage-first design. Every retrieval is published to one append-only substrate with
// its raw bytes, hash, purpose, requester, tenant, format, reference-data version, and
// adapter version; the decision record links the retrieval events it consumed. Replay
// needs no source-specific code: it re-runs the recorded adapter versions on the
// recorded bytes and checks every hash.

import type pg from "pg";
import { adapterFor } from "../adapters/index.ts";
import { sha256 } from "../core/canonical.ts";
import { assemble, retrieve, type DecisionRun } from "../core/pipeline.ts";
import type { Part, SourceId } from "../core/types.ts";
import type { QualityMode } from "../quality/layer.ts";
import { dictionaryVersion } from "../refdata/reasons.ts";
import type { Design, Replay, StoredDecision } from "../designs/types.ts";

export const lineageDesign: Design = {
  name: "lineage",

  async persist(c: pg.ClientBase, run: DecisionRun, quality: QualityMode): Promise<void> {
    const req = run.request;
    const ids: string[] = [];
    for (const r of run.retrievals) {
      const res = await c.query(
        `INSERT INTO lineage.retrieval (tenant_id, decision_id, requester, purpose, source, content_type, format_version,
           refdata_version, adapter_version, payload, payload_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING event_id`,
        [req.tenantId, req.decisionId, req.requester, req.purpose, r.source, r.contentType, r.decoded.formatVersion,
          r.refdataVersion, adapterFor(r.source).version, r.bytes, sha256(r.bytes)],
      );
      ids.push(res.rows[0].event_id);
    }
    await c.query(
      `INSERT INTO lineage.decision (decision_id, tenant_id, consumer_id, as_of, requester, purpose, model_version, quality_mode,
         retrieval_event_ids, model_input_sha256, outcome, reasons, quarantined)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [req.decisionId, req.tenantId, req.consumerId, req.asOf, req.requester, req.purpose, run.decision.modelVersion, quality,
        ids, sha256(run.modelInput), run.decision.outcome, JSON.stringify(run.decision.reasons), JSON.stringify(run.file.quarantined)],
    );
  },

  async replay(c: pg.ClientBase, decisionId: string): Promise<Replay | null> {
    const d = (await c.query("SELECT * FROM lineage.decision WHERE decision_id = $1", [decisionId])).rows[0];
    if (!d) return null;
    const events = (
      await c.query(
        `SELECT r.* FROM lineage.retrieval r JOIN unnest($1::bigint[]) WITH ORDINALITY AS l(id, n) ON r.event_id = l.id ORDER BY l.n`,
        [d.retrieval_event_ids],
      )
    ).rows;
    let ok = events.length === d.retrieval_event_ids.length;
    const raw: Partial<Record<SourceId, Buffer>> = {};
    const parts: Partial<Record<SourceId, Part>> = {};
    for (const e of events) {
      const source = e.source as SourceId;
      if (!sha256(e.payload).equals(e.payload_sha256)) ok = false;
      const key = adapterFor(source).dictionary;
      const dict = e.refdata_version && key ? dictionaryVersion(key, e.refdata_version) : null;
      raw[source] = e.payload;
      parts[source] = retrieve(source, e.payload, e.content_type, dict).part;
    }
    const asOf = d.as_of instanceof Date ? d.as_of.toISOString().slice(0, 10) : String(d.as_of);
    const { modelInput, decision } = assemble(d.consumer_id, asOf, parts, d.quality_mode, d.model_version);
    if (!sha256(modelInput).equals(d.model_input_sha256)) ok = false;
    return { decisionId, raw, modelInput, decision, integrity: ok ? "verified" : "mismatch" };
  },

  async readDecision(c: pg.ClientBase, decisionId: string): Promise<StoredDecision | null> {
    const d = (await c.query("SELECT decision_id, tenant_id, consumer_id, outcome FROM lineage.decision WHERE decision_id = $1", [decisionId])).rows[0];
    return d ? { decisionId: d.decision_id, tenantId: d.tenant_id, consumerId: d.consumer_id, outcome: d.outcome } : null;
  },
};
