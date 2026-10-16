// Applies every SQL file under migrations/<group>/ in name order, once per database.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const ROOT = fileURLToPath(new URL("../../migrations/", import.meta.url));
export const GROUPS = ["core", "lineage", "baseline"] as const;

export function migrationFiles(): { id: string; sql: string }[] {
  return GROUPS.flatMap((g) =>
    readdirSync(join(ROOT, g))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => ({ id: `${g}/${f}`, sql: readFileSync(join(ROOT, g, f), "utf8") })),
  );
}

export async function migrate(c: pg.ClientBase): Promise<number> {
  await c.query("CREATE TABLE IF NOT EXISTS public.schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await c.query("SELECT id FROM public.schema_migrations")).rows.map((r) => r.id));
  let applied = 0;
  for (const m of migrationFiles()) {
    if (done.has(m.id)) continue;
    await c.query(m.sql);
    await c.query("INSERT INTO public.schema_migrations (id) VALUES ($1)", [m.id]);
    applied++;
  }
  return applied;
}
