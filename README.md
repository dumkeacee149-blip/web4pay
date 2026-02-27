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
1) Run the local stack with Docker Compose (Postgres + API).
2) Deploy Escrow contract on Base + configure USDC address.
3) Build watcher service to index onchain events and update escrow states.
4) Add worker queue for tx execution + webhook delivery retries.

## Local dev (Docker)

1) Copy environment template:

```bash
cp .env.example .env
# edit .env (do NOT commit secrets)
```

2) Start:

```bash
docker compose up --build
```

- API: http://localhost:3000
- Default API key (from docker-compose): `dev-token-1`
- Web UI: http://localhost:8080

By default `ONCHAIN_ENABLED` is off (`0`), so `/v1/escrows` runs in mock mode.

A lightweight watcher is included (`watcher` service) to settle mocked on-chain state:
- `TX_PENDING_DEPOSIT -> DEPOSITED`
- `TX_PENDING_RELEASE -> RELEASED`
- `TX_PENDING_REFUND -> REFUNDED`

### UI 风格说明

Web UI 采用**赛博像素 + 卡通风**（非科幻）：
- 粗边框像素化卡片
- 亮荧光线条与低饱和色块
- 圆润卡通按钮与表情标签
- 低调扫描线效果

Test:

```bash
curl -s http://localhost:3000/v1/chain \
  -H 'Authorization: Bearer dev-token-1'
```
