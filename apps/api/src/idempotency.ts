import type { Pool } from "pg";
import { ApiError } from "./errors";

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  responseJson: unknown;
}

export async function loadIdempotency(
  pool: Pool,
  tenantId: string,
  key: string,
): Promise<IdempotencyRecord | null> {
  const res = await pool.query<{
    key: string;
    request_hash: string;
    response_json: unknown;
  }>(
    "select key, request_hash, response_json from idempotency_keys where tenant_id = $1 and key = $2",
    [tenantId, key],
  );
  if ((res.rowCount ?? 0) === 0) return null;
  const row = res.rows[0];
  return {
    key: row.key,
    requestHash: row.request_hash,
    responseJson: row.response_json,
  };
}

export async function saveIdempotency(
  pool: Pool,
  tenantId: string,
  key: string,
  requestHash: string,
  responseJson: unknown,
): Promise<void> {
  try {
    await pool.query(
      "insert into idempotency_keys (tenant_id, key, request_hash, response_json) values ($1, $2, $3, $4)",
      [tenantId, key, requestHash, responseJson],
    );
  } catch (err: any) {
    // unique violation: someone else wrote it first
    if (String(err?.code) === "23505") {
      return;
    }
    throw err;
  }
}

export function assertIdempotencyKeyPresent(idempotencyKey?: string) {
  if (!idempotencyKey) {
    throw new ApiError(400, "Missing Idempotency-Key", {
      code: "invalid_request",
      detail: "Idempotency-Key header is required for this endpoint",
    });
  }
}
