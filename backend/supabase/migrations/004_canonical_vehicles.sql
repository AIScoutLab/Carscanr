create table if not exists public.canonical_vehicles (
  id uuid primary key,
  year integer not null,
  make text not null,
  model text not null,
  trim text null,
  vehicle_type text null,
  normalized_make text not null,
  normalized_model text not null,
  normalized_trim text null,
  normalized_vehicle_type text null,
  canonical_key text not null unique,
  specs_json jsonb null,
  overview_json jsonb null,
  default_image_url text null,
  source_provider text null,
  source_vehicle_id text null,
  popularity_score integer not null default 0,
  promotion_status text not null default 'candidate',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_promoted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_vehicles_vehicle_type_check check (vehicle_type in ('car', 'motorcycle') or vehicle_type is null),
  constraint canonical_vehicles_promotion_status_check check (promotion_status in ('candidate', 'promoted'))
);

create index if not exists idx_canonical_vehicles_lookup
  on public.canonical_vehicles (year, normalized_make, normalized_model, normalized_trim);
create index if not exists idx_canonical_vehicles_popularity
  on public.canonical_vehicles (popularity_score desc);
create index if not exists idx_canonical_vehicles_promotion_status
  on public.canonical_vehicles (promotion_status);

drop trigger if exists set_canonical_vehicles_updated_at on public.canonical_vehicles;
create trigger set_canonical_vehicles_updated_at
before update on public.canonical_vehicles
for each row execute function public.set_updated_at();

create or replace function public.increment_canonical_vehicle_popularity(target_canonical_key text)
returns void
language sql
as $$
  update public.canonical_vehicles
  set popularity_score = popularity_score + 1,
      last_seen_at = now(),
      updated_at = now()
  where canonical_key = target_canonical_key;
$$;

create or replace function public.promote_canonical_vehicle(target_canonical_key text)
returns void
language sql
as $$
  update public.canonical_vehicles
  set promotion_status = 'promoted',
      last_promoted_at = now(),
      updated_at = now()
  where canonical_key = target_canonical_key;
$$;
