// RQ2 extension: pipeline code drift. A code revision ships without a version bump between
// a decision and its replay. For each revision and design, replay the whole corpus and count
//   affected   reconstructed model input differs from the decision-time ground truth
//   flagged    the design reports that its replay does not match what it recorded
// Runs on a corpus already built by rq2_replay.ts.
// Usage: node experiments/rq2_code_drift.ts 100000

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { DESIGN_NAMES } from "./lib/corpus.ts";
import { REVISIONS, type Revision } from "./lib/code_drift_worker.ts";

const size = Number(process.argv[2] ?? 100_000);
const WORKERS = Number(process.env.WORKERS ?? Math.max(2, availableParallelism() - 2));

async function replayAll(design: string, revision: Revision) {
  const per = Math.ceil(size / WORKERS);
  const parts = await Promise.all(
    Array.from({ length: WORKERS }, (_, w) =>
      new Promise<Record<string, number>>((resolve, reject) => {
        const worker = new Worker(new URL("./lib/code_drift_worker.ts", import.meta.url), {
          workerData: { design, size, from: w * per, to: Math.min(size, (w + 1) * per), revision },
        });
        worker.on("message", resolve);
        worker.on("error", reject);
      }),
    ),
  );
  const total: Record<string, number> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) total[k] = (total[k] ?? 0) + v;
  return total;
}

const results: Record<string, Record<string, Record<string, number>>> = {};
for (const revision of Object.keys(REVISIONS) as Revision[]) {
  results[revision] = {};
  for (const design of DESIGN_NAMES) {
    results[revision][design] = await replayAll(design, revision);
    console.log(revision, design, JSON.stringify(results[revision][design]));
  }
}
mkdirSync("results/raw", { recursive: true });
writeFileSync(`results/raw/rq2_code_drift_${size}.json`, JSON.stringify({ size, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), revisions: Object.keys(REVISIONS), results }, null, 2) + "\n");
