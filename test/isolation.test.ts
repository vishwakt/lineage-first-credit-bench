// Isolation suite for all three tenancy modes. The API and tenant-scoped paths must be
// blocked everywhere; the database-level paths are blocked exactly when attacker and
// victim live in different databases (always under silo; under bridge, whenever a
// high-perimeter tenant is involved).

import assert from "node:assert/strict";
import { test } from "node:test";
import { CreditService } from "../src/api/service.ts";
import { lineageDesign } from "../src/lineage/design.ts";
import { runIsolationSuite } from "../src/tenancy/isolation.ts";
import { Tenancy, TENANCY_MODES } from "../src/tenancy/tenancy.ts";
import { fetchWorld, request, service } from "./helpers/world.ts";

const TENANTS = [
  { id: "h1", perimeter: "high" as const },
  { id: "s1", perimeter: "standard" as const },
  { id: "s2", perimeter: "standard" as const },
];

for (const mode of TENANCY_MODES) {
  test(`isolation suite: ${mode}`, async () => {
    const tenancy = new Tenancy(mode, `test_iso_${mode}`);
    await tenancy.init();
    try {
      const svc = new CreditService(lineageDesign, tenancy, fetchWorld(), "xval");
      const decisionsOf = new Map<string, string[]>();
      for (const t of TENANTS) {
        await tenancy.onboard(t);
        const ids: string[] = [];
        for (let i = 0; i < 2; i++) {
          const req = request(i, t.id);
          assert.equal((await svc.decide(service(t.id), req)).status, "ok");
          ids.push(req.decisionId);
        }
        decisionsOf.set(t.id, ids);
      }
      const results = await runIsolationSuite(tenancy, svc, decisionsOf, "2026-01-01");
      for (const r of results) {
        const separate = tenancy.databaseOf(tenancy.spec(r.attacker)) !== tenancy.databaseOf(tenancy.spec(r.victim));
        const expectBlocked = r.attack.startsWith("api") || r.attack === "scoped_query" || separate;
        assert.equal(r.blocked, expectBlocked, `${mode} ${r.attack} ${r.attacker}->${r.victim}`);
      }
    } finally {
      await tenancy.close();
    }
  });
}
