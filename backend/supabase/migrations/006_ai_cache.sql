create table if not exists public.cached_analysis (
  id uuid primary key,
  analysis_key text not null unique,
  analysis_type text not null,
  identity_type text,
  identity_value text,
  vin text,
  vin_key text,
  vehicle_key text,
  listing_key text,
  image_key text,
  visual_hash text,
  prompt_version text not null,
  model_name text not null,
  status text not null check (status in ('processing', 'completed', 'failed')),
  result_json jsonb,
  error_text text,
  cost_estimate numeric,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  hit_count integer not null default 0
);

create table if not exists public.image_cache (
  id uuid primary key,
  image_key text not null unique,
  visual_hash text,
  file_width integer,
  file_height integer,
  normalized_vehicle_json jsonb,
  ocr_json jsonb,
  extraction_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  hit_count integer not null default 0
);

create index if not exists idx_cached_analysis_vin_key on public.cached_analysis (vin_key);
create index if not exists idx_cached_analysis_vehicle_key on public.cached_analysis (vehicle_key);
create index if not exists idx_cached_analysis_listing_key on public.cached_analysis (listing_key);
create index if not exists idx_cached_analysis_status on public.cached_analysis (status);
create index if not exists idx_cached_analysis_expires_at on public.cached_analysis (expires_at);

create index if not exists idx_image_cache_visual_hash on public.image_cache (visual_hash);
create index if not exists idx_image_cache_updated_at on public.image_cache (updated_at);

drop trigger if exists set_cached_analysis_updated_at on public.cached_analysis;
create trigger set_cached_analysis_updated_at
before update on public.cached_analysis
for each row execute function public.set_updated_at();

drop trigger if exists set_image_cache_updated_at on public.image_cache;
create trigger set_image_cache_updated_at
before update on public.image_cache
for each row execute function public.set_updated_at();

create or replace function public.increment_cached_analysis_hit(target_analysis_key text, target_last_accessed_at timestamptz)
returns void
language sql
as $$
  update public.cached_analysis
  set hit_count = hit_count + 1,
      last_accessed_at = target_last_accessed_at,
      updated_at = target_last_accessed_at
  where analysis_key = target_analysis_key;
$$;

create or replace function public.increment_image_cache_hit(target_image_key text, target_last_accessed_at timestamptz)
returns void
language sql
as $$
  update public.image_cache
  set hit_count = hit_count + 1,
      last_accessed_at = target_last_accessed_at,
      updated_at = target_last_accessed_at
  where image_key = target_image_key;
$$;
