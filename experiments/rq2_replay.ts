// RQ2: audit replay. For each corpus size, every design persisted the same decisions.
//   fidelity  replay every decision and compare with ground truth (raw, model input, decision)
//   latency   RUNS timed runs; each replays SAMPLE random decisions one at a time after a warm-up
//   storage   bytes per decision in each design's tables (heap, TOAST, and indexes)
// Usage: node experiments/rq2_replay.ts 10000 [100000 1000000]

import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import pg from "pg";
import { config } from "../src/db/db.ts";
import { Rng } from "../src/generator/rng.ts";
import { build, corpusRequest, DESIGN_NAMES, DESIGNS, harnessDb, prefixFor, prepare, REPLAY_NOW, tenancyFor } from "./lib/corpus.ts";

const RUNS = Number(process.env.RUNS ?? 20);
const SAMPLE = Number(process.env.SAMPLE ?? 1000);
const WARMUP = 200;
const WORKERS = Number(process.env.WORKERS ?? Math.max(2, availableParallelism() - 2));

async function count(db: string, sql: string): Promise<number> {
  const c = new pg.Client(config(db));
  try {
    await c.connect();
    return Number((await c.query(sql)).rows[0].n);
  } catch {
    return -1;
  } finally {
    await c.end().catch(() => {});
  }
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

async function fidelity(design: string, size: number) {
  const per = Math.ceil(size / WORKERS);
  const parts = await Promise.all(
    Array.from({ length: WORKERS }, (_, w) =>
      new Promise<Record<string, Record<string, number>>>((resolve, reject) => {
        const worker = new Worker(new URL("./lib/fidelity_worker.ts", import.meta.url), {
          workerData: { design, size, from: w * per, to: Math.min(size, (w + 1) * per) },
        });
        worker.on("message", resolve);
        worker.on("error", reject);
      }),
    ),
  );
  const total: Record<string, Record<string, number>> = {};
  for (const p of parts)
    for (const [cls, t] of Object.entries(p)) {
      total[cls] ??= {};
      for (const [k, v] of Object.entries(t)) total[cls][k] = (total[cls][k] ?? 0) + v;
    }
  return total;
}

async function latencyRun(size: number, run: number) {
  const rng = new Rng(9000 + run);
  const ids = Array.from({ length: SAMPLE + WARMUP }, () => rng.int(0, size - 1));
  const out: Record<string, { p50: number; p99: number; mean: number }> = {};
  const samples: Record<string, number[]> = {};
  // Rotate the design order between runs so no design always goes first.
  const order = DESIGN_NAMES.map((_, k) => DESIGN_NAMES[(k + run) % DESIGN_NAMES.length]);
  for (const name of order) {
    const tenancy = tenancyFor(name, size);
    const times: number[] = [];
    for (const [k, i] of ids.entries()) {
      const req = corpusRequest(i);
      const t0 = performance.now();
      const rep = await tenancy.withTenant(req.tenantId, (c) => DESIGNS[name].replay(c, req.decisionId, REPLAY_NOW));
      const ms = performance.now() - t0;
      if (!rep) throw new Error(`missing ${req.decisionId} in ${name}`);
      if (k >= WARMUP) times.push(ms);
    }
    await tenancy.close();
    // Keep each replay time (microsecond resolution) in sampling order for the bootstrap.
    samples[name] = times.map((t) => Math.round(t * 1000) / 1000);
    const sorted = [...times].sort((a, b) => a - b);
    out[name] = { p50: quantile(sorted, 0.5), p99: quantile(sorted, 0.99), mean: times.reduce((s, x) => s + x, 0) / times.length };
  }
  return { out, samples };
}

const sizes = process.argv.slice(2).map(Number);
mkdirSync("results/raw", { recursive: true });
for (const size of sizes) {
  let buildSeconds: number | null = null;
  // FRESH=1 rebuilds the corpus even if one exists, so results always come from this commit.
  if (process.env.FRESH === "1" || (await count(harnessDb(size), "SELECT count(*) AS n FROM truth")) !== size) {
    console.log(`building corpus of ${size}`);
    await prepare(size);
    buildSeconds = await build(size, WORKERS);
  }
  const storage: Record<string, { totalBytes: number; bytesPerDecision: number }> = {};
  for (const name of DESIGN_NAMES) {
    const schema = name === "lineage" ? "lineage" : "baseline";
    const bytes = await count(`${prefixFor(name, size)}_pool`, `SELECT sum(pg_total_relation_size(c.oid)) AS n FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = '${schema}'`);
    storage[name] = { totalBytes: bytes, bytesPerDecision: bytes / size };
  }
  const rawBytesPerDecision = (await count(harnessDb(size), "SELECT avg(raw_bytes) AS n FROM truth"));
  console.log(`storage`, storage);
  const fid: Record<string, unknown> = {};
  for (const name of DESIGN_NAMES) {
    const t0 = performance.now();
    fid[name] = await fidelity(name, size);
    console.log(`fidelity ${name} ${((performance.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(fid[name]));
  }
  const runs = [];
  const samples = [];
  for (let r = 0; r < RUNS; r++) {
    const { out, samples: s } = await latencyRun(size, r);
    runs.push(out);
    samples.push(s);
    console.log(`latency run ${r}`, JSON.stringify(out));
  }
  writeFileSync(`results/raw/rq2_latency_samples_${size}.json`, JSON.stringify({ size, unit: "ms", runs: samples }) + "\n");
  writeFileSync(
    `results/raw/rq2_${size}.json`,
    JSON.stringify({ size, replayNow: REPLAY_NOW, designs: DESIGN_NAMES.map((n) => DESIGNS[n].name), buildSeconds, workers: WORKERS,
      sample: SAMPLE, warmup: WARMUP, storage, rawBytesPerDecision, fidelity: fid, latencyRuns: runs }, null, 2) + "\n",
  );
}
