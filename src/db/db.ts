// Connection helpers. Defaults point at the local Compose database; CI and the bench
// container override them through the standard PG* environment variables.

import pg from "pg";

export function config(database?: string): pg.PoolConfig {
  return {
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 55432),
    user: process.env.PGUSER ?? "bench",
    password: process.env.PGPASSWORD ?? "bench",
    database: database ?? process.env.PGDATABASE ?? "bench",
  };
}

export function pool(database?: string, max = 4): pg.Pool {
  return new pg.Pool({ ...config(database), max });
}

export async function inTransaction<T>(p: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// Drop and recreate a database (administrative connection to the default database).
export async function recreateDatabase(name: string): Promise<void> {
  const admin = new pg.Client(config());
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${ident(name)}`);
  } finally {
    await admin.end();
  }
}

export function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier ${name}`);
  return name;
}
