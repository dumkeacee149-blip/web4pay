# Database

- Migrations live in `db/migrations/`.
- Target: Postgres 14+

Apply:

```sql
\i db/migrations/0001_init.sql
```

Notes:
- This schema assumes a custodied-wallet model (v1).
- Idempotency is persisted in `idempotency_keys`.
- Escrow state is tracked in `escrows.status` and derived from onchain events.
