// RQ2 query plans: why replay costs what it does in each layout. On an existing corpus, the
// statements one replay issues are captured and rerun under EXPLAIN (ANALYZE, BUFFERS) for
// the lineage design and the hardened baseline, right after the replay itself (warm cache).
// Table, TOAST, and index sizes, index definitions, and column compression are recorded.
// Descriptive only. Usage: node experiments/rq2_plans.ts 1000000

import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { config } from "../src/db/db.ts";
import { Rng } from "../src/generator/rng.ts";
import { corpusRequest, DESIGNS, prefixFor, REPLAY_NOW, tenancyFor } from "./lib/corpus.ts";

const SAMPLE = 20;
const PLAN_DESIGNS = ["lineage", "baseline_hardened"];
const size = Number(process.argv[2] ?? 1000000);

type Plan = { "Node Type": string; "Index Name"?: string; "Relation Name"?: string; Plans?: Plan[] };
function nodes(p: Plan, out: string[] = []): string[] {
  out.push(p["Index Name"] ? `${p["Node Type"]} using ${p["Index Name"]}` : p["Relation Name"] ? `${p["Node Type"]} on ${p["Relation Name"]}` : p["Node Type"]);
  for (const c of p.Plans ?? []) nodes(c, out);
  return out;
}

async function layout(design: string) {
  const schema = design === "lineage" ? "lineage" : "baseline";
  const c = new pg.Client(config(`${prefixFor(design, size)}_pool`));
  await c.connect();
  try {
    const tables = (await c.query(`SELECT c.relname AS table, pg_relation_size(c.oid) AS heap,
        coalesce(pg_total_relation_size(c.reltoastrelid), 0) AS toast, pg_indexes_size(c.oid) AS indexes, c.reltuples::bigint AS rows
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = $1 ORDER BY 1`, [schema])).rows;
    const indexes = (await c.query(`SELECT tablename AS table, indexname AS index, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY 1, 2`, [schema])).rows;
    const compression = (await c.query(`SELECT c.relname AS table, a.attname AS column, a.attstorage AS storage,
        coalesce(nullif(a.attcompression, ''), 'default') AS compression
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'bytea'::regtype ORDER BY 1, 2`, [schema])).rows;
    const settings = (await c.query(`SELECT name, setting, unit FROM pg_settings
      WHERE name IN ('default_toast_compression', 'shared_buffers', 'work_mem', 'effective_cache_size', 'random_page_cost', 'jit') ORDER BY 1`)).rows;
    return { tables: tables.map((t) => ({ ...t, heap: Number(t.heap), toast: Number(t.toast), indexes: Number(t.indexes), rows: Number(t.rows) })), indexes, compression, settings };
  } finally {
    await c.end();
  }
}

const rng = new Rng(9100);
const ids = Array.from({ length: SAMPLE }, () => rng.int(0, size - 1));
const out: Record<string, unknown> = {};
for (const design of PLAN_DESIGNS) {
  const tenancy = tenancyFor(design, size);
  const replays = [];
  for (const i of ids) {
    const req = corpusRequest(i);
    const plans = await tenancy.withTenant(req.tenantId, async (c) => {
      const issued: { text: string; values?: unknown[] }[] = [];
      const query = c.query.bind(c);
      (c as unknown as { query: unknown }).query = (text: unknown, values?: unknown) => {
        if (typeof text === "string" && /^\s*\(?\s*(SELECT|WITH)/i.test(text)) issued.push({ text, values: values as unknown[] | undefined });
        return (query as (t: unknown, v?: unknown) => unknown)(text, values);
      };
      const rep = await DESIGNS[design].replay(c, req.decisionId, REPLAY_NOW);
      (c as unknown as { query: unknown }).query = query;
      if (!rep || rep.integrity !== "verified") throw new Error(`replay of ${req.decisionId} in ${design} not verified`);
      const res = [];
      for (const q of issued) {
        const r = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.text}`, q.values);
        const top = r.rows[0]["QUERY PLAN"][0];
        const text = await c.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) ${q.text}`, q.values);
        res.push({ sql: q.text.replace(/\s+/g, " ").trim(), executionMs: top["Execution Time"], planningMs: top["Planning Time"],
          sharedHit: top.Plan["Shared Hit Blocks"], sharedRead: top.Plan["Shared Read Blocks"], nodes: nodes(top.Plan),
          plan: text.rows.map((x: Record<string, string>) => x["QUERY PLAN"]).join("\n") });
      }
      return res;
    });
    replays.push({ decisionId: corpusRequest(i).decisionId, statements: plans });
  }
  await tenancy.close();
  out[design] = { layout: await layout(design), replays };
  const st = replays.map((r) => r.statements.length);
  console.log(design, "statements per replay", Math.min(...st), "to", Math.max(...st));
}
mkdirSync("results/raw", { recursive: true });
writeFileSync(`results/raw/rq2_plans_${size}.json`, JSON.stringify({ size, sample: SAMPLE, cache: "warm (plans taken right after the replay)", designs: out }, null, 2) + "\n");
