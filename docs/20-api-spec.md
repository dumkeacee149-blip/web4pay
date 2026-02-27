# API Spec (v1) — REST + Webhooks

Base URL: `https://api.web4pay.example` (placeholder)

## Auth
All requests:
- `Authorization: Bearer <API_KEY>`

All POST requests:
- `Idempotency-Key: <uuid>`

## Common response envelope
We recommend plain JSON without envelope for simplicity. Errors use RFC7807-style.

## Errors
- `400 invalid_request`
- `401 unauthorized`
- `403 forbidden`
- `404 not_found`
- `409 conflict` (idempotency mismatch / invalid state transition)
- `429 rate_limited`
- `500 internal`

## Endpoints

### GET /v1/chain
Returns chain config.

Response
```json
{ "chainId": 8453, "name": "base", "currency": "USDC", "contracts": {"escrow": "0x...", "usdc": "0x..."} }
```

### POST /v1/agents
Create an agent identity and custodied wallet.

Request
```json
{ "name": "agent-a", "metadata": {} }
```

Response
```json
{ "agentId": "ag_...", "walletAddress": "0x..." }
```

### POST /v1/quotes
Create an immutable quote.

Request
```json
{
  "payerAgentId": "ag_payer",
  "payeeAddress": "0xPayee",
  "amount": "12.34",
  "currency": "USDC",
  "expiresInSec": 600,
  "deadlineInSec": 3600,
  "orderId": "ord_123",
  "metadata": {"purpose":"content_gen"}
}
```

Response
```json
{
  "quoteId": "qt_...",
  "status": "QUOTE_CREATED",
  "expiresAt": "2026-02-27T00:00:00Z",
  "deadlineAt": "2026-02-27T00:50:00Z",
  "quoteHash": "0x..."
}
```

### POST /v1/escrows
Create escrow and deposit onchain.

Request
```json
{ "quoteId": "qt_..." }
```

Response
```json
{
  "escrowId": "es_...",
  "status": "TX_PENDING_DEPOSIT",
  "txHash": "0x..."
}
```

### GET /v1/escrows/{escrowId}
Fetch status.

Response
```json
{
  "escrowId": "es_...",
  "quoteId": "qt_...",
  "status": "DEPOSITED",
  "amount": "12.34",
  "currency": "USDC",
  "payer": "0x...",
  "payee": "0x...",
  "txHashes": {"deposit":"0x...","release":null,"refund":null}
}
```

### POST /v1/escrows/{escrowId}/release
Request release (oracle policy enforced).

Request
```json
{ "deliverableHash": "0x...", "evidence": {"url":"...","hash":"0x..."} }
```

Response
```json
{ "escrowId": "es_...", "status": "TX_PENDING_RELEASE", "txHash": "0x..." }
```

### POST /v1/escrows/{escrowId}/refund
Request refund.

Request
```json
{ "reason": "timeout" }
```

Response
```json
{ "escrowId": "es_...", "status": "TX_PENDING_REFUND", "txHash": "0x..." }
```

## Webhooks
Developers register endpoints and receive signed events.

### Event types
- `quote.created`
- `escrow.tx_submitted`
- `escrow.deposited`
- `escrow.released`
- `escrow.refunded`
- `escrow.failed`

### Payload
```json
{
  "id": "evt_...",
  "type": "escrow.deposited",
  "createdAt": "...",
  "data": { "escrowId": "es_...", "txHash": "0x..." }
}
```

### Signing
- Header: `X-Web4Pay-Signature: t=...,v1=...`
- HMAC-SHA256 over raw body using developer webhook secret.
