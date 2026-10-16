// Cross-tenant read attempts. For every ordered pair of tenants (attacker A, victim B) and
// every known decision of B, try to read B's data through five paths:
//
//   api_read          A's admin asks the API for B's decision
//   api_replay        A's admin asks the API to replay B's decision
//   scoped_query      SQL in A's tenant scope that filters on B's tenant id, on every table
//   forged_context    SQL on A's connection with the tenant setting forged to B
//                     (models a bug or injection in the application's own data layer)
//   credential_reuse  A's database credentials used to open B's database
//
// An attempt is blocked when it returns none of B's rows (or is refused outright).

import pg from "pg";
import type { CreditService } from "../api/service.ts";
import { config } from "../db/db.ts";
import { loginPassword, type Tenancy, type TenantSpec } from "./tenancy.ts";

export const ATTACKS = ["api_read", "api_replay", "scoped_query", "forged_context", "credential_reuse"] as const;
export type Attack = (typeof ATTACKS)[number];
export type AttemptResult = { attack: Attack; attacker: string; victim: string; victimPerimeter: string; blocked: boolean };

const TENANT_TABLES = `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname IN ('lineage','baseline')`;

async function rowsFor(c: pg.ClientBase, victim: string): Promise<number> {
  let n = 0;
  for (const { t } of (await c.query(TENANT_TABLES)).rows) n += Number((await c.query(`SELECT count(*) FROM ${t} WHERE tenant_id = $1`, [victim])).rows[0].count);
  return n;
}

export async function runIsolationSuite(
  tenancy: Tenancy,
  svc: CreditService,
  decisionsOf: Map<string, string[]>,
  now: string,
  attackers?: readonly string[],
): Promise<AttemptResult[]> {
  const out: AttemptResult[] = [];
  const specs = [...tenancy.tenants.values()];
  for (const a of specs.filter((t) => !attackers || attackers.includes(t.id)))
    for (const b of specs) {
      if (a.id === b.id) continue;
      const rec = (attack: Attack, blocked: boolean) => out.push({ attack, attacker: a.id, victim: b.id, victimPerimeter: b.perimeter, blocked });
      const admin = { tenantId: a.id, userId: "admin", role: "admin" as const };
      for (const id of decisionsOf.get(b.id) ?? []) {
        rec("api_read", (await svc.getDecision(admin, id)).status !== "ok");
        rec("api_replay", (await svc.replay(admin, id, now)).status !== "ok");
      }
      rec("scoped_query", (await tenancy.withTenant(a.id, (c) => rowsFor(c, b.id))) === 0);
      const forged = await tenancy.withTenant(a.id, async (c) => {
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [b.id]);
        return rowsFor(c, b.id);
      });
      rec("forged_context", forged === 0);
      rec("credential_reuse", await credentialReuseBlocked(tenancy, a, b));
    }
  return out;
}

async function credentialReuseBlocked(tenancy: Tenancy, a: TenantSpec, b: TenantSpec): Promise<boolean> {
  const role = tenancy.loginRoleOf(a);
  // A pooled tenant has no credentials of its own: the shared application credentials
  // already reach every pooled tenant, so the attempt is only blocked if B is elsewhere.
  if (!role) return tenancy.databaseOf(b) !== tenancy.databaseOf(a);
  const c = new pg.Client({ ...config(tenancy.databaseOf(b)), user: role, password: loginPassword(role) });
  try {
    await c.connect();
  } catch {
    return true;
  }
  try {
    await c.query("SELECT set_config('app.tenant_id', $1, false)", [b.id]);
    await c.query("SET ROLE app_rw");
    return (await rowsFor(c, b.id)) === 0;
  } finally {
    await c.end();
  }
}

export function summarize(results: AttemptResult[]) {
  const by = new Map<string, { attempts: number; blocked: number }>();
  for (const r of results) {
    for (const key of [`${r.attack}|all`, `${r.attack}|${r.victimPerimeter}`]) {
      const s = by.get(key) ?? { attempts: 0, blocked: 0 };
      s.attempts++;
      if (r.blocked) s.blocked++;
      by.set(key, s);
    }
  }
  return Object.fromEntries([...by.entries()].sort());
}
