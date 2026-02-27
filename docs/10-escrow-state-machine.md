# Escrow State Machine (v1)

This document defines the canonical lifecycle and invariants for Web4Pay escrows.

## Objects
- **Quote** (offchain DB): immutable request to pay.
- **Escrow** (offchain DB + onchain escrowId): holds funds until release/refund.

## States
### Quote
- `QUOTE_CREATED`
- `QUOTE_EXPIRED`
- `QUOTE_CANCELLED` (optional)

### Escrow
- `ESCROW_CREATED` (DB only)
- `TX_PENDING_DEPOSIT`
- `DEPOSITED`
- `RELEASE_REQUESTED`
- `TX_PENDING_RELEASE`
- `RELEASED`
- `REFUND_REQUESTED`
- `TX_PENDING_REFUND`
- `REFUNDED`
- `FAILED`

## Transitions (high level)
1) Quote created
- `POST /v1/quotes` → `QUOTE_CREATED`
- After `expiresAt` → `QUOTE_EXPIRED` (no new escrows allowed)

2) Escrow created + deposit
- `POST /v1/escrows` with `quoteId`
  - Validate policy (limits, allowlists, quote not expired)
  - Create escrow DB row: `ESCROW_CREATED`
  - Enqueue deposit tx: `TX_PENDING_DEPOSIT`
  - Watcher confirms `Deposited` event → `DEPOSITED`

3) Release
- `POST /v1/escrows/{id}/release`
  - Allowed only when `DEPOSITED`
  - Oracle checks completion policy (developer signal, evidence hash, etc.)
  - Move → `TX_PENDING_RELEASE`
  - Watcher confirms `Released` event → `RELEASED`

4) Refund
- `POST /v1/escrows/{id}/refund`
  - Allowed when `DEPOSITED` (or `TX_PENDING_DEPOSIT` with cancellation policy)
  - Oracle checks policy (timeout/cancel)
  - Move → `TX_PENDING_REFUND`
  - Watcher confirms `Refunded` event → `REFUNDED`

## Deadlines & auto-refund
Each escrow has a `deadlineAt`.
- After `deadlineAt`, oracle is permitted to refund to payer.
- Implement a scheduled job: scan `DEPOSITED` escrows past deadline and enqueue refunds.

## Idempotency rules
For any POST that causes side effects:
- Client supplies `Idempotency-Key`.
- Server stores `(tenantId, idempotencyKey) → response`.
- Retries must return the original response.

## Consistency rules
- Offchain state is derived from onchain events.
- If tx submitted but no event within N blocks → mark `FAILED` and allow manual reconciliation.

## Security invariants
- Release can only send funds to `quote.payeeAddress`.
- Refund can only send funds to `quote.payerRefundAddress` (or payer wallet).
- Oracle must not be able to redirect funds.

## Eventing
Emit webhooks on:
- `quote.created`
- `escrow.tx_submitted` (deposit/release/refund)
- `escrow.deposited`
- `escrow.released`
- `escrow.refunded`
- `escrow.failed`
