create table if not exists public.vehicles (
  id text primary key,
  year integer not null,
  make text not null,
  model text not null,
  trim text not null,
  body_style text not null,
  vehicle_type text not null check (vehicle_type in ('car', 'motorcycle')),
  msrp integer not null,
  engine text not null,
  horsepower integer not null,
  torque text not null,
  transmission text not null,
  drivetrain text not null,
  mpg_or_range text not null,
  colors jsonb not null default '[]'::jsonb
);

create table if not exists public.scans (
  id uuid primary key,
  user_id text not null,
  image_url text not null,
  detected_vehicle_type text not null check (detected_vehicle_type in ('car', 'motorcycle')),
  confidence double precision not null,
  created_at timestamptz not null,
  normalized_result jsonb not null,
  candidates jsonb not null
);

create table if not exists public.garage_items (
  id uuid primary key,
  user_id text not null,
  vehicle_id text not null references public.vehicles(id) on delete restrict,
  image_url text not null,
  notes text not null default '',
  favorite boolean not null default false,
  created_at timestamptz not null
);

create table if not exists public.valuations (
  id text primary key,
  vehicle_id text not null references public.vehicles(id) on delete cascade,
  zip text not null,
  mileage integer not null,
  condition text not null,
  trade_in integer not null,
  private_party integer not null,
  dealer_retail integer not null,
  currency text not null default 'USD',
  generated_at timestamptz not null
);

create table if not exists public.listing_results (
  id text primary key,
  vehicle_id text not null references public.vehicles(id) on delete cascade,
  title text not null,
  price integer not null,
  mileage integer not null,
  dealer text not null,
  distance_miles integer not null,
  location text not null,
  image_url text not null,
  listed_at timestamptz not null
);

create table if not exists public.subscriptions (
  id uuid primary key,
  user_id text not null,
  plan text not null check (plan in ('free', 'pro')),
  status text not null check (status in ('active', 'inactive')),
  product_id text null,
  expires_at timestamptz null,
  verified_at timestamptz not null
);

create table if not exists public.usage_counters (
  id uuid primary key,
  user_id text not null,
  date date not null,
  scan_count integer not null default 0,
  last_scan_at timestamptz null,
  recent_attempt_timestamps jsonb not null default '[]'::jsonb,
  unique(user_id, date)
);

create table if not exists public.vision_debug_logs (
  id uuid primary key,
  scan_id uuid not null references public.scans(id) on delete cascade,
  user_id text not null,
  provider text not null,
  raw_response jsonb null,
  normalized_result jsonb null,
  error text null,
  created_at timestamptz not null
);

create index if not exists idx_garage_items_user_id on public.garage_items(user_id);
create index if not exists idx_listing_results_vehicle_id on public.listing_results(vehicle_id);
create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_usage_counters_user_date on public.usage_counters(user_id, date);
create index if not exists idx_scans_user_id on public.scans(user_id);
