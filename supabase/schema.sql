-- Financial Portfolio Dashboard — reference PostgreSQL / Supabase schema.
-- Every table holding user data has Row Level Security enabled with an owner policy.
-- Server-side jobs (cron, admin backfills) use the service role, which bypasses RLS;
-- requests made on behalf of a user go through a user-scoped client so RLS applies.

create extension if not exists pgcrypto;

-- ---------- accounts & market data ----------

create table accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  entity        text not null check (entity in ('holding', 'personal')),
  source        text not null check (source in ('ibkr_flex', 'kraken_spot', 'kraken_futures', 'qonto_csv', 'manual')),
  base_currency char(3) not null default 'EUR',
  last_sync_status text check (last_sync_status in ('ok', 'partial_ok', 'error')),
  last_sync_error  text,
  last_synced_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table positions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  account_id       uuid not null references accounts (id) on delete cascade,
  ticker           text not null,
  asset_class      text not null check (asset_class in ('STK', 'ETF', 'FUT', 'CRYPTO_SPOT', 'CRYPTO_PERP')),
  quantity         numeric(28, 10) not null,
  market_price     numeric(28, 10),
  currency         char(4) not null,
  avg_cost_native  numeric(28, 10),          -- entry price in the instrument currency
  cost_basis_eur   numeric(18, 2),           -- spot only: EUR cost at historical FX
  multiplier       numeric(18, 6) not null default 1,
  ownership_pct    numeric(5, 2) not null default 100 check (ownership_pct between 0 and 100),
  price_updated_at timestamptz,
  unique (account_id, ticker)
);

create table cash_balances (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references accounts (id) on delete cascade,
  currency   char(4) not null,
  amount     numeric(18, 2) not null,
  unique (account_id, currency)
);

-- One row per account and day. Written by UPSERT: never judge freshness by created_at.
create table portfolio_snapshots (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    uuid not null references accounts (id) on delete cascade,
  snapshot_date date not null,
  nlv_eur       numeric(18, 2) not null,
  cash_eur      numeric(18, 2) not null,
  updated_at    timestamptz not null default now(),
  unique (account_id, snapshot_date)
);

create table fx_rates (
  rate_date date not null,
  currency  char(3) not null,
  per_eur   numeric(18, 8) not null check (per_eur > 0),  -- ECB convention: 1 EUR = per_eur units
  source    text not null default 'ECB',
  primary key (rate_date, currency)
);

-- ---------- trades ----------

create table trades (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  account_id         uuid not null references accounts (id) on delete cascade,
  external_id        text not null,              -- broker trade id: idempotent upserts, never delete+insert
  traded_at          timestamptz not null,
  ticker             text not null,
  market_type        text not null check (market_type in ('spot', 'futures', 'perp')),
  side               text not null check (side in ('BUY', 'SELL')),
  quantity           numeric(28, 10) not null check (quantity > 0),
  price              numeric(28, 10) not null,
  fee                numeric(18, 8) not null default 0,
  currency           char(4) not null,
  realized_pnl_gross numeric(18, 2),            -- FIFO, before fees
  realized_pnl_net   numeric(18, 2),            -- FIFO, after fees; NULL when cost basis is unknown
  fx_rate_to_eur     numeric(18, 8),
  raw                jsonb,
  unique (account_id, external_id)
);

-- Crypto-to-crypto exchanges booked by the company: each one is a disposal at fair value.
create table crypto_swaps (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  account_id             uuid not null references accounts (id) on delete cascade,
  external_id            text not null,
  swapped_at             timestamptz not null,
  pair                   text not null,
  valuation_eur_snapshot numeric(18, 2),
  valuation_eur_override numeric(18, 2),
  override_note          text,
  needs_review           boolean not null default false,
  unique (account_id, external_id)
);

-- ---------- bookkeeping ----------

create table invoices (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  direction        text not null check (direction in ('purchase', 'sale')),
  party_name       text not null,
  party_country    char(2),
  invoice_number   text not null,
  invoice_date     date not null,
  currency         char(3) not null default 'EUR',
  total_excl_vat   numeric(18, 2) not null,
  vat_amount       numeric(18, 2) not null default 0,
  total_incl_vat   numeric(18, 2) not null,
  vat_regime       text not null check (vat_regime in ('domestic', 'intra_eu_reverse_charge', 'non_eu_import_services')),
  pcg_account      char(6),
  fx_rate_used     numeric(18, 8),
  extraction_status text check (extraction_status in ('ready_to_book', 'needs_review')),
  extraction_issues jsonb,
  file_path        text,                         -- private storage bucket
  unique (user_id, party_name, invoice_number),
  check (abs(total_excl_vat + vat_amount - total_incl_vat) <= 0.02)
);

create table bank_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  account_id      uuid not null references accounts (id) on delete cascade,
  bank_reference  text not null,
  value_date      date not null,
  counterparty    text,
  label           text,
  amount          numeric(18, 2) not null,       -- credit > 0, debit < 0
  currency        char(3) not null default 'EUR',
  qualified_account char(6),                     -- 455000, 512100, ... for non-invoice movements
  matched_invoice_id uuid references invoices (id) on delete set null,
  import_batch    text,
  unique (account_id, bank_reference)
);

create table vat_returns (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  period             char(7) not null,           -- YYYY-MM
  line16_gross_due   numeric(18, 2) not null,
  line22_prev_credit numeric(18, 2) not null,
  line23_deductible  numeric(18, 2) not null,
  line25_credit      numeric(18, 2) not null,
  line26_refund      numeric(18, 2) not null,
  line27_carry_fwd   numeric(18, 2) not null,
  line28_net_due     numeric(18, 2) not null,
  submitted_at       timestamptz,
  submission_ref     text,
  refund_transaction_id uuid references bank_transactions (id),
  unique (user_id, period)
);

-- ---------- broker credentials (read-only keys, encrypted at the application layer) ----------

create table broker_credentials (
  account_id   uuid primary key references accounts (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  key_id       text not null,
  secret_enc   bytea not null,                   -- never returned to the client
  scopes       text[] not null default '{read}',
  pending_reference_code text,                   -- IBKR Flex two-phase request
  pending_requested_at   timestamptz,
  rotated_at   timestamptz not null default now()
);

-- ---------- Row Level Security ----------

do $$
declare t text;
begin
  foreach t in array array['accounts', 'positions', 'cash_balances', 'portfolio_snapshots', 'trades', 'crypto_swaps', 'invoices', 'bank_transactions', 'vat_returns']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_owner', t);
  end loop;
end $$;

-- Credentials: RLS on, and no policy at all → unreachable from any client key.
alter table broker_credentials enable row level security;

-- Reference data: readable by any authenticated user, written by the service role only.
alter table fx_rates enable row level security;
create policy fx_rates_read on fx_rates for select to authenticated using (true);

create index on trades (account_id, ticker, traded_at);
create index on bank_transactions (account_id, value_date);
create index on portfolio_snapshots (user_id, snapshot_date);
