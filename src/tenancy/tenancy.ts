// Tenancy modes. silo: a database per tenant. pool: one shared database, isolation by
// tenant column and row-level security. bridge: high-perimeter tenants get a silo, the
// rest share the pool. Every mode uses the same schema and the same application code;
// only the routing and the onboarding steps differ.

import pg from "pg";
import { config, ident, inTransaction } from "../db/db.ts";
import { migrate, migrationFiles } from "../db/migrate.ts";

export type TenancyMode = "silo" | "pool" | "bridge";
export const TENANCY_MODES: readonly TenancyMode[] = ["silo", "pool", "bridge"];
export type TenantSpec = { id: string; perimeter: "high" | "standard" };
export type Tier = "silo" | "pool";

export type OnboardingRecord = {
  tenantId: string;
  mode: TenancyMode;
  tier: Tier;
  steps: string[];
  sqlStatements: number;
  filesChanged: number;
  ms: number;
};

// Local throwaway credentials for the per-tenant database roles used by the isolation suite.
export const loginPassword = (role: string) => `local-only-${role}`;

const statementsIn = (sql: string) => sql.split(/;\s*$/m).filter((s) => s.replace(/--.*$/gm, "").trim().length > 0).length;

export class Tenancy {
  readonly tenants = new Map<string, TenantSpec>();
  private readonly pools = new Map<string, pg.Pool>();

  readonly mode: TenancyMode;
  readonly prefix: string;
  readonly poolMax: number;

  constructor(mode: TenancyMode, prefix: string, poolMax = 2) {
    this.mode = mode;
    this.prefix = ident(prefix);
    this.poolMax = poolMax;
  }

  tierOf(t: TenantSpec): Tier {
    if (this.mode === "bridge") return t.perimeter === "high" ? "silo" : "pool";
    return this.mode;
  }

  databaseOf(t: TenantSpec): string {
    return this.tierOf(t) === "silo" ? ident(`${this.prefix}_t_${t.id}`) : ident(`${this.prefix}_pool`);
  }

  loginRoleOf(t: TenantSpec): string | null {
    return this.tierOf(t) === "silo" ? `${this.databaseOf(t)}_login` : null;
  }

  spec(tenantId: string): TenantSpec {
    const t = this.tenants.get(tenantId);
    if (!t) throw new Error(`unknown tenant ${tenantId}`);
    return t;
  }

  private async admin<T>(fn: (c: pg.Client) => Promise<T>, database?: string): Promise<T> {
    const c = new pg.Client(config(database));
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  // Remove everything this prefix created, then create the catalog (and the pool, if used).
  async init(): Promise<void> {
    await this.close();
    await this.admin(async (c) => {
      const dbs = (await c.query("SELECT datname FROM pg_database WHERE datname LIKE $1", [this.prefix + "\\_%"])).rows;
      for (const r of dbs) await c.query(`DROP DATABASE ${ident(r.datname)} WITH (FORCE)`);
      const roles = (await c.query("SELECT rolname FROM pg_roles WHERE rolname LIKE $1", [this.prefix + "\\_%"])).rows;
      for (const r of roles) await c.query(`DROP ROLE ${ident(r.rolname)}`);
      // Only the platform's own login may open the catalog and the shared pool.
      for (const db of this.mode === "silo" ? ["_catalog"] : ["_catalog", "_pool"]) {
        await c.query(`CREATE DATABASE ${ident(this.prefix + db)}`);
        await c.query(`REVOKE CONNECT ON DATABASE ${ident(this.prefix + db)} FROM PUBLIC`);
      }
    });
    await this.admin(async (c) => {
      await c.query("CREATE TABLE tenant (tenant_id text PRIMARY KEY, perimeter text NOT NULL, tier text NOT NULL, database text NOT NULL)");
    }, this.prefix + "_catalog");
    if (this.mode !== "silo") await this.admin((c) => migrate(c), this.prefix + "_pool");
    this.tenants.clear();
  }

  async onboard(t: TenantSpec): Promise<OnboardingRecord> {
    const started = performance.now();
    const steps: string[] = [];
    let sqlStatements = 0;
    const tier = this.tierOf(t);
    const db = this.databaseOf(t);
    if (tier === "silo") {
      const role = this.loginRoleOf(t)!;
      await this.admin(async (c) => {
        await c.query(`CREATE DATABASE ${db}`);
        await c.query(`REVOKE CONNECT ON DATABASE ${db} FROM PUBLIC`);
        await c.query(`CREATE ROLE ${role} LOGIN PASSWORD '${loginPassword(role)}'`);
        await c.query(`GRANT CONNECT ON DATABASE ${db} TO ${role}`);
        await c.query(`GRANT app_rw TO ${role}`);
      });
      steps.push("create database", "revoke public connect", "create tenant login role", "grant connect to tenant role", "grant application role");
      sqlStatements += 5;
      await this.admin((c) => migrate(c), db);
      const files = migrationFiles();
      steps.push(`apply ${files.length} migration files`);
      sqlStatements += files.reduce((s, f) => s + statementsIn(f.sql), 0) + files.length;
    }
    await this.admin(
      (c) => c.query("INSERT INTO tenant VALUES ($1,$2,$3,$4)", [t.id, t.perimeter, tier, db]),
      this.prefix + "_catalog",
    );
    steps.push("register tenant in catalog");
    sqlStatements += 1;
    this.tenants.set(t.id, t);
    return { tenantId: t.id, mode: this.mode, tier, steps, sqlStatements, filesChanged: 0, ms: performance.now() - started };
  }

  pool(tenantId: string): pg.Pool {
    const db = this.databaseOf(this.spec(tenantId));
    let p = this.pools.get(db);
    if (!p) {
      p = new pg.Pool({ ...config(db), max: this.poolMax });
      this.pools.set(db, p);
    }
    return p;
  }

  // Run fn inside a transaction scoped to one tenant, as the non-superuser application role.
  withTenant<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    return inTransaction(this.pool(tenantId), async (c) => {
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await c.query("SET LOCAL ROLE app_rw");
      return fn(c);
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.pools.values()].map((p) => p.end()));
    this.pools.clear();
  }
}
