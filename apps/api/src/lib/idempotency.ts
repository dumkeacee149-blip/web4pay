import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ApiError } from "../errors";

export function sha256Json(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  return createHash("sha256").update(json).digest("hex");
}

export interface IdempotencyRecord {
  response: unknown;
}

export async function idempotencyGet(
  client: Pool | PoolClient,
  tenantId: string,
  key: string,
): Promise<{ requestHash: string; response: unknown } | null> {
  const res = await client.query<{
    request_hash: string;
    response_json: unknown;
  }>(
    "select request_hash, response_json from idempotency_keys where tenant_id=$1 and key=$2",
    [tenantId, key],
  );

  if ((res.rowCount ?? 0) === 0) return null;
  return { requestHash: res.rows[0]!.request_hash, response: res.rows[0]!.response_json };
}

export async function idempotencyPut(
  client: Pool | PoolClient,
  tenantId: string,
  key: string,
  requestHash: string,
  response: unknown,
): Promise<void> {
  await client.query(
    "insert into idempotency_keys (tenant_id, key, request_hash, response_json) values ($1,$2,$3,$4)",
    [tenantId, key, requestHash, response],
  );
}

export async function withIdempotency<T>(opts: {
  client: Pool | PoolClient;
  tenantId: string;
  idempotencyKey: string;
  body: unknown;
  handler: () => Promise<T>;
}): Promise<{ reused: boolean; value: T }> {
  const requestHash = sha256Json(opts.body);
  const existing = await idempotencyGet(opts.client, opts.tenantId, opts.idempotencyKey);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ApiError(409, "conflict", {
        code: "idempotency_mismatch",
        detail: "Idempotency-Key was already used with a different request body",
      });
    }
    return { reused: true, value: existing.response as T };
  }

  const value = await opts.handler();
  await idempotencyPut(opts.client, opts.tenantId, opts.idempotencyKey, requestHash, value);
  return { reused: false, value };
}
