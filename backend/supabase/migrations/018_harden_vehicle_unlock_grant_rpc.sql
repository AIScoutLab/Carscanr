alter table public.user_unlock_balances
  add column if not exists unlock_credits integer not null default 0;

alter table public.user_unlock_balances
  alter column free_unlocks_total set default 3;

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
  used_unlock_credit boolean,
  free_unlocks_total integer,
  free_unlocks_used integer,
  free_unlocks_remaining integer,
  unlock_credits_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  balance record;
begin
  insert into public.user_unlock_balances (user_id, free_unlocks_total)
  values (p_user_id, 3)
  on conflict (user_id) do nothing;

  select * into balance
  from public.user_unlock_balances
  where user_id = p_user_id
  for update;

  if exists (
    select 1
    from public.user_vehicle_unlocks
    where user_id = p_user_id and unlock_key = p_unlock_key
    limit 1
  ) then
    return query select
      true,
      true,
      false,
      false,
      balance.free_unlocks_total,
      balance.free_unlocks_used,
      greatest(balance.free_unlocks_total - balance.free_unlocks_used, 0),
      greatest(coalesce(balance.unlock_credits, 0), 0);
    return;
  end if;

  if balance.free_unlocks_used >= balance.free_unlocks_total and coalesce(balance.unlock_credits, 0) <= 0 then
    return query select
      false,
      false,
      false,
      false,
      balance.free_unlocks_total,
      balance.free_unlocks_used,
      0,
      0;
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
    return query select
      true,
      true,
      false,
      false,
      balance.free_unlocks_total,
      balance.free_unlocks_used,
      greatest(balance.free_unlocks_total - balance.free_unlocks_used, 0),
      greatest(coalesce(balance.unlock_credits, 0), 0);
    return;
  end;

  if balance.free_unlocks_used < balance.free_unlocks_total then
    update public.user_unlock_balances
    set free_unlocks_used = free_unlocks_used + 1,
        updated_at = now()
    where user_id = p_user_id
    returning free_unlocks_used, unlock_credits
    into balance.free_unlocks_used, balance.unlock_credits;

    return query select
      true,
      false,
      true,
      false,
      balance.free_unlocks_total,
      balance.free_unlocks_used,
      greatest(balance.free_unlocks_total - balance.free_unlocks_used, 0),
      greatest(coalesce(balance.unlock_credits, 0), 0);
    return;
  end if;

  update public.user_unlock_balances
  set unlock_credits = greatest(coalesce(unlock_credits, 0) - 1, 0),
      updated_at = now()
  where user_id = p_user_id
    and coalesce(unlock_credits, 0) > 0
  returning free_unlocks_used, unlock_credits
  into balance.free_unlocks_used, balance.unlock_credits;

  if not found then
    delete from public.user_vehicle_unlocks where user_id = p_user_id and unlock_key = p_unlock_key;
    return query select
      false,
      false,
      false,
      false,
      balance.free_unlocks_total,
      balance.free_unlocks_used,
      greatest(balance.free_unlocks_total - balance.free_unlocks_used, 0),
      greatest(coalesce(balance.unlock_credits, 0), 0);
    return;
  end if;

  return query select
    true,
    false,
    true,
    true,
    balance.free_unlocks_total,
    balance.free_unlocks_used,
    greatest(balance.free_unlocks_total - balance.free_unlocks_used, 0),
    greatest(coalesce(balance.unlock_credits, 0), 0);
end;
$$;

revoke all on function public.grant_user_vehicle_unlock(text, text, text, text, text, text, text, text, uuid)
from public, anon, authenticated;

grant execute on function public.grant_user_vehicle_unlock(text, text, text, text, text, text, text, text, uuid)
to service_role;
