import { createDbPool } from "./db";

type EscrowRow = {
  id: string;
  quote_id: string;
  updated_at: string;
  deadline_at: string;
  status?: string;
  tenant_id?: string;
  amount_numeric?: string;
  currency?: string;
  payer_agent_id?: string;
};

function isBaseLaunched(): boolean {
  const v = (process.env.BASE_LAUNCHED ?? "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

interface WatcherConfig {
  pollMs: number;
  settleMs: number;
  databaseUrl: string;
}

function loadWatcherConfig(): WatcherConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pollMs = Number.parseInt(process.env.WATCHER_POLL_MS?.trim() ?? "3000", 10);
  if (!Number.isFinite(pollMs) || pollMs < 200) {
    throw new Error(`Invalid WATCHER_POLL_MS value: ${process.env.WATCHER_POLL_MS}`);
  }

  const settleMs = Number.parseInt(process.env.WATCHER_SETTLE_MS?.trim() ?? "1500", 10);
  if (!Number.isFinite(settleMs) || settleMs < 100) {
    throw new Error(`Invalid WATCHER_SETTLE_MS value: ${process.env.WATCHER_SETTLE_MS}`);
  }

  return { pollMs, settleMs, databaseUrl };
}

function hasExpired(isoDate: string, ms: number): boolean {
  const deadline = new Date(isoDate);
  if (Number.isNaN(deadline.getTime())) {
    return false;
  }
  return Date.now() - deadline.getTime() >= ms;
}


async function issueYieldToken(pool: any, escrowRow: { id: string; tenant_id: string; quote_id: string; amount_numeric: string; currency: string; payer_agent_id: string }) {
  const principal = Number(escrowRow.amount_numeric);
  if (!Number.isFinite(principal) || principal <= 0) {
    return;
  }

  // Interest model: bank-like demo yield, configurable by YIELD_RATE_BPS (basis points).
  const bpsText = process.env.YIELD_RATE_BPS?.trim();
  const bps = bpsText && Number.isFinite(Number(bpsText)) && Number(bpsText) >= 0 ? Number(bpsText) : 500; // default 5%
  const exchangeRate = bps / 10000;
  const yieldAmount = Number((principal * exchangeRate).toFixed(18));
  if (yieldAmount <= 0) {
    return;
  }

  await pool.query(
    "insert into yield_balances (tenant_id, agent_id, token_symbol, amount_numeric, minted_total) values ($1, $2, 'YIELD', $3, $3) on conflict (tenant_id, agent_id, token_symbol) do update set amount_numeric = yield_balances.amount_numeric + $3, minted_total = yield_balances.minted_total + $3",
    [escrowRow.tenant_id, escrowRow.payer_agent_id, yieldAmount.toString()],
  );

  await pool.query(
    "insert into yield_ledger (tenant_id, agent_id, escrow_id, action, amount_numeric, token_symbol, source_currency, exchange_rate, tx_hash, meta) values ($1, $2, $3, 'MINT', $4, 'YIELD', 'USDC', $5, $6, $7) on conflict (tenant_id, escrow_id, action) do nothing",
    [
      escrowRow.tenant_id,
      escrowRow.payer_agent_id,
      escrowRow.id,
      yieldAmount.toString(),
      exchangeRate,
      null,
      JSON.stringify({ principal: escrowRow.amount_numeric, bps, reason: 'interest from release', autoMint: true }),
    ],
  );
}

async function burnYieldIfRefundedBeforeBaseLaunch(pool: any, row: { tenant_id: string; id: string; payer_agent_id: string }) {
  if (isBaseLaunched()) return;

  const minted = await pool.query<{ amount_numeric: string }>(
    "select amount_numeric from yield_ledger where tenant_id = $1 and escrow_id = $2 and action = 'MINT' limit 1",
    [row.tenant_id, row.id],
  );

  const amount = Number(minted.rows[0]?.amount_numeric ?? "0");
  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }

  await pool.query(
    "insert into yield_ledger (tenant_id, agent_id, escrow_id, action, amount_numeric, token_symbol, source_currency, exchange_rate, tx_hash, meta) values ($1, $2, $3, 'BURN', $4, 'YIELD', 'USDC', 1, null, $5) on conflict (tenant_id, escrow_id, action) do nothing",
    [row.tenant_id, row.payer_agent_id, row.id, amount.toString(), JSON.stringify({ reason: 'principal withdrawn before base launch' })],
  );

  await pool.query(
    "update yield_balances set amount_numeric = greatest(0, amount_numeric - $3) where tenant_id = $1 and agent_id = $2 and token_symbol = 'YIELD'",
    [row.tenant_id, row.payer_agent_id, amount.toString()],
  );
}

