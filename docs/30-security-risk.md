# Security & Risk Controls (v1)

This document enumerates non-negotiable controls for operating a custodied, agent-facing payments platform.

## Threat model (top risks)
- API key theft → attacker drains funds
- Agent prompt injection → unintended payments
- Replay / duplicate requests → double spend
- Oracle abuse → unauthorized release/refund
- Hot wallet compromise
- Webhook spoofing

## Core principles
1) **LLM cannot directly access private keys**. Only platform signer can submit tx.
2) **Non-custodial behavior at contract level**: Oracle cannot redirect funds.
3) **Every state transition is audited**.
4) **Idempotency by default**.

## Mandatory controls

### Authentication & authorization
- API keys are tenant-scoped.
- Rotate/revoke keys.
- Optional: per-agent sub-keys with least privilege.

### Idempotency
- Require `Idempotency-Key` on all POST.
- Store request hash; reject same key with different body (`409`).

### Limits
Per-tenant and per-agent:
- `maxPerTx`
- `maxPerDay`
- `maxPendingEscrows`
- `allowedPayees` allowlist (default ON for early beta)

### Allowlist defaults (recommended for beta)
- Only allow release to `quote.payeeAddress`.
- Only allow refund to `quote.payerWalletAddress`.

### Oracle powers are constrained
Oracle may only:
- Release to payee
- Refund to payer
Oracle cannot set arbitrary recipient.

### Operational kill switches
- Freeze tenant
- Freeze agent
- Freeze all releases (refund-only mode)

### Wallet security (v1)
- Hot wallets are budgeted; keep minimal float.
- Use KMS/MPC as soon as possible.
- Maintain separate signer keys per tenant (or per risk bucket).
- Monitor for abnormal tx patterns.

### Webhook security
- HMAC signed payloads.
- Replay protection: timestamp + max age.

## Audit log schema (minimum)
Store:
- actor (tenantId, apiKeyId, agentId)
- action (create_quote, create_escrow, release, refund)
- request/response hashes
- idempotencyKey
- txHash
- timestamps

## Compliance notes
- Consider KYT for recipient addresses.
- Maintain sanctions list checks.
