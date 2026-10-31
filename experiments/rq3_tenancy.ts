// RQ3: tenancy modes. For each mode (silo, pool, bridge) and tenant count (10, 50, 100):
//   onboarding   steps, SQL statements, changed files, and time to onboard each tenant
//   throughput   RUNS timed runs of M decision persists (20,000 since the 30 Oct amendment) (lineage design) spread over all
//                tenants with C in flight; decision runs are generated before timing, so
//                the figure measures the storage tier, not the synthetic providers
//   storage      bytes of every database the mode uses, per tenant, empty and after the runs
//   isolation    the cross-tenant attack suite (attacker sample at 100 tenants)
// One fifth of tenants are high perimeter; bridge gives them a silo.
// Usage: node experiments/rq3_tenancy.ts [10 50 100]

import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { CreditService } from "../src/api/service.ts";
import { runDecision, type DecisionRun } from "../src/core/pipeline.ts";
import { config } from "../src/db/db.ts";
import { consumerId, SOURCES } from "../src/generator/world.ts";
import { lineageDesign } from "../src/lineage/design.ts";
import { DEFAULT_WORLD } from "../src/providers/config.ts";
import { fetchFromProvider } from "../src/providers/index.ts";
import { runIsolationSuite, summarize } from "../src/tenancy/isolation.ts";
import { Tenancy, TENANCY_MODES, type OnboardingRecord, type TenantSpec } from "../src/tenancy/tenancy.ts";
import type { SourceId } from "../src/core/types.ts";

const RUNS = Number(process.env.RUNS ?? 20);
const M = Number(process.env.M ?? 20000);
const C = Number(process.env.C ?? 16);
const fetch = (s: SourceId, c: string, a: string) => fetchFromProvider(DEFAULT_WORLD, s, c, a).response;

// Checkpoints completed so far (timed and requested), from the server's checkpointer view.
async function checkpoints(): Promise<number> {
  const c = new pg.Client(config());
  await c.connect();
  try {
    return Number((await c.query("SELECT num_timed + num_requested AS n FROM pg_stat_checkpointer")).rows[0].n);
  } finally {
    await c.end();
  }
}

async function databasesBytes(prefix: string): Promise<number> {
  const c = new pg.Client(config());
  await c.connect();
  try {
    const r = await c.query("SELECT sum(pg_database_size(datname)) AS n FROM pg_database WHERE datname LIKE $1 AND datname <> $2",
      [prefix + "\\_%", prefix + "_catalog"]);
    return Number(r.rows[0].n);
  } finally {
    await c.end();
  }
}

function runsFor(tenants: TenantSpec[], from: number, n: number, tag: string): DecisionRun[] {
  const out: DecisionRun[] = [];
  for (let i = from; i < from + n; i++) {
    const asOf = new Date(Date.UTC(2025, 0, 1) + (i % 365) * 86_400_000).toISOString().slice(0, 10);
    out.push(runDecision({ decisionId: `${tag}-${i}`, tenantId: tenants[i % tenants.length].id, requester: "svc", purpose: "credit_application",
      consumerId: consumerId(i), asOf, sources: [...SOURCES] as SourceId[] }, fetch, "xval"));
  }
  return out;
}

async function persistAll(tenancy: Tenancy, runs: DecisionRun[]): Promise<number> {
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: C }, async () => {
    while (next < runs.length) {
      const run = runs[next++];
      await tenancy.withTenant(run.request.tenantId, (c) => lineageDesign.persist(c, run, "xval"));
    }
  }));
  return runs.length / ((performance.now() - t0) / 1000);
}

const counts = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [10, 50, 100];
const results = [];
for (const n of counts)
  for (const mode of TENANCY_MODES) {
    const prefix = `rq3_${mode}_${n}`;
    const tenants: TenantSpec[] = Array.from({ length: n }, (_, i) => ({ id: `t${String(i).padStart(3, "0")}`, perimeter: i < n / 5 ? "high" : "standard" }));
    // Equal footing: the shared pool gets as many connections as there are requests in
    // flight, and a siloed tenant never gets fewer than its share of them.
    const tenancy = new Tenancy(mode, prefix, Math.max(1, Math.ceil(C / n)), C);
    await tenancy.init();
    const onboarding: OnboardingRecord[] = [];
    for (const t of tenants) onboarding.push(await tenancy.onboard(t));
    const emptyBytes = await databasesBytes(prefix);

    // Warm-up: one decision per tenant opens every connection pool.
    await persistAll(tenancy, runsFor(tenants, 0, n, "warm"));
    const throughput: number[] = [];
    const checkpointsBefore = await checkpoints();
    for (let r = 0; r < RUNS; r++) {
      const batch = runsFor(tenants, n + r * M, M, `r${r}`);
      throughput.push(await persistAll(tenancy, batch));
    }
    const checkpointsDuringRuns = (await checkpoints()) - checkpointsBefore;
    const loadedBytes = await databasesBytes(prefix);
    const connectionCeiling = tenancy.connectionCeiling();

    const svc = new CreditService(lineageDesign, tenancy, fetch, "xval");
    const decisionsOf = new Map(tenants.map((t, k) => [t.id, [`warm-${k}`]]));
    const attackers = n <= 50 ? undefined : tenants.filter((_, k) => k % 5 === 0).map((t) => t.id);
    const attempts = await runIsolationSuite(tenancy, svc, decisionsOf, "2026-01-01", attackers);
    await tenancy.close();

    const row = {
      mode, tenants: n, highPerimeterTenants: tenants.filter((t) => t.perimeter === "high").length,
      onboarding, emptyBytes, loadedBytes, decisionsStored: n + RUNS * M,
      throughput: { runs: RUNS, decisionsPerRun: M, concurrency: C, connectionCeiling, checkpointsDuringRuns, decisionsPerSecond: throughput },
      isolation: { attackers: attackers?.length ?? n, summary: summarize(attempts) },
    };
    results.push(row);
    console.log(mode, n, "conns", connectionCeiling, "rps", throughput.map((x) => x.toFixed(0)).join(" "), "MB/tenant", (emptyBytes / n / 1e6).toFixed(1), (loadedBytes / n / 1e6).toFixed(1),
      JSON.stringify(row.isolation.summary));
  }
mkdirSync("results/raw", { recursive: true });
writeFileSync("results/raw/rq3_tenancy.json", JSON.stringify({ results }, null, 2) + "\n");