async function processEscrows(pool: any, settleMs: number) {
  const settleAtClause = new Date(Date.now() - settleMs).toISOString();

  const pendingDeposits = (await pool.query(
    "select id, quote_id, updated_at, deadline_at from escrows where status = $1 and updated_at <= $2",
    ["TX_PENDING_DEPOSIT", settleAtClause],
  )) as { rows: EscrowRow[] };

  const pendingReleases = (await pool.query(
    "select e.id, e.quote_id, e.updated_at, e.deadline_at, e.tenant_id, e.amount_numeric, e.currency, q.payer_agent_id from escrows e join quotes q on q.id = e.quote_id where e.status = $1 and e.updated_at <= $2",
    ["TX_PENDING_RELEASE", settleAtClause],
  )) as { rows: Array<EscrowRow & { tenant_id: string; amount_numeric: string; currency: string; payer_agent_id: string }> };

  const pendingRefunds = (await pool.query(
    "select e.id, e.quote_id, e.updated_at, e.deadline_at, e.tenant_id, q.payer_agent_id from escrows e join quotes q on q.id = e.quote_id where e.status = $1 and e.updated_at <= $2",
    ["TX_PENDING_REFUND", settleAtClause],
  )) as { rows: Array<EscrowRow & { tenant_id: string; payer_agent_id: string }> };

  for (const row of pendingDeposits.rows) {
    await pool.query("update escrows set status = $1 where id = $2", ["DEPOSITED", row.id]);
    console.log(JSON.stringify({ event: "watcher.deposited", escrowId: row.id, quoteId: row.quote_id }));
  }

  for (const row of pendingReleases.rows) {
    await pool.query("update escrows set status = $1 where id = $2", ["RELEASED", row.id]);
    await issueYieldToken(pool, row);
    console.log(JSON.stringify({ event: "watcher.released", escrowId: row.id, quoteId: row.quote_id }));
  }

  for (const row of pendingRefunds.rows) {
    await pool.query("update escrows set status = $1 where id = $2", ["REFUNDED", row.id]);
    await burnYieldIfRefundedBeforeBaseLaunch(pool, row);
    console.log(JSON.stringify({ event: "watcher.refunded", escrowId: row.id, quoteId: row.quote_id, yieldBurnedWhenBaseUnlaunched: !isBaseLaunched() }));
  }

  const missedDepositEscrows = (await pool.query(
    "select id, quote_id, updated_at, deadline_at from escrows where status in ($1, $2) and deadline_at <= $3",
    ["DEPOSITED", "TX_PENDING_DEPOSIT", new Date().toISOString()],
  )) as { rows: EscrowRow[] };

  for (const row of missedDepositEscrows.rows) {
    // Auto-refund for matured escrows that remain in a terminal-safe state.
    if (hasExpired(row.deadline_at, 0)) {
      await pool.query(
        "update escrows set status = $1, failure_reason = $2 where id = $3 and status = $4",
        ["TX_PENDING_REFUND", "deadline exceeded; auto-refund", row.id, row.status],
      );
      console.log(JSON.stringify({ event: "watcher.refund-auto-queued", escrowId: row.id, quoteId: row.quote_id }));
    }
  }
}

async function main() {
  const config = loadWatcherConfig();
  const pool = createDbPool(config.databaseUrl);
  console.log(JSON.stringify({ event: "watcher.start", pollMs: config.pollMs, settleMs: config.settleMs }));

  while (true) {
    try {
      await processEscrows(pool, config.settleMs);
    } catch (err) {
      console.error("watcher error", err);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
