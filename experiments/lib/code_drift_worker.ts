// Replays a range of corpus decisions after a pipeline code revision that shipped without a
// version bump, and records whether the reconstruction still matches the decision-time
// ground truth and whether the design noticed.

import { parentPort, workerData } from "node:worker_threads";
import pg from "pg";
import { ADAPTERS } from "../../src/adapters/index.ts";
import { sha256 } from "../../src/core/canonical.ts";
import { config } from "../../src/db/db.ts";
import { QUALITY_SETTINGS } from "../../src/quality/layer.ts";
import { corpusRequest, DESIGNS, harnessDb, REPLAY_NOW, tenancyFor } from "./corpus.ts";

export const REVISIONS = {
  // Control: no revision. Its counts are each design's replay mismatches from other causes.
  none: () => {},
  // A refactor converts utility_y v1 dollar amounts with truncation instead of rounding.
  adapter_rounding: () => {
    const original = ADAPTERS.utility_y!;
    ADAPTERS.utility_y = {
      ...original,
      normalize(decoded, dict) {
        const part = original.normalize(decoded, dict);
        if (decoded.formatVersion !== "1") return part;
        const lines = decoded.record as { amt: number }[];
        return { ...part, altPayments: part.altPayments.map((p, i) => ({ ...p, amountCents: Math.trunc(lines[i].amt * 100) })) };
      },
    };
  },
  // The bank-matching window of the quality layer is tuned from 55 to 40 days.
  quality_window: () => {
    QUALITY_SETTINGS.matchWindowDays = 40;
  },
} as const;
export type Revision = keyof typeof REVISIONS;

if (parentPort) {
  const { design, size, from, to, revision } = workerData as { design: string; size: number; from: number; to: number; revision: Revision };
  REVISIONS[revision]();
  const tenancy = tenancyFor(design, size);
  const harness = new pg.Pool({ ...config(harnessDb(size)), max: 1 });
  const t = { decisions: 0, affected: 0, outcomeChanged: 0, flagged: 0, flaggedAffected: 0 };
  const BATCH = 500;
  for (let start = from; start < to; start += BATCH) {
    const reqs = [];
    for (let i = start; i < Math.min(to, start + BATCH); i++) reqs.push(corpusRequest(i));
    const truth = new Map(
      (await harness.query("SELECT decision_id, model_input_sha256, decision FROM truth WHERE decision_id = ANY($1)", [reqs.map((r) => r.decisionId)]))
        .rows.map((r) => [r.decision_id, r]),
    );
    for (const req of reqs) {
      const rep = await tenancy.withTenant(req.tenantId, (c) => DESIGNS[design].replay(c, req.decisionId, REPLAY_NOW));
      const truthRow = truth.get(req.decisionId);
      t.decisions++;
      const affected = !rep?.modelInput || !sha256(rep.modelInput).equals(truthRow.model_input_sha256);
      const flagged = rep?.integrity === "mismatch";
      if (affected) t.affected++;
      if (rep?.decision?.outcome !== truthRow.decision.outcome) t.outcomeChanged++;
      if (flagged) t.flagged++;
      if (flagged && affected) t.flaggedAffected++;
    }
  }
  await harness.end();
  await tenancy.close();
  parentPort.postMessage(t);
}
