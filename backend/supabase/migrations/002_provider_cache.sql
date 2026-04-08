create table if not exists public.provider_specs_cache (
  id uuid primary key,
  cache_key text not null unique,
  response_payload jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  provider_name text not null
);

create table if not exists public.provider_values_cache (
  id uuid primary key,
  cache_key text not null unique,
  response_payload jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  provider_name text not null
);

create table if not exists public.provider_listings_cache (
  id uuid primary key,
  cache_key text not null unique,
  response_payload jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  provider_name text not null
);

create index if not exists idx_provider_specs_cache_expires_at on public.provider_specs_cache(expires_at);
create index if not exists idx_provider_values_cache_expires_at on public.provider_values_cache(expires_at);
create index if not exists idx_provider_listings_cache_expires_at on public.provider_listings_cache(expires_at);
