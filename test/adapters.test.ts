// Adapter conformance: in a fault-free world every normalized record must equal what the
// provider observed, across both format versions of every source.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ADAPTERS } from "../src/adapters/index.ts";
import { dictionaryAt, retrieve } from "../src/core/pipeline.ts";
import type { SourceId } from "../src/core/types.ts";
import { ALT_KIND, consumer, consumerId, SOURCES } from "../src/generator/world.ts";
import { processorRecords } from "../src/providers/alt.ts";
import { DEFAULT_WORLD, NO_FAULTS } from "../src/providers/config.ts";
import { fetchFromProvider } from "../src/providers/index.ts";

const CLEAN = { ...DEFAULT_WORLD, faults: NO_FAULTS };
const DATES = ["2025-01-15", "2025-05-20", "2025-08-01", "2025-09-15", "2025-12-30"];

function noUndefined(v: unknown, path: string): void {
  assert.notEqual(v, undefined, path);
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) noUndefined(x, `${path}.${k}`);
}

test("all eight sources are registered", () => assert.deepEqual(Object.keys(ADAPTERS).sort(), [...SOURCES].sort()));

test("normalized records match the provider's view", () => {
  for (let i = 0; i < 400; i++)
    for (const asOf of DATES)
      for (const source of SOURCES) {
        const { bytes, contentType } = fetchFromProvider(CLEAN, source, consumerId(i), asOf).response;
        const part = retrieve(source as SourceId, bytes, contentType, dictionaryAt(ADAPTERS[source]!.dictionary, asOf)).part;
        noUndefined(part, `${source}/${i}/${asOf}`);
        const c = consumer(CLEAN.seed, i);
        const kind = ALT_KIND[source];
        if (kind) {
          const truth = processorRecords(CLEAN, source, kind, c, asOf).records;
          assert.deepEqual(
            part.altPayments.map((p) => [p.period, p.due, p.paid, p.amountCents, p.status, p.payee]),
            truth.map((p) => [p.period, p.due, p.paid, p.amountCents, p.status, p.payee]),
            `${source}/${i}/${asOf}`,
          );
        } else if (source.startsWith("bureau")) {
          const seen = c.accounts.filter((a) => a.seenBy[source as "bureau_a"] && a.opened < asOf);
          assert.equal(part.hit, seen.length > 0);
          assert.deepEqual(part.tradelines.map((t) => t.ref).sort(), seen.map((a) => a.ref).sort());
          for (const t of part.tradelines) assert.equal(t.limitCents, seen.find((a) => a.ref === t.ref)!.limitCents);
          for (const s of part.scores) {
            assert.ok(s.value >= s.min && s.value <= s.max);
            for (const r of s.reasons) assert.ok(r.text, `${source} reason text ${r.code}`);
          }
        } else {
          assert.equal(part.hit, c.banked);
        }
      }
});
