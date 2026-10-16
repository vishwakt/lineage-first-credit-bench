// RQ4: alternative-data fault escape. Each decision runs in the faulty world under every
// quality mode, and once in the fault-free world without a quality layer (the truth).
//   escape     an injected fault whose faulty record reaches the model input
//   caught     an injected fault whose record was quarantined
//   false quarantine  a quarantined record that carried no injected fault
//   decision effect   outcome differs from the fault-free truth
// Every injected fault must reconcile as exactly one of caught or escaped.
// Latency: RUNS timed passes of the full ingestion pipeline per mode.
// Usage: node experiments/rq4_faults.ts [decisions]

import { mkdirSync, writeFileSync } from "node:fs";
import { runDecision, type Fetch } from "../src/core/pipeline.ts";
import type { AltPayment, SourceId } from "../src/core/types.ts";
import { DEFAULT_WORLD, NO_FAULTS } from "../src/providers/config.ts";
import type { InjectedFault } from "../src/providers/alt.ts";
import { fetchFromProvider } from "../src/providers/index.ts";
import { QUALITY_MODES, type QualityMode } from "../src/quality/layer.ts";
import { corpusRequest } from "./lib/corpus.ts";

const N = Number(process.argv[2] ?? 50_000);
const RUNS = Number(process.env.RUNS ?? 5);
const CLEAN = { ...DEFAULT_WORLD, faults: NO_FAULTS };

const faultyFetch = (sink: InjectedFault[]): Fetch => (s, c, a) => {
  const { response, truth } = fetchFromProvider(DEFAULT_WORLD, s, c, a);
  sink.push(...truth.faults);
  return response;
};
const cleanFetch: Fetch = (s, c, a) => fetchFromProvider(CLEAN, s, c, a).response;

type ModeStats = {
  injected: Record<string, number>; caught: Record<string, number>; escaped: Record<string, number>;
  unreconciled: number; quarantined: number; falseQuarantines: number; altRecords: number;
  outcomeDiffers: number; outcomeDiffersWithFault: number; decisionsWithFault: number;
};
const blank = (): ModeStats => ({ injected: {}, caught: {}, escaped: {}, unreconciled: 0, quarantined: 0, falseQuarantines: 0, altRecords: 0,
  outcomeDiffers: 0, outcomeDiffersWithFault: 0, decisionsWithFault: 0 });
const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
const same = (a: AltPayment, b: AltPayment) => a.paid === b.paid && a.status === b.status;

const stats: Record<QualityMode, ModeStats> = { off: blank(), xval: blank(), xval_anomaly: blank() };
for (let i = 0; i < N; i++) {
  const req = corpusRequest(i);
  const truth = runDecision(req, cleanFetch, "off");
  const cleanRecords = new Map<string, AltPayment>();
  for (const [s, p] of Object.entries(truth.file.parts)) for (const a of p!.altPayments) cleanRecords.set(`${s}|${a.period}`, a);
  for (const mode of QUALITY_MODES) {
    const faults: InjectedFault[] = [];
    const run = runDecision(req, faultyFetch(faults), mode);
    const st = stats[mode];
    const faultKeys = new Set(faults.map((f) => `${f.source}|${f.period}`));
    const q = new Set(run.file.quarantined.map((x) => `${x.source}|${x.period}`));
    for (const f of faults) {
      const key = `${f.source}|${f.period}`;
      inc(st.injected, f.type);
      const inFile = run.file.parts[f.source as SourceId]!.altPayments.filter((a) => a.period === f.period);
      const clean = cleanRecords.get(key)!;
      // Escaped: the model input still holds the faulty version (a wrong record, or two copies).
      const faulty = f.type === "double" ? inFile.length > 1 : inFile.some((a) => !same(a, clean));
      if (faulty) inc(st.escaped, f.type);
      else if (q.has(key) && inFile.length <= 1 && inFile.every((a) => same(a, clean))) inc(st.caught, f.type);
      else st.unreconciled++;
    }
    for (const x of run.file.quarantined) {
      st.quarantined++;
      if (!faultKeys.has(`${x.source}|${x.period}`)) st.falseQuarantines++;
    }
    st.altRecords += Object.values(truth.file.parts).reduce((s, p) => s + p!.altPayments.length, 0);
    const differs = run.decision.outcome !== truth.decision.outcome;
    if (differs) st.outcomeDiffers++;
    if (faults.length > 0) {
      st.decisionsWithFault++;
      if (differs) st.outcomeDiffersWithFault++;
    }
  }
}

// Ingestion latency per decision (retrieval, decoding, normalization, quality layer, model).
const LAT_N = Math.min(N, 5000);
const latency: Record<string, number[]> = { off: [], xval: [], xval_anomaly: [] };
const sink: InjectedFault[] = [];
for (let r = 0; r < RUNS; r++) {
  const order = QUALITY_MODES.map((_, k) => QUALITY_MODES[(k + r) % QUALITY_MODES.length]);
  for (const mode of order) {
    for (let i = 0; i < 300; i++) runDecision(corpusRequest(i), faultyFetch(sink), mode); // warm-up
    const t0 = performance.now();
    for (let i = 0; i < LAT_N; i++) runDecision(corpusRequest(i), faultyFetch(sink), mode);
    latency[mode].push(((performance.now() - t0) / LAT_N) * 1000);
    sink.length = 0;
  }
}

mkdirSync("results/raw", { recursive: true });
writeFileSync("results/raw/rq4_faults.json", JSON.stringify({ decisions: N, faultRates: DEFAULT_WORLD.faults, stats,
  latency: { decisionsPerRun: LAT_N, runs: RUNS, microsecondsPerDecision: latency } }, null, 2) + "\n");
for (const m of QUALITY_MODES) console.log(m, JSON.stringify(stats[m]), latency[m].map((x) => x.toFixed(0)).join(" "));
