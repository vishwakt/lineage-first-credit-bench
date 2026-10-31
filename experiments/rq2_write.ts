// RQ2 write side: what centralized capture costs at ingestion. The lineage design and the
// hardened baseline (same raw bytes, hashes, and versions) persist the same decision runs,
// each into its own pooled database, with synchronous commit on, at C requests in flight.
//   throughput  decisions per second of each timed run
//   latency     every persist time (transaction included), kept for the bootstrap
// Runs append to the same databases, so later runs write into fuller tables. Decision runs
// are generated before timing, so the figures measure the storage tier.
// Usage: node experiments/rq2_write.ts [1 4 16]

import { mkdirSync, writeFileSync } from "node:fs";
import { runDecision, type DecisionRun } from "../src/core/pipeline.ts";
import { DEFAULT_WORLD } from "../src/providers/config.ts";
import { fetchFromProvider } from "../src/providers/index.ts";
import { Tenancy } from "../src/tenancy/tenancy.ts";
import type { SourceId } from "../src/core/types.ts";
import { corpusRequest, DESIGNS, TENANTS } from "./lib/corpus.ts";

const RUNS = Number(process.env.RUNS ?? 20);
const N = Number(process.env.N ?? 5000);
const WARMUP = 200;
const WRITE_DESIGNS = ["lineage", "baseline_hardened"];
const fetch = (s: SourceId, c: string, a: string) => fetchFromProvider(DEFAULT_WORLD, s, c, a).response;

function batch(from: number, n: number): DecisionRun[] {
  const out: DecisionRun[] = [];
  for (let i = from; i < from + n; i++) out.push(runDecision(corpusRequest(i), fetch, "xval"));
  return out;
}

async function persistAll(tenancy: Tenancy, design: string, runs: DecisionRun[], c: number) {
  const times = new Array<number>(runs.length);
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: c }, async () => {
    while (next < runs.length) {
      const k = next++;
      const run = runs[k];
      const s = performance.now();
      await tenancy.withTenant(run.request.tenantId, (cl) => DESIGNS[design].persist(cl, run, "xval"));
      times[k] = Math.round((performance.now() - s) * 1000) / 1000;
    }
  }));
  return { decisionsPerSecond: runs.length / ((performance.now() - t0) / 1000), times };
}

const levels = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 4, 16];
const tenancies: Record<string, Tenancy> = {};
for (const d of WRITE_DESIGNS) {
  const t = new Tenancy("pool", `rq2w_${d}`);
  await t.init();
  for (const spec of TENANTS) await t.onboard(spec);
  await t.close();
}
let offset = 0;
const results = [];
for (const c of levels) {
  for (const d of WRITE_DESIGNS) {
    tenancies[d] = new Tenancy("pool", `rq2w_${d}`, c, c);
    tenancies[d].attach(TENANTS);
  }
  // Warm-up: open every connection and touch every table.
  const warm = batch(offset, WARMUP);
  offset += WARMUP;
  for (const d of WRITE_DESIGNS) await persistAll(tenancies[d], d, warm, c);
  const runs = [];
  for (let r = 0; r < RUNS; r++) {
    const runs_ = batch(offset, N);
    offset += N;
    const order = r % 2 === 0 ? WRITE_DESIGNS : [...WRITE_DESIGNS].reverse();
    const row: Record<string, { decisionsPerSecond: number; times: number[] }> = {};
    for (const d of order) row[d] = await persistAll(tenancies[d], d, runs_, c);
    runs.push(row);
    console.log(`C=${c} run ${r}`, WRITE_DESIGNS.map((d) => `${d} ${row[d].decisionsPerSecond.toFixed(0)}/s`).join(" "));
  }
  for (const d of WRITE_DESIGNS) await tenancies[d].close();
  results.push({ concurrency: c, runs });
}
mkdirSync("results/raw", { recursive: true });
writeFileSync("results/raw/rq2_write.json", JSON.stringify({ designs: WRITE_DESIGNS, runsPerLevel: RUNS, decisionsPerRun: N, warmup: WARMUP,
  synchronousCommit: "on", unit: "ms", results }) + "\n");
