# web4pay

Web4Pay is a developer-facing payments API for AI agents on Base: **Quote → USDC Escrow → Oracle Release/Auto Refund**.

## Docs
- Overview: `docs/00-overview.md`
- Escrow lifecycle: `docs/10-escrow-state-machine.md`
- API fields: `docs/20-api-spec.md`
- Security/risk: `docs/30-security-risk.md`

## API Contract
OpenAPI (draft): `spec/openapi.v1.yaml`

## Database
Postgres schema migration: `db/migrations/0001_init.sql`

## Suggested next steps
1) Implement a minimal API service (Fastify/Nest/Next API) that matches the OpenAPI.
2) Deploy Escrow contract on Base + configure USDC address.
3) Build watcher service to index onchain events and update escrow states.
4) Add worker queue for tx execution + webhook delivery retries.
