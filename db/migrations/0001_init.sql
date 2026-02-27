-- Web4Pay v1 initial schema
-- Postgres 14+

create extension if not exists pgcrypto;

-- Tenants / Developers
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- API keys (store hashed)
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text,
  key_hash text not null,
  last4 text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists api_keys_tenant_id_idx on api_keys(tenant_id);

-- Idempotency keys
create table if not exists idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  request_hash text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

-- Agents (custodied wallets in v1)
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  wallet_address text not null,
  metadata jsonb not null default '{}'::jsonb,
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, wallet_address)
);
create index if not exists agents_tenant_id_idx on agents(tenant_id);

-- Quotes
create type quote_status as enum ('QUOTE_CREATED','QUOTE_EXPIRED','QUOTE_CANCELLED');

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  payer_agent_id uuid not null references agents(id),
  payee_address text not null,
  amount_numeric numeric(78, 18) not null,
  currency text not null default 'USDC',
  order_id text,
  metadata jsonb not null default '{}'::jsonb,
  quote_hash text not null,
  status quote_status not null default 'QUOTE_CREATED',
  expires_at timestamptz not null,
  deadline_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, quote_hash)
);
create index if not exists quotes_tenant_id_idx on quotes(tenant_id);
create index if not exists quotes_payer_agent_id_idx on quotes(payer_agent_id);

-- Escrows
create type escrow_status as enum (
  'ESCROW_CREATED',
  'TX_PENDING_DEPOSIT',
  'DEPOSITED',
  'RELEASE_REQUESTED',
  'TX_PENDING_RELEASE',
  'RELEASED',
  'REFUND_REQUESTED',
  'TX_PENDING_REFUND',
  'REFUNDED',
  'FAILED'
);

create table if not exists escrows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_id uuid not null references quotes(id),
  payer_address text not null,
  payee_address text not null,
  amount_numeric numeric(78, 18) not null,
  currency text not null default 'USDC',
  status escrow_status not null,
  onchain_escrow_id numeric(78,0),
  deposit_tx_hash text,
  release_tx_hash text,
  refund_tx_hash text,
  deadline_at timestamptz not null,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, quote_id)
);
create index if not exists escrows_tenant_id_idx on escrows(tenant_id);
create index if not exists escrows_status_deadline_idx on escrows(status, deadline_at);

-- Ledger (double-entry-ish minimal)
create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  escrow_id uuid references escrows(id),
  entry_type text not null, -- deposit|release|refund|fee|adjust
  amount_numeric numeric(78,18) not null,
  currency text not null default 'USDC',
  tx_hash text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ledger_entries_tenant_id_idx on ledger_entries(tenant_id);
create index if not exists ledger_entries_escrow_id_idx on ledger_entries(escrow_id);

-- Audit log
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_api_key_id uuid references api_keys(id),
  actor_agent_id uuid references agents(id),
  action text not null,
  target_type text,
  target_id uuid,
  request_hash text,
  idempotency_key text,
  tx_hash text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_tenant_id_idx on audit_log(tenant_id);

-- Webhooks
create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  url text not null,
  secret text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending', -- pending|success|failed
  attempt_count int not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_tenant_status_idx on webhook_deliveries(tenant_id, status);

-- Utility trigger to keep updated_at fresh
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'escrows_touch_updated_at'
  ) then
    create trigger escrows_touch_updated_at
    before update on escrows
    for each row execute function touch_updated_at();
  end if;
end;
$$;
