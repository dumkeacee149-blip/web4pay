import Fastify from "fastify";
import { loadConfig } from "./config";
import { createDbPool, ensureDefaultTenant } from "./db";
import authPlugin from "./auth";
import { ApiError, problemForRequest } from "./errors";
import { makeRequestHash, randomAddress, randomTxHash, randomUint64String } from "./lib/crypto";
import {
  assertIdempotencyKeyPresent,
  loadIdempotency,
  saveIdempotency,
} from "./idempotency";
import {
  requireAmount,
  requireEthAddress,
  requireInt,
  requireString,
} from "./validators";

async function main() {
  const config = loadConfig();
  const pool = createDbPool(config.databaseUrl);
  const tenantId = await ensureDefaultTenant(pool);

  const app = Fastify({ logger: true });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ApiError) {
      const problem = problemForRequest(request, {
        status: err.statusCode,
        title: err.message,
        detail: err.detail,
        code: err.code,
        type: err.type,
      });
      reply
        .code(err.statusCode)
        .type("application/problem+json")
        .send(problem);
      return;
    }

    request.log.error({ err }, "Unhandled error");
    const problem = problemForRequest(request, {
      status: 500,
      title: "Internal Server Error",
      code: "internal",
    });
    reply.code(500).type("application/problem+json").send(problem);
  });

  await app.register(authPlugin, { apiKeys: config.apiKeys, tenantId });

  // GET /v1/chain
  app.get("/v1/chain", async () => {
    const escrow = process.env.ESCROW_ADDRESS?.trim() || "0x0000000000000000000000000000000000000000";
    const usdc = process.env.USDC_ADDRESS?.trim() || "0x0000000000000000000000000000000000000000";
    return {
      chainId: 8453,
      name: "base",
      currency: "USDC",
      contracts: {
        escrow,
        usdc,
      },
    };
  });

  // POST helpers: idempotency
  async function withIdempotency<T>(
    request: any,
    reply: any,
    handler: () => Promise<T>,
  ): Promise<T> {
    const key = request.headers["idempotency-key"] as string | undefined;
    assertIdempotencyKeyPresent(key);

    const requestHash = makeRequestHash({
      method: request.method,
      url: request.routerPath ?? request.url,
      body: request.body ?? null,
    });

    const existing = await loadIdempotency(pool, request.tenantId, key!);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(409, "Idempotency-Key reuse with different payload", {
          code: "conflict",
          detail:
            "The same Idempotency-Key was used with a different request payload.",
        });
      }
      reply.header("Idempotency-Replayed", "true");
      return existing.responseJson as T;
    }

    const result = await handler();
    await saveIdempotency(pool, request.tenantId, key!, requestHash, result);
    return result;
  }

  // POST /v1/agents
  app.post("/v1/agents", async (request, reply) => {
    return await withIdempotency(request, reply, async () => {
      const body = (request.body ?? {}) as any;
      const name = requireString("name", body.name);
      const metadata = typeof body.metadata === "object" && body.metadata ? body.metadata : {};
      const walletAddress = randomAddress();

      const inserted = await pool.query<{ id: string; created_at: string }>(
        "insert into agents (tenant_id, name, wallet_address, metadata) values ($1, $2, $3, $4) returning id, created_at",
        [request.tenantId, name, walletAddress, metadata],
      );

      const row = inserted.rows[0];
      return {
        agentId: `ag_${row.id}`,
        name,
        walletAddress,
        createdAt: new Date(row.created_at).toISOString(),
        metadata,
      };
    });
  });

  // POST /v1/quotes
  app.post("/v1/quotes", async (request, reply) => {
    return await withIdempotency(request, reply, async () => {
      const body = (request.body ?? {}) as any;
      const payerAgentIdRaw = requireString("payerAgentId", body.payerAgentId);
      const payerAgentId = payerAgentIdRaw.replace(/^ag_/, "");
      const payeeAddress = requireEthAddress("payeeAddress", body.payeeAddress);
      const amount = requireAmount(body.amount);
      const currency = requireString("currency", body.currency);
      if (currency !== "USDC") {
        throw new ApiError(400, "Invalid currency", {
          code: "invalid_request",
          detail: "Only USDC is supported in v1",
        });
      }
      const expiresInSec = requireInt("expiresInSec", body.expiresInSec, 1);
      const deadlineInSec = requireInt("deadlineInSec", body.deadlineInSec, 60);
      const orderId = typeof body.orderId === "string" ? body.orderId : null;
      const metadata = typeof body.metadata === "object" && body.metadata ? body.metadata : {};

      // validate agent exists
      const agentRes = await pool.query<{ id: string }>(
        "select id from agents where tenant_id = $1 and id = $2",
        [request.tenantId, payerAgentId],
      );
      if ((agentRes.rowCount ?? 0) === 0) {
        throw new ApiError(404, "payerAgentId not found", {
          code: "not_found",
        });
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + expiresInSec * 1000);
      const deadlineAt = new Date(now.getTime() + deadlineInSec * 1000);

      const quoteHash = `0x${makeRequestHash({
        tenant: request.tenantId,
        payerAgentId,
        payeeAddress,
        amount,
        currency,
        expiresAt: expiresAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        orderId,
        metadata,
      })}`;

      const inserted = await pool.query<{ id: string; created_at: string }>(
        "insert into quotes (tenant_id, payer_agent_id, payee_address, amount_numeric, currency, order_id, metadata, quote_hash, expires_at, deadline_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, created_at",
        [
          request.tenantId,
          payerAgentId,
          payeeAddress,
          amount,
          currency,
          orderId,
          metadata,
          quoteHash,
          expiresAt,
          deadlineAt,
        ],
      );

      const row = inserted.rows[0];
      return {
        quoteId: `qt_${row.id}`,
        status: "QUOTE_CREATED",
        payerAgentId: payerAgentIdRaw,
        payeeAddress,
        amount,
        currency,
        expiresAt: expiresAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        orderId: orderId ?? undefined,
        metadata,
        quoteHash,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  });

  // POST /v1/escrows
  app.post("/v1/escrows", async (request, reply) => {
    return await withIdempotency(request, reply, async () => {
      const body = (request.body ?? {}) as any;
      const quoteIdRaw = requireString("quoteId", body.quoteId);
      const quoteId = quoteIdRaw.replace(/^qt_/, "");

      const quoteRes = await pool.query<{
        id: string;
        payer_agent_id: string;
        payee_address: string;
        amount_numeric: string;
        currency: string;
        expires_at: string;
        deadline_at: string;
      }>(
        "select id, payer_agent_id, payee_address, amount_numeric, currency, expires_at, deadline_at from quotes where tenant_id = $1 and id = $2",
        [request.tenantId, quoteId],
      );
      if ((quoteRes.rowCount ?? 0) === 0) {
        throw new ApiError(404, "quoteId not found", { code: "not_found" });
      }
      const q = quoteRes.rows[0];
      if (new Date(q.expires_at).getTime() <= Date.now()) {
        throw new ApiError(409, "Quote expired", {
          code: "conflict",
        });
      }

      const payerAgentRes = await pool.query<{ wallet_address: string }>(
        "select wallet_address from agents where tenant_id = $1 and id = $2",
        [request.tenantId, q.payer_agent_id],
      );
      const payerAddress = payerAgentRes.rows[0]?.wallet_address;
      if (!payerAddress) {
        throw new ApiError(500, "Missing payer wallet", { code: "internal" });
      }

      // Default: mock tx
      let onchainEscrowId = randomUint64String();
      let txHash = randomTxHash();

      if (config.onchainEnabled) {
        const { loadChainConfig, makeClients } = await import("./onchain");
        const { createDealApproveDeposit } = await import("./onchain_escrow");

        const chainCfg = loadChainConfig();
        const { publicClient, walletClient } = makeClients(chainCfg);

        const { dealId, txHash: depositTx } = await createDealApproveDeposit({
          publicClient,
          walletClient,
          escrowAddress: chainCfg.escrowAddress,
          usdcAddress: chainCfg.usdcAddress,
          payeeAddress: q.payee_address as any,
          amountDecimal: q.amount_numeric,
          deadlineAt: new Date(q.deadline_at),
          quoteId: quoteIdRaw,
        });

        onchainEscrowId = dealId.toString(10);
        txHash = depositTx;
      }

      const inserted = await pool.query<{ id: string }>(
        "insert into escrows (tenant_id, quote_id, payer_address, payee_address, amount_numeric, currency, status, onchain_escrow_id, deposit_tx_hash, deadline_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
        [
          request.tenantId,
          quoteId,
          payerAddress,
          q.payee_address,
          q.amount_numeric,
          q.currency,
          "TX_PENDING_DEPOSIT",
          onchainEscrowId,
          txHash,
          q.deadline_at,
        ],
      );

      const row = inserted.rows[0];
      return {
        escrowId: `es_${row.id}`,
        status: "TX_PENDING_DEPOSIT",
        txHash,
      };
    });
  });

  // GET /v1/escrows/:escrowId
  app.get("/v1/escrows/:escrowId", async (request) => {
    const escrowIdRaw = (request.params as any).escrowId as string;
    const escrowId = escrowIdRaw.replace(/^es_/, "");

    const res = await pool.query<any>(
      "select id, quote_id, status, amount_numeric, currency, payer_address, payee_address, onchain_escrow_id, deposit_tx_hash, release_tx_hash, refund_tx_hash, deadline_at, created_at, updated_at from escrows where tenant_id = $1 and id = $2",
      [request.tenantId, escrowId],
    );
    if ((res.rowCount ?? 0) === 0) {
      throw new ApiError(404, "escrow not found", { code: "not_found" });
    }
    const e = res.rows[0];
    return {
      escrowId: `es_${e.id}`,
      quoteId: `qt_${e.quote_id}`,
      status: e.status,
      amount: String(e.amount_numeric),
      currency: e.currency,
      payerAddress: e.payer_address,
      payeeAddress: e.payee_address,
      onchainEscrowId: e.onchain_escrow_id ? String(e.onchain_escrow_id) : null,
      deadlineAt: new Date(e.deadline_at).toISOString(),
      txHashes: {
        deposit: e.deposit_tx_hash ?? null,
        release: e.release_tx_hash ?? null,
        refund: e.refund_tx_hash ?? null,
      },
      createdAt: new Date(e.created_at).toISOString(),
      updatedAt: new Date(e.updated_at).toISOString(),
    };
  });

  async function requireEscrowForUpdate(tenantId: string, escrowId: string) {
    const res = await pool.query<any>(
      "select id, status from escrows where tenant_id = $1 and id = $2",
      [tenantId, escrowId],
    );
    if ((res.rowCount ?? 0) === 0) {
      throw new ApiError(404, "escrow not found", { code: "not_found" });
    }
    return res.rows[0] as { id: string; status: string };
  }

  // POST /v1/escrows/:escrowId/release
  app.post("/v1/escrows/:escrowId/release", async (request, reply) => {
    return await withIdempotency(request, reply, async () => {
      const escrowIdRaw = (request.params as any).escrowId as string;
      const escrowId = escrowIdRaw.replace(/^es_/, "");
      const body = (request.body ?? {}) as any;
      const deliverableHash = requireString("deliverableHash", body.deliverableHash);

      const escrow = await requireEscrowForUpdate(request.tenantId, escrowId);
      if (escrow.status !== "DEPOSITED" && escrow.status !== "TX_PENDING_DEPOSIT") {
        throw new ApiError(409, "Escrow not releasable in current state", {
          code: "conflict",
        });
      }

      const txHash = randomTxHash();
      await pool.query(
        "update escrows set status = $1, release_tx_hash = $2 where tenant_id = $3 and id = $4",
        ["TX_PENDING_RELEASE", txHash, request.tenantId, escrowId],
      );

      // For now, do not auto-finalize to RELEASED; watcher will do in real impl.
      return {
        escrowId: `es_${escrowId}`,
        status: "TX_PENDING_RELEASE",
        txHash,
        deliverableHash,
      };
    });
  });

  // POST /v1/escrows/:escrowId/refund
  app.post("/v1/escrows/:escrowId/refund", async (request, reply) => {
    return await withIdempotency(request, reply, async () => {
      const escrowIdRaw = (request.params as any).escrowId as string;
      const escrowId = escrowIdRaw.replace(/^es_/, "");
      const body = (request.body ?? {}) as any;
      const reason = requireString("reason", body.reason);

      const escrow = await requireEscrowForUpdate(request.tenantId, escrowId);
      if (escrow.status !== "DEPOSITED" && escrow.status !== "TX_PENDING_DEPOSIT") {
        throw new ApiError(409, "Escrow not refundable in current state", {
          code: "conflict",
        });
      }

      const txHash = randomTxHash();
      await pool.query(
        "update escrows set status = $1, refund_tx_hash = $2 where tenant_id = $3 and id = $4",
        ["TX_PENDING_REFUND", txHash, request.tenantId, escrowId],
      );

      return {
        escrowId: `es_${escrowId}`,
        status: "TX_PENDING_REFUND",
        txHash,
        reason,
      };
    });
  });

  // convenience dev endpoint to mark deposit confirmed (not in spec)
  app.post("/internal/dev/escrows/:escrowId/markDeposited", async (request) => {
    const escrowIdRaw = (request.params as any).escrowId as string;
    const escrowId = escrowIdRaw.replace(/^es_/, "");
    await pool.query(
      "update escrows set status = $1 where tenant_id = $2 and id = $3",
      ["DEPOSITED", request.tenantId, escrowId],
    );
    return { ok: true };
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`web4pay api listening on :${config.port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
