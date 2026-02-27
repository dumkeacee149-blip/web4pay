import { createDbPool } from "./db";

type EscrowRow = {
  id: string;
  quote_id: string;
  updated_at: string;
  deadline_at: string;
  status: string;
};

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

async function processEscrows(pool: any, settleMs: number) {
  const settleAtClause = new Date(Date.now() - settleMs).toISOString();

  const pendingDeposits = (await pool.query(
    "select id, quote_id, updated_at, deadline_at from escrows where status = $1 and updated_at <= $2",
    ["TX_PENDING_DEPOSIT", settleAtClause],
  )) as { rows: EscrowRow[] };

  const pendingReleases = (await pool.query(
    "select id, quote_id, updated_at, deadline_at from escrows where status = $1 and updated_at <= $2",
    ["TX_PENDING_RELEASE", settleAtClause],
  )) as { rows: EscrowRow[] };

  const pendingRefunds = (await pool.query(
    "select id, quote_id, updated_at, deadline_at from escrows where status = $1 and updated_at <= $2",
    ["TX_PENDING_REFUND", settleAtClause],
  )) as { rows: EscrowRow[] };

  for (const row of pendingDeposits.rows) {
    await pool.query("update escrows set status = $1 where id = $2", ["DEPOSITED", row.id]);
    console.log(JSON.stringify({ event: "watcher.deposited", escrowId: row.id, quoteId: row.quote_id }));
  }

  for (const row of pendingReleases.rows) {
    await pool.query("update escrows set status = $1 where id = $2", ["RELEASED", row.id]);
    console.log(JSON.stringify({ event: "watcher.released", escrowId: row.id, quoteId: row.quote_id }));
  }

  for (const row of pendingRefunds.rows) {
    await pool.query("update escrows set status = $1 where id = $2", ["REFUNDED", row.id]);
    console.log(JSON.stringify({ event: "watcher.refunded", escrowId: row.id, quoteId: row.quote_id }));
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
