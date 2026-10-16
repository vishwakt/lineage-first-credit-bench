// Replays a range of corpus decisions with one design and compares each reconstruction with
// the harness ground truth at three levels: raw payloads, model input, and decision.

import { parentPort, workerData } from "node:worker_threads";
import pg from "pg";
import { canonical, sha256 } from "../../src/core/canonical.ts";
import { config } from "../../src/db/db.ts";
import { corpusRequest, DESIGNS, harnessDb, REPLAY_NOW, tenancyFor } from "./corpus.ts";
import { exposure } from "./drift.ts";

const { design, size, from, to } = workerData as { design: string; size: number; from: number; to: number };
const tenancy = tenancyFor(design, size);
const harness = new pg.Pool({ ...config(harnessDb(size)), max: 1 });
type Tally = { decisions: number; replayed: number; rawExact: number; modelInputExact: number; outcomeEqual: number; decisionEqual: number; integrityVerified: number };
const tallies: Record<string, Tally> = {};

const BATCH = 500;
for (let start = from; start < to; start += BATCH) {
  const reqs = [];
  for (let i = start; i < Math.min(to, start + BATCH); i++) reqs.push(corpusRequest(i));
  const truth = new Map(
    (await harness.query("SELECT * FROM truth WHERE decision_id = ANY($1)", [reqs.map((r) => r.decisionId)])).rows.map((r) => [r.decision_id, r]),
  );
  for (const req of reqs) {
    const t = truth.get(req.decisionId);
    const cls = exposure(req.sources, req.asOf, REPLAY_NOW);
    const tally = (tallies[cls] ??= { decisions: 0, replayed: 0, rawExact: 0, modelInputExact: 0, outcomeEqual: 0, decisionEqual: 0, integrityVerified: 0 });
    tally.decisions++;
    const rep = await tenancy.withTenant(req.tenantId, (c) => DESIGNS[design].replay(c, req.decisionId, REPLAY_NOW));
    if (!rep) continue;
    tally.replayed++;
    const rawSha = t.raw_sha256 as Record<string, string>;
    if (Object.entries(rawSha).every(([s, h]) => rep.raw[s as keyof typeof rep.raw]?.length !== undefined && sha256(rep.raw[s as keyof typeof rep.raw]!).toString("hex") === h)) tally.rawExact++;
    if (rep.modelInput && sha256(rep.modelInput).equals(t.model_input_sha256)) tally.modelInputExact++;
    if (rep.decision && rep.decision.outcome === t.decision.outcome) tally.outcomeEqual++;
    // Outcome, model version, and every reason code and text, as an adverse-action notice would carry them.
    if (rep.decision && canonical(rep.decision) === canonical(t.decision)) tally.decisionEqual++;
    if (rep.integrity === "verified") tally.integrityVerified++;
  }
}
await harness.end();
await tenancy.close();
parentPort!.postMessage(tallies);
