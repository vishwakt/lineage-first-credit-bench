// Step 3 check: the same seed yields byte-identical output, and injected fault rates
// match the configuration within 1 percent (relative). Writes results/raw/generator_check.json.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { consumer, SOURCES, ALT_KIND, consumerId } from "../src/generator/world.ts";
import { processorRecords } from "../src/providers/alt.ts";
import { DEFAULT_WORLD, type FaultType } from "../src/providers/config.ts";
import { fetchFromProvider } from "../src/providers/index.ts";
import { truePayment } from "../src/generator/world.ts";
import { windowBefore } from "../src/generator/calendar.ts";

const N = Number(process.env.CHECK_CONSUMERS ?? 400_000);
const SAMPLE = 2_000;
const DATES = ["2025-02-10", "2025-06-20", "2025-10-10"];

function sampleDigest(seed: number): string {
  const h = createHash("sha256");
  for (let i = 0; i < SAMPLE; i++)
    for (const asOf of DATES)
      for (const s of SOURCES) h.update(fetchFromProvider({ ...DEFAULT_WORLD, seed }, s, consumerId(i), asOf).response.bytes);
  return h.digest("hex");
}

const t0 = Date.now();
const digestA = sampleDigest(DEFAULT_WORLD.seed);
const digestB = sampleDigest(DEFAULT_WORLD.seed);
const digestOther = sampleDigest(DEFAULT_WORLD.seed + 1);

// Fault rates: each type is eligible on different records (missed and timing need a paid record).
const asOf = "2026-01-01";
const eligible: Record<FaultType, number> = { missed: 0, double: 0, timing: 0 };
const injected: Record<FaultType, number> = { missed: 0, double: 0, timing: 0 };
for (let i = 0; i < N; i++) {
  const c = consumer(DEFAULT_WORLD.seed, i);
  for (const [source, kind] of Object.entries(ALT_KIND)) {
    if (!c.has[kind!]) continue;
    const { faults } = processorRecords(DEFAULT_WORLD, source, kind!, c, asOf);
    for (const period of windowBefore(asOf, 12)) {
      const p = truePayment(DEFAULT_WORLD.seed, c, kind!, period)!;
      const paidByAsOf = p.paid !== null && p.paid < asOf;
      eligible.double++;
      if (paidByAsOf) { eligible.missed++; eligible.timing++; }
    }
    for (const f of faults) injected[f.type]++;
  }
}
const rates = Object.fromEntries(
  (Object.keys(eligible) as FaultType[]).map((t) => {
    const observed = injected[t] / eligible[t];
    const configured = DEFAULT_WORLD.faults[t];
    return [t, { eligible: eligible[t], injected: injected[t], observed, configured, relativeError: Math.abs(observed - configured) / configured }];
  }),
);
const out = {
  seed: DEFAULT_WORLD.seed,
  consumers: N,
  determinism: { sampleConsumers: SAMPLE, dates: DATES, digestA, digestB, identical: digestA === digestB, differentSeedDiffers: digestOther !== digestA },
  faultRates: rates,
  withinOnePercent: Object.values(rates).every((r) => r.relativeError <= 0.01),
  seconds: (Date.now() - t0) / 1000,
};
mkdirSync("results/raw", { recursive: true });
writeFileSync("results/raw/generator_check.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
