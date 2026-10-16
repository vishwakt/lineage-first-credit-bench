// Decision corpora for the replay experiments. One corpus is persisted by every design,
// each into its own pooled database, from the very same decision runs. The harness keeps
// the decision-time ground truth (model input hash, raw payload hashes, decision) in a
// separate database that no design reads.

import { Worker } from "node:worker_threads";
import pg from "pg";
import { baselineDesign } from "../../src/baseline/design.ts";
import { sha256 } from "../../src/core/canonical.ts";
import type { DecisionRequest, SourceId } from "../../src/core/types.ts";
import { config, ident } from "../../src/db/db.ts";
import type { Design } from "../../src/designs/types.ts";
import { hash32 } from "../../src/generator/rng.ts";
import { consumerId, SOURCES } from "../../src/generator/world.ts";
import { lineageDesign } from "../../src/lineage/design.ts";
import { Tenancy, type TenantSpec } from "../../src/tenancy/tenancy.ts";

export const DESIGNS: Record<string, Design> = {
  lineage: lineageDesign,
  baseline_parsed: baselineDesign("parsed"),
  baseline_normalized: baselineDesign("normalized"),
  baseline_raw: baselineDesign("raw"),
};
export const DESIGN_NAMES = Object.keys(DESIGNS);
export const REPLAY_NOW = "2026-01-01";
export const TENANTS: TenantSpec[] = Array.from({ length: 10 }, (_, i) => ({ id: `t${String(i).padStart(2, "0")}`, perimeter: i < 2 ? "high" : "standard" }));

// Decision i: consumer i, a tenant in rotation, a deterministic date in 2025.
export function corpusRequest(i: number): DecisionRequest {
  const day = hash32(`asof|${i}`) % 365;
  const asOf = new Date(Date.UTC(2025, 0, 1) + day * 86_400_000).toISOString().slice(0, 10);
  const tenant = TENANTS[i % TENANTS.length].id;
  return { decisionId: `d${String(i).padStart(8, "0")}`, tenantId: tenant, requester: "svc", purpose: "credit_application", consumerId: consumerId(i), asOf, sources: [...SOURCES] as SourceId[] };
}

export const prefixFor = (design: string, size: number) => ident(`rq2_${design}_${size}`);
export const harnessDb = (size: number) => ident(`rq2_harness_${size}`);

export function tenancyFor(design: string, size: number): Tenancy {
  const t = new Tenancy("pool", prefixFor(design, size), 4);
  t.attach(TENANTS);
  return t;
}

async function admin(fn: (c: pg.Client) => Promise<void>, database?: string) {
  const c = new pg.Client(config(database));
  await c.connect();
  try {
    await fn(c);
  } finally {
    await c.end();
  }
}

export async function prepare(size: number): Promise<void> {
  for (const name of DESIGN_NAMES) {
    const t = new Tenancy("pool", prefixFor(name, size));
    await t.init();
    for (const spec of TENANTS) await t.onboard(spec);
    await t.close();
    // Corpus loading only: commits need not wait for the disk. Replay is read only.
    await admin(async (c) => {
      await c.query(`ALTER DATABASE ${prefixFor(name, size)}_pool SET synchronous_commit = off`);
    });
  }
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${harnessDb(size)} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${harnessDb(size)}`);
  });
  await admin(
    (c) => c.query(`CREATE TABLE truth (decision_id text PRIMARY KEY, as_of date NOT NULL, model_input_sha256 bytea NOT NULL,
                    raw_sha256 jsonb NOT NULL, decision jsonb NOT NULL, raw_bytes integer NOT NULL)`).then(() => {}),
    harnessDb(size),
  );
}

export function truthRow(run: { request: DecisionRequest; modelInput: Buffer; retrievals: { source: string; bytes: Buffer }[]; decision: unknown }) {
  return [
    run.request.decisionId,
    run.request.asOf,
    sha256(run.modelInput),
    JSON.stringify(Object.fromEntries(run.retrievals.map((r) => [r.source, sha256(r.bytes).toString("hex")]))),
    JSON.stringify(run.decision),
    run.retrievals.reduce((s, r) => s + r.bytes.length, 0),
  ];
}

// Build the corpus with worker threads, each persisting a contiguous range of decisions.
export async function build(size: number, workers: number): Promise<number> {
  const started = performance.now();
  const per = Math.ceil(size / workers);
  await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const from = w * per, to = Math.min(size, from + per);
      return new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL("./corpus_worker.ts", import.meta.url), { workerData: { size, from, to } });
        worker.on("error", reject);
        worker.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
      });
    }),
  );
  return (performance.now() - started) / 1000;
}
