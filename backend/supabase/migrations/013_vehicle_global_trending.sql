create table if not exists public.vehicle_global_trending (
  id uuid primary key default gen_random_uuid(),
  normalized_key text not null,
  year integer not null,
  normalized_make text not null,
  normalized_model text not null,
  normalized_trim text not null default 'base',
  global_scan_count integer not null default 0,
  recent_scan_count integer not null default 0,
  trend_score double precision not null default 0,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_vehicle_global_trending_normalized_key
  on public.vehicle_global_trending (normalized_key);

create index if not exists idx_vehicle_global_trending_score
  on public.vehicle_global_trending (trend_score desc);

create index if not exists idx_vehicle_global_trending_lookup
  on public.vehicle_global_trending (year, normalized_make, normalized_model, normalized_trim);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'set_updated_at'
      and n.nspname = 'public'
  ) then
    execute 'drop trigger if exists set_vehicle_global_trending_updated_at on public.vehicle_global_trending';
    execute '
      create trigger set_vehicle_global_trending_updated_at
      before update on public.vehicle_global_trending
      for each row execute function public.set_updated_at()
    ';
  end if;
end
$$;
