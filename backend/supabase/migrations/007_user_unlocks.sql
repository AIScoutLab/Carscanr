create table if not exists public.user_unlock_balances (
  user_id text primary key,
  free_unlocks_total integer not null default 5,
  free_unlocks_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_vehicle_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  unlock_key text not null,
  unlock_type text not null,
  vin text,
  vin_key text,
  vehicle_key text,
  listing_key text,
  source_vehicle_id text,
  scan_id uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_user_vehicle_unlocks_user_key
  on public.user_vehicle_unlocks (user_id, unlock_key);

create index if not exists idx_user_vehicle_unlocks_user_id
  on public.user_vehicle_unlocks (user_id);
create index if not exists idx_user_vehicle_unlocks_vehicle_key
  on public.user_vehicle_unlocks (vehicle_key);
create index if not exists idx_user_vehicle_unlocks_vin_key
  on public.user_vehicle_unlocks (vin_key);
create index if not exists idx_user_vehicle_unlocks_listing_key
  on public.user_vehicle_unlocks (listing_key);

drop trigger if exists set_user_unlock_balances_updated_at on public.user_unlock_balances;
create trigger set_user_unlock_balances_updated_at
before update on public.user_unlock_balances
for each row execute function public.set_updated_at();

create or replace function public.grant_user_vehicle_unlock(
  p_user_id text,
  p_unlock_key text,
  p_unlock_type text,
  p_vin text,
  p_vin_key text,
  p_vehicle_key text,
  p_listing_key text,
  p_source_vehicle_id text,
  p_scan_id uuid
)
returns table (
  allowed boolean,
  already_unlocked boolean,
  used_unlock boolean,
  free_unlocks_total integer,
  free_unlocks_used integer,
  free_unlocks_remaining integer
)
language plpgsql
as $$
declare
  balance record;
  existing record;
begin
  insert into public.user_unlock_balances (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into balance
  from public.user_unlock_balances
  where user_id = p_user_id
  for update;

  select * into existing
  from public.user_vehicle_unlocks
  where user_id = p_user_id and unlock_key = p_unlock_key
  limit 1;

  if found then
    return query select true, true, false, balance.free_unlocks_total, balance.free_unlocks_used,
      greatest(balance.free_unlocks_total - balance.free_unlocks_used, 0);
    return;
  end if;

  if balance.free_unlocks_used >= balance.free_unlocks_total then
    return query select false, false, false, balance.free_unlocks_total, balance.free_unlocks_used, 0;
    return;
  end if;

  begin
    insert into public.user_vehicle_unlocks (
      user_id, unlock_key, unlock_type, vin, vin_key, vehicle_key, listing_key, source_vehicle_id, scan_id
    )
    values (
      p_user_id, p_unlock_key, p_unlock_type, p_vin, p_vin_key, p_vehicle_key, p_listing_key, p_source_vehicle_id, p_scan_id
    );
  exception when unique_violation then
    return query select true, true, false, balance.free_unlocks_total, balance.free_unlocks_used,
      greatest(balance.free_unlocks_total - balance.free_unlocks_used, 0);
    return;
  end;

  update public.user_unlock_balances
  set free_unlocks_used = free_unlocks_used + 1,
      updated_at = now()
  where user_id = p_user_id
    and free_unlocks_used < free_unlocks_total
  returning free_unlocks_used into balance.free_unlocks_used;

  if not found then
    delete from public.user_vehicle_unlocks where user_id = p_user_id and unlock_key = p_unlock_key;
    return query select false, false, false, balance.free_unlocks_total, balance.free_unlocks_used,
      greatest(balance.free_unlocks_total - balance.free_unlocks_used, 0);
    return;
  end if;

  return query select true, false, true, balance.free_unlocks_total, balance.free_unlocks_used,
    greatest(balance.free_unlocks_total - balance.free_unlocks_used, 0);
end;
$$;
