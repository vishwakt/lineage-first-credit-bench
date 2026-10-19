// Both designs on the same requests: identical decisions; replay fidelity as expected for
// each capture level; append-only substrate; row-level security on every table.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { CreditService } from "../src/api/service.ts";
import { adapterFor } from "../src/adapters/index.ts";
import { baselineDesign, CAPTURE_MODES } from "../src/baseline/design.ts";
import { dictionaryAt } from "../src/core/pipeline.ts";
import type { Design } from "../src/designs/types.ts";
import { lineageDesign } from "../src/lineage/design.ts";
import { Tenancy } from "../src/tenancy/tenancy.ts";
import { fetchWorld, registered, request, service } from "./helpers/world.ts";

const NOW = "2026-01-01";
const N = 24;
const tenancy = new Tenancy("pool", "test_designs");
const designs: Design[] = [lineageDesign, ...CAPTURE_MODES.map(baselineDesign)];

before(async () => {
  await tenancy.init();
  await tenancy.onboard({ id: "ta", perimeter: "standard" });
});
after(() => tenancy.close());

for (const design of designs) {
  test(`${design.name}: persists and replays`, async () => {
    const svc = new CreditService(design, tenancy, fetchWorld(), "xval");
    for (let i = 0; i < N; i++) {
      const req = { ...request(i, "ta"), decisionId: `${design.name}-${i}` };
      const res = await svc.decide(service("ta"), req);
      assert.equal(res.status, "ok");
      if (res.status !== "ok") return;
      const run = res.value;
      const rep = await tenancy.withTenant("ta", (c) => design.replay(c, req.decisionId, NOW));
      assert.ok(rep);
      // Reference data this design could have drifted on between decision and replay.
      const drifted = req.sources.some((s) => {
        const key = adapterFor(s).dictionary;
        return key !== null && dictionaryAt(key, req.asOf)!.version !== dictionaryAt(key, NOW)!.version;
      });
      if (design.name === "lineage" || design.name === "baseline_hardened") {
        assert.equal(rep.integrity, "verified");
        for (const r of run.retrievals) assert.ok(rep.raw[r.source]!.equals(r.bytes), `raw ${r.source}`);
      }
      if (design.name === "baseline_raw") for (const r of run.retrievals) assert.ok(rep.raw[r.source]!.equals(r.bytes), `raw ${r.source}`);
      if (design.name !== "baseline_parsed" || !drifted) {
        assert.ok(rep.modelInput!.equals(run.modelInput), `model input ${req.decisionId}`);
        assert.deepEqual(rep.decision, run.decision);
      }
    }
  });
}

test("lineage substrate is append only, even for the application role", async () => {
  // The application role lacks the privilege; the table owner is stopped by the trigger.
  await assert.rejects(tenancy.withTenant("ta", (c) => c.query("UPDATE lineage.decision SET outcome = 'APPROVE'")), /permission denied/);
  const owner = tenancy.pool("ta");
  await assert.rejects(owner.query("UPDATE lineage.decision SET outcome = 'APPROVE'"), /append only/);
  await assert.rejects(owner.query("DELETE FROM lineage.decision"), /append only/);
  await assert.rejects(owner.query("TRUNCATE lineage.retrieval"), /append only/);
});

test("hardened baseline tables are append only, even for their owner", async () => {
  const owner = tenancy.pool("ta");
  await assert.rejects(owner.query("UPDATE baseline.decision_log SET outcome = 'APPROVE'"), /append only/);
  await assert.rejects(owner.query("DELETE FROM baseline.audit_bureau_a"), /append only/);
});

test("every table holding tenant data has row-level security", async () => {
  const rows = await tenancy.withTenant("ta", async (c) =>
    (await c.query(`SELECT n.nspname || '.' || c.relname AS t, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relkind = 'r' AND n.nspname IN ('lineage','baseline')`)).rows,
  );
  assert.ok(rows.length >= 3 + registered().length);
  for (const r of rows) assert.equal(r.rls, true, r.t);
});
