# Web4Pay API (`apps/api`)

Minimal Fastify + TypeScript + Postgres API service for Web4Pay v1.

## Prerequisites
- Node.js 20+
- pnpm
- Postgres 14+

## Setup
1. Apply DB migration:
```bash
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
```
2. Install dependencies from repository root:
```bash
pnpm install
```
3. Configure environment variables:
```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/web4pay"
export API_KEYS="dev-token-1,dev-token-2"
export PORT="3000"
```

## Run
- Development:
```bash
pnpm --filter @web4pay/api dev
```
- Build:
```bash
pnpm --filter @web4pay/api build
```
- Start built app:
```bash
pnpm --filter @web4pay/api start
```

## Notes
- All routes require `Authorization: Bearer <token>`, where `<token>` must be present in `API_KEYS`.
- All POST routes require `Idempotency-Key`.
- Idempotent responses are persisted in `idempotency_keys`.
- The API uses the first tenant found in `tenants`; if none exists, it creates a default tenant row.
