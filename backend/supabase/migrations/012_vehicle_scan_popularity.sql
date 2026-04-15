create table if not exists public.vehicle_scan_popularity (
  id uuid primary key default gen_random_uuid(),
  normalized_key text not null,
  year integer not null,
  normalized_make text not null,
  normalized_model text not null,
  normalized_trim text not null default 'base',
  scan_count integer not null default 0,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_vehicle_scan_popularity_normalized_key
  on public.vehicle_scan_popularity (normalized_key);

create index if not exists idx_vehicle_scan_popularity_scan_count
  on public.vehicle_scan_popularity (scan_count desc);

create index if not exists idx_vehicle_scan_popularity_lookup
  on public.vehicle_scan_popularity (year, normalized_make, normalized_model, normalized_trim);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'set_updated_at'
      and n.nspname = 'public'
  ) then
    execute 'drop trigger if exists set_vehicle_scan_popularity_updated_at on public.vehicle_scan_popularity';
    execute '
      create trigger set_vehicle_scan_popularity_updated_at
      before update on public.vehicle_scan_popularity
      for each row execute function public.set_updated_at()
    ';
  end if;
end
$$;
