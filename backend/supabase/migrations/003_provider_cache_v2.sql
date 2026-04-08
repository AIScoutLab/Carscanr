create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.provider_vehicle_specs_cache (
  id uuid primary key,
  cache_key text not null unique,
  provider text not null,
  year integer not null,
  vehicle_type text not null check (vehicle_type in ('car', 'motorcycle')),
  normalized_make text not null,
  normalized_model text not null,
  normalized_trim text not null,
  response_json jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  hit_count integer not null default 0,
  last_accessed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_vehicle_values_cache (
  id uuid primary key,
  cache_key text not null unique,
  provider text not null,
  year integer not null,
  normalized_make text not null,
  normalized_model text not null,
  normalized_trim text not null,
  zip_prefix text not null,
  mileage_bucket text not null,
  condition text not null check (condition in ('excellent', 'very_good', 'good', 'fair', 'poor')),
  response_json jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  hit_count integer not null default 0,
  last_accessed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_vehicle_listings_cache (
  id uuid primary key,
  cache_key text not null unique,
  provider text not null,
  year integer not null,
  normalized_make text not null,
  normalized_model text not null,
  normalized_trim text not null,
  zip_code text not null,
  radius_miles integer not null,
  response_json jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  hit_count integer not null default 0,
  last_accessed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_api_usage_logs (
  id uuid primary key,
  provider text not null,
  endpoint_type text not null check (endpoint_type in ('specs', 'values', 'listings')),
  event_type text not null check (event_type in ('cache_hit', 'miss', 'stale_refresh', 'empty_hit', 'provider_error')),
  cache_key text not null,
  request_summary jsonb not null default '{}'::jsonb,
  response_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_provider_vehicle_specs_cache_lookup
  on public.provider_vehicle_specs_cache (year, normalized_make, normalized_model, normalized_trim, vehicle_type);
create index if not exists idx_provider_vehicle_specs_cache_expires_at
  on public.provider_vehicle_specs_cache (expires_at);

create index if not exists idx_provider_vehicle_values_cache_lookup
  on public.provider_vehicle_values_cache (year, normalized_make, normalized_model, normalized_trim, zip_prefix, mileage_bucket, condition);
create index if not exists idx_provider_vehicle_values_cache_expires_at
  on public.provider_vehicle_values_cache (expires_at);

create index if not exists idx_provider_vehicle_listings_cache_lookup
  on public.provider_vehicle_listings_cache (year, normalized_make, normalized_model, normalized_trim, zip_code, radius_miles);
create index if not exists idx_provider_vehicle_listings_cache_expires_at
  on public.provider_vehicle_listings_cache (expires_at);

create index if not exists idx_provider_api_usage_logs_created_at
  on public.provider_api_usage_logs (created_at);
create index if not exists idx_provider_api_usage_logs_provider_endpoint
  on public.provider_api_usage_logs (provider, endpoint_type, created_at desc);

drop trigger if exists set_provider_vehicle_specs_cache_updated_at on public.provider_vehicle_specs_cache;
create trigger set_provider_vehicle_specs_cache_updated_at
before update on public.provider_vehicle_specs_cache
for each row execute function public.set_updated_at();

drop trigger if exists set_provider_vehicle_values_cache_updated_at on public.provider_vehicle_values_cache;
create trigger set_provider_vehicle_values_cache_updated_at
before update on public.provider_vehicle_values_cache
for each row execute function public.set_updated_at();

drop trigger if exists set_provider_vehicle_listings_cache_updated_at on public.provider_vehicle_listings_cache;
create trigger set_provider_vehicle_listings_cache_updated_at
before update on public.provider_vehicle_listings_cache
for each row execute function public.set_updated_at();

create or replace function public.increment_provider_vehicle_specs_cache_hit(target_cache_key text, target_last_accessed_at timestamptz)
returns void
language sql
as $$
  update public.provider_vehicle_specs_cache
  set hit_count = hit_count + 1,
      last_accessed_at = target_last_accessed_at,
      updated_at = target_last_accessed_at
  where cache_key = target_cache_key;
$$;

create or replace function public.increment_provider_vehicle_values_cache_hit(target_cache_key text, target_last_accessed_at timestamptz)
returns void
language sql
as $$
  update public.provider_vehicle_values_cache
  set hit_count = hit_count + 1,
      last_accessed_at = target_last_accessed_at,
      updated_at = target_last_accessed_at
  where cache_key = target_cache_key;
$$;

create or replace function public.increment_provider_vehicle_listings_cache_hit(target_cache_key text, target_last_accessed_at timestamptz)
returns void
language sql
as $$
  update public.provider_vehicle_listings_cache
  set hit_count = hit_count + 1,
      last_accessed_at = target_last_accessed_at,
      updated_at = target_last_accessed_at
  where cache_key = target_cache_key;
$$;
