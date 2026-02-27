import type { FastifyPluginAsync } from "fastify";
import { ApiError } from "./errors";
import type { Pool } from "pg";
import { fakeAddress, fakeTxHash } from "./lib/random";
import { withIdempotency } from "./lib/idempotency";

function requireIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ApiError(400, "invalid_request", {
      code: "missing_idempotency_key",
      detail: "Idempotency-Key header is required",
    });
  }
  return raw.trim();
}

export interface RoutesOptions {
  pool: Pool;
  chain: {
    escrow: string;
    usdc: string;
  };
}

export const routes: FastifyPluginAsync<RoutesOptions> = async (fastify, opts) => {
  const pool = opts.pool;

  fastify.get("/v1/chain", async () => {
    return {
      chainId: 8453,
      name: "base",
      currency: "USDC",
      contracts: {
        escrow: opts.chain.escrow,
        usdc: opts.chain.usdc,
      },
    };
  });

  fastify.post("/v1/agents", async (request) => {
    const idempotencyKey = requireIdempotencyKey(request.headers["idempotency-key"]);
    const body = request.body as { name?: string; metadata?: unknown };

    return (
      await withIdempotency({
        client: pool,
        tenantId: request.tenantId,
        idempotencyKey,
        body,
        handler: async () => {
          const name = body?.name?.trim();
          if (!name) {
            throw new ApiError(400, "invalid_request", { code: "invalid_name" });
          }

          const walletAddress = fakeAddress();
          const res = await pool.query<{ id: string; created_at: string }>(
            "insert into agents (tenant_id, name, wallet_address, metadata) values ($1,$2,$3,$4) returning id, created_at",
            [request.tenantId, name, walletAddress, body.metadata ?? {}],
          );

          const row = res.rows[0];
          return {
            agentId: row!.id,
            name,
            walletAddress,
            createdAt: row!.created_at,
            metadata: body.metadata ?? {},
          };
        },
      })
    ).value;
  });

  fastify.post("/v1/quotes", async (request) => {
    const idempotencyKey = requireIdempotencyKey(request.headers["idempotency-key"]);
    const body = request.body as any;

    return (
      await withIdempotency({
        client: pool,
        tenantId: request.tenantId,
        idempotencyKey,
        body,
        handler: async () => {
          const payerAgentId = String(body?.payerAgentId ?? "").trim();
          const payeeAddress = String(body?.payeeAddress ?? "").trim();
          const amount = String(body?.amount ?? "").trim();
          const currency = String(body?.currency ?? "USDC").trim();
          const expiresInSec = Number(body?.expiresInSec);
          const deadlineInSec = Number(body?.deadlineInSec);

          if (!payerAgentId) throw new ApiError(400, "invalid_request", { code: "missing_payerAgentId" });
          if (!payeeAddress.startsWith("0x") || payeeAddress.length < 10) {
            throw new ApiError(400, "invalid_request", { code: "invalid_payeeAddress" });
          }
          if (!amount || Number.isNaN(Number(amount))) {
            throw new ApiError(400, "invalid_request", { code: "invalid_amount" });
          }
          if (currency !== "USDC") {
            throw new ApiError(400, "invalid_request", { code: "unsupported_currency" });
          }
          if (!Number.isFinite(expiresInSec) || expiresInSec <= 0) {
            throw new ApiError(400, "invalid_request", { code: "invalid_expiresInSec" });
          }
          if (!Number.isFinite(deadlineInSec) || deadlineInSec < 60) {
            throw new ApiError(400, "invalid_request", { code: "invalid_deadlineInSec" });
          }

          const agent = await pool.query<{ id: string }>(
            "select id from agents where tenant_id=$1 and id=$2",
            [request.tenantId, payerAgentId],
          );
          if ((agent.rowCount ?? 0) === 0) {
            throw new ApiError(404, "not_found", { code: "payer_agent_not_found" });
          }

          const quoteHash = `0x${fakeTxHash().slice(2)}`;
          const inserted = await pool.query<any>(
            `insert into quotes (
              tenant_id, payer_agent_id, payee_address, amount_numeric, currency, order_id, metadata,
              quote_hash, status, expires_at, deadline_at
            ) values (
              $1,$2,$3,$4,$5,$6,$7,$8,'QUOTE_CREATED', now() + ($9 || ' seconds')::interval, now() + ($10 || ' seconds')::interval
            ) returning id, status, expires_at, deadline_at, quote_hash, created_at`,
            [
              request.tenantId,
              payerAgentId,
              payeeAddress,
              amount,
              "USDC",
              body?.orderId ?? null,
              body?.metadata ?? {},
              quoteHash,
              String(expiresInSec),
              String(deadlineInSec),
            ],
          );

          const row = inserted.rows[0];
          return {
            quoteId: row.id,
            status: row.status,
            payerAgentId,
            payeeAddress,
            amount,
            currency: "USDC",
            expiresAt: row.expires_at,
            deadlineAt: row.deadline_at,
            orderId: body?.orderId ?? undefined,
            metadata: body?.metadata ?? {},
            quoteHash: row.quote_hash,
            createdAt: row.created_at,
          };
        },
      })
    ).value;
  });

  fastify.post("/v1/escrows", async (request) => {
    const idempotencyKey = requireIdempotencyKey(request.headers["idempotency-key"]);
    const body = request.body as any;

    return (
      await withIdempotency({
        client: pool,
        tenantId: request.tenantId,
        idempotencyKey,
        body,
        handler: async () => {
          const quoteId = String(body?.quoteId ?? "").trim();
          if (!quoteId) throw new ApiError(400, "invalid_request", { code: "missing_quoteId" });

          const quoteRes = await pool.query<any>(
            `select q.*, a.wallet_address as payer_wallet
             from quotes q
             join agents a on a.id=q.payer_agent_id
             where q.tenant_id=$1 and q.id=$2`,
            [request.tenantId, quoteId],
          );
          if ((quoteRes.rowCount ?? 0) === 0) throw new ApiError(404, "not_found", { code: "quote_not_found" });
          const q = quoteRes.rows[0];

          const now = new Date();
          if (new Date(q.expires_at) <= now) {
            throw new ApiError(409, "conflict", { code: "quote_expired" });
          }

          const txHash = fakeTxHash();

          const inserted = await pool.query<any>(
            `insert into escrows (
              tenant_id, quote_id, payer_address, payee_address, amount_numeric, currency,
              status, deposit_tx_hash, deadline_at
            ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            returning id`,
            [
              request.tenantId,
              quoteId,
              q.payer_wallet,
              q.payee_address,
              q.amount_numeric,
              "USDC",
              "TX_PENDING_DEPOSIT",
              txHash,
              q.deadline_at,
            ],
          );

          const escrowId = inserted.rows[0].id;

          // Mock: immediately mark as deposited to make API usable without watcher.
          await pool.query(
            "update escrows set status='DEPOSITED' where tenant_id=$1 and id=$2",
            [request.tenantId, escrowId],
          );

          return { escrowId, status: "TX_PENDING_DEPOSIT", txHash };
        },
      })
    ).value;
  });

  fastify.get("/v1/escrows/:escrowId", async (request) => {
    const escrowId = (request.params as any).escrowId;
    const res = await pool.query<any>(
      `select e.*, q.id as quote_id
       from escrows e
       join quotes q on q.id = e.quote_id
       where e.tenant_id=$1 and e.id=$2`,
      [request.tenantId, escrowId],
    );
    if ((res.rowCount ?? 0) === 0) throw new ApiError(404, "not_found", { code: "escrow_not_found" });
    const e = res.rows[0];

    return {
      escrowId: e.id,
      quoteId: e.quote_id,
      status: e.status,
      amount: String(e.amount_numeric),
      currency: e.currency,
      payerAddress: e.payer_address,
      payeeAddress: e.payee_address,
      onchainEscrowId: e.onchain_escrow_id ? String(e.onchain_escrow_id) : null,
      deadlineAt: e.deadline_at,
      txHashes: {
        deposit: e.deposit_tx_hash ?? null,
        release: e.release_tx_hash ?? null,
        refund: e.refund_tx_hash ?? null,
      },
      createdAt: e.created_at,
      updatedAt: e.updated_at,
    };
  });

  fastify.post("/v1/escrows/:escrowId/release", async (request) => {
    const idempotencyKey = requireIdempotencyKey(request.headers["idempotency-key"]);
    const body = request.body as any;
    const escrowId = (request.params as any).escrowId;

    return (
      await withIdempotency({
        client: pool,
        tenantId: request.tenantId,
        idempotencyKey,
        body: { escrowId, ...body },
        handler: async () => {
          const deliverableHash = String(body?.deliverableHash ?? "").trim();
          if (!deliverableHash.startsWith("0x")) {
            throw new ApiError(400, "invalid_request", { code: "invalid_deliverableHash" });
          }

          const current = await pool.query<any>(
            "select status from escrows where tenant_id=$1 and id=$2",
            [request.tenantId, escrowId],
          );
          if ((current.rowCount ?? 0) === 0) throw new ApiError(404, "not_found", { code: "escrow_not_found" });

          const status = current.rows[0].status;
          if (status !== "DEPOSITED") {
            throw new ApiError(409, "conflict", { code: "invalid_state" });
          }

          const txHash = fakeTxHash();
          await pool.query(
            "update escrows set status='TX_PENDING_RELEASE', release_tx_hash=$3 where tenant_id=$1 and id=$2",
            [request.tenantId, escrowId, txHash],
          );
          // Mock settle
          await pool.query(
            "update escrows set status='RELEASED' where tenant_id=$1 and id=$2",
            [request.tenantId, escrowId],
          );

          return { escrowId, status: "TX_PENDING_RELEASE", txHash };
        },
      })
    ).value;
  });

  fastify.post("/v1/escrows/:escrowId/refund", async (request) => {
    const idempotencyKey = requireIdempotencyKey(request.headers["idempotency-key"]);
    const body = request.body as any;
    const escrowId = (request.params as any).escrowId;

    return (
      await withIdempotency({
        client: pool,
        tenantId: request.tenantId,
        idempotencyKey,
        body: { escrowId, ...body },
        handler: async () => {
          const reason = String(body?.reason ?? "").trim();
          if (!reason) throw new ApiError(400, "invalid_request", { code: "invalid_reason" });

          const current = await pool.query<any>(
            "select status from escrows where tenant_id=$1 and id=$2",
            [request.tenantId, escrowId],
          );
          if ((current.rowCount ?? 0) === 0) throw new ApiError(404, "not_found", { code: "escrow_not_found" });

          const status = current.rows[0].status;
          if (status !== "DEPOSITED") {
            throw new ApiError(409, "conflict", { code: "invalid_state" });
          }

          const txHash = fakeTxHash();
          await pool.query(
            "update escrows set status='TX_PENDING_REFUND', refund_tx_hash=$3 where tenant_id=$1 and id=$2",
            [request.tenantId, escrowId, txHash],
          );
          // Mock settle
          await pool.query(
            "update escrows set status='REFUNDED' where tenant_id=$1 and id=$2",
            [request.tenantId, escrowId],
          );

          return { escrowId, status: "TX_PENDING_REFUND", txHash };
        },
      })
    ).value;
  });
};
