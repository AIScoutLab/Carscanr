alter table public.vehicles enable row level security;
alter table public.garage_items enable row level security;
alter table public.valuations enable row level security;
alter table public.listing_results enable row level security;
alter table public.subscriptions enable row level security;
alter table public.scans enable row level security;
alter table public.vision_debug_logs enable row level security;
alter table public.user_vehicle_unlocks enable row level security;
alter table public.user_unlock_balances enable row level security;
alter table public.vehicle_scan_popularity enable row level security;
alter table public.canonical_vehicles enable row level security;
alter table public.image_cache enable row level security;
alter table public.cached_analysis enable row level security;
alter table public.provider_vehicle_values_cache enable row level security;
alter table public.provider_vehicle_listings_cache enable row level security;
alter table public.provider_api_usage_logs enable row level security;

drop policy if exists garage_items_select_own on public.garage_items;
create policy garage_items_select_own
on public.garage_items
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own
on public.subscriptions
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists scans_select_own on public.scans;
create policy scans_select_own
on public.scans
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists user_vehicle_unlocks_select_own on public.user_vehicle_unlocks;
create policy user_vehicle_unlocks_select_own
on public.user_vehicle_unlocks
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists user_unlock_balances_select_own on public.user_unlock_balances;
create policy user_unlock_balances_select_own
on public.user_unlock_balances
for select
to authenticated
using ((auth.uid())::text = user_id);
