import { workerData } from "node:worker_threads";
import pg from "pg";
import { runDecision } from "../../src/core/pipeline.ts";
import { config } from "../../src/db/db.ts";
import { DEFAULT_WORLD } from "../../src/providers/config.ts";
import { fetchFromProvider } from "../../src/providers/index.ts";
import { corpusRequest, DESIGN_NAMES, DESIGNS, harnessDb, tenancyFor, truthRow } from "./corpus.ts";

const { size, from, to } = workerData as { size: number; from: number; to: number };
const fetch = (s: any, c: string, a: string) => fetchFromProvider(DEFAULT_WORLD, s, c, a).response;
const tenancies = Object.fromEntries(DESIGN_NAMES.map((n) => [n, tenancyFor(n, size)]));
const harness = new pg.Pool({ ...config(harnessDb(size)), max: 1 });

const BATCH = 200;
let truth: unknown[][] = [];
async function flush() {
  if (truth.length === 0) return;
  const values = truth.map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`).join(",");
  await harness.query(`INSERT INTO truth VALUES ${values}`, truth.flat());
  truth = [];
}

for (let i = from; i < to; i++) {
  const run = runDecision(corpusRequest(i), fetch, "xval");
  await Promise.all(DESIGN_NAMES.map((n) => tenancies[n].withTenant(run.request.tenantId, (c) => DESIGNS[n].persist(c, run, "xval"))));
  truth.push(truthRow(run));
  if (truth.length >= BATCH) await flush();
}
await flush();
await harness.end();
await Promise.all(Object.values(tenancies).map((t) => t.close()));
