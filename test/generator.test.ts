import assert from "node:assert/strict";
import { test } from "node:test";
import { consumerId, SOURCES } from "../src/generator/world.ts";
import { DEFAULT_WORLD, FORMAT_VERSIONS, NO_FAULTS } from "../src/providers/config.ts";
import { fetchFromProvider } from "../src/providers/index.ts";

test("same seed gives byte-identical payloads", () => {
  for (let i = 0; i < 50; i++)
    for (const s of SOURCES) {
      const a = fetchFromProvider(DEFAULT_WORLD, s, consumerId(i), "2025-06-20").response.bytes;
      const b = fetchFromProvider(DEFAULT_WORLD, s, consumerId(i), "2025-06-20").response.bytes;
      assert.ok(a.equals(b), `${s} ${i}`);
    }
});

test("format version switches exactly on the effective date", () => {
  for (const s of SOURCES)
    for (const v of FORMAT_VERSIONS[s]) {
      if (v.effective === "2020-01-01") continue;
      const day = fetchFromProvider(DEFAULT_WORLD, s, consumerId(3), v.effective).truth.formatVersion;
      assert.equal(day, v.version, `${s} on ${v.effective}`);
      const prev = new Date(Date.parse(v.effective) - 86_400_000).toISOString().slice(0, 10);
      assert.notEqual(fetchFromProvider(DEFAULT_WORLD, s, consumerId(3), prev).truth.formatVersion, v.version);
    }
});

test("fault-free world injects nothing", () => {
  const clean = { ...DEFAULT_WORLD, faults: NO_FAULTS };
  for (let i = 0; i < 300; i++)
    for (const s of ["rent_x", "utility_y", "telecom_t", "bnpl_q"] as const)
      assert.equal(fetchFromProvider(clean, s, consumerId(i), "2025-11-02").truth.faults.length, 0);
});
