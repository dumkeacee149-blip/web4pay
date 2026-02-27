# Web4Pay — Agent-native payments on Base

## One-liner
Web4Pay is a developer-facing payments API for AI agents: **Quote → USDC Escrow → Oracle Release/Auto Refund**, with idempotency, auditability, and risk controls.

## Why this exists
Agents need a programmable way to pay each other without human clicks, while keeping safety rails (limits, allowlists, dispute windows) that stablecoin transfers lack.

## Scope (v1)
- Chain: **Base (8453)**
- Currency: **USDC**
- Payment primitive: **Escrow** (not direct transfer)
- Settlement decision: **Oracle** (platform-controlled) + deadline-based refund
- Integration surface: **REST API + Webhooks**

## Roles
- **Developer (Tenant)**: your customer. Owns API keys, webhooks, limits, and agents.
- **Agent**: an identity under a developer (payer or payee). Has budgets/limits.
- **Wallet**: onchain address associated with an agent (custodied by Web4Pay in v1).
- **Oracle**: service that decides release/refund based on policy + developer signals.

## Primary flows

### 1) Create Quote (merchant/payee side)
1. Payee agent creates a quote with amount, payee address, expiry, deadline, and metadata.
2. Quote is immutable once created.

### 2) Deposit into Escrow (buyer/payer side)
1. Payer agent accepts a quote.
2. Web4Pay executes an onchain deposit of USDC into the Escrow contract.
3. Chain watcher confirms and marks escrow `DEPOSITED`.

### 3) Release or Refund
- **Release**: Oracle releases funds to payee when completion criteria is satisfied.
- **Refund**: Oracle refunds to payer on failure/cancel or automatically after deadline.

## Custody model (v1)
- Web4Pay **custodies agent wallets** (developer-controlled). Agents authenticate via API key and Web4Pay signs transactions.
- Safety: strict limits, allowlists, and an operator freeze switch.

## Non-goals (v1)
- Global consumer chargebacks (card-like) — we provide escrow + refund window instead.
- Fiat on/off-ramp (can be added later).
- Non-custodial wallets (v2+).

## Terminology
- **Quote**: a signed/immutable commercial intent.
- **Escrow**: onchain record + locked funds.
- **Idempotency-Key**: client-provided key to make POST safe to retry.
