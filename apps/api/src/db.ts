import { Pool, type PoolClient } from "pg";

export type DbClient = PoolClient;

export function createDbPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
  });
}

export async function ensureDefaultTenant(pool: Pool): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    "select id from tenants order by created_at asc limit 1",
  );
  if ((existing.rowCount ?? 0) > 0) {
    const firstTenant = existing.rows[0];
    if (firstTenant?.id) {
      return firstTenant.id;
    }
  }

  const inserted = await pool.query<{ id: string }>(
    "insert into tenants (name) values ($1) returning id",
    ["default"],
  );
  const tenant = inserted.rows[0];
  if (!tenant?.id) {
    throw new Error("Failed to create default tenant");
  }
  return tenant.id;
}
