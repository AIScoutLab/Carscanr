-- Supabase Data API hardening for the 2026 explicit-grants rollout.
--
-- Official guidance:
-- - https://supabase.com/docs/guides/database/data-api
-- - https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
--
-- Starting with the 2026 platform change, new tables in `public` are not
-- automatically reachable over Supabase's Data and GraphQL APIs. We opt into
-- the stricter posture now by revoking default automatic exposure and then
-- explicitly granting only the roles we want to expose.
--
-- NOTE:
-- - `service_role` bypasses RLS and remains the trusted backend role.
-- - The anon/authenticated grants below keep Data API reachability explicit,
--   while the RLS policies determine whether any rows are actually visible or
--   writable.
-- - Internal/cache tables intentionally receive deny-all anon/authenticated
--   policies even though they are explicitly granted here. This preserves a
--   locked-down client posture while keeping the privilege model explicit and
--   future-proof for new Supabase projects.

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

grant select on table public.vehicles to anon;
grant select, insert, update, delete on table public.vehicles to authenticated;
grant select, insert, update, delete on table public.vehicles to service_role;

grant select on table public.scans to anon;
grant select, insert, update, delete on table public.scans to authenticated;
grant select, insert, update, delete on table public.scans to service_role;

grant select on table public.garage_items to anon;
grant select, insert, update, delete on table public.garage_items to authenticated;
grant select, insert, update, delete on table public.garage_items to service_role;

grant select on table public.valuations to anon;
grant select, insert, update, delete on table public.valuations to authenticated;
grant select, insert, update, delete on table public.valuations to service_role;

grant select on table public.listing_results to anon;
grant select, insert, update, delete on table public.listing_results to authenticated;
grant select, insert, update, delete on table public.listing_results to service_role;

grant select on table public.subscriptions to anon;
grant select, insert, update, delete on table public.subscriptions to authenticated;
grant select, insert, update, delete on table public.subscriptions to service_role;

grant select on table public.usage_counters to anon;
grant select, insert, update, delete on table public.usage_counters to authenticated;
grant select, insert, update, delete on table public.usage_counters to service_role;

grant select on table public.vision_debug_logs to anon;
grant select, insert, update, delete on table public.vision_debug_logs to authenticated;
grant select, insert, update, delete on table public.vision_debug_logs to service_role;

grant select on table public.provider_specs_cache to anon;
grant select, insert, update, delete on table public.provider_specs_cache to authenticated;
grant select, insert, update, delete on table public.provider_specs_cache to service_role;

grant select on table public.provider_values_cache to anon;
grant select, insert, update, delete on table public.provider_values_cache to authenticated;
grant select, insert, update, delete on table public.provider_values_cache to service_role;

grant select on table public.provider_listings_cache to anon;
grant select, insert, update, delete on table public.provider_listings_cache to authenticated;
grant select, insert, update, delete on table public.provider_listings_cache to service_role;

grant select on table public.provider_vehicle_specs_cache to anon;
grant select, insert, update, delete on table public.provider_vehicle_specs_cache to authenticated;
grant select, insert, update, delete on table public.provider_vehicle_specs_cache to service_role;

grant select on table public.provider_vehicle_values_cache to anon;
grant select, insert, update, delete on table public.provider_vehicle_values_cache to authenticated;
grant select, insert, update, delete on table public.provider_vehicle_values_cache to service_role;

grant select on table public.provider_vehicle_listings_cache to anon;
grant select, insert, update, delete on table public.provider_vehicle_listings_cache to authenticated;
grant select, insert, update, delete on table public.provider_vehicle_listings_cache to service_role;

grant select on table public.provider_api_usage_logs to anon;
grant select, insert, update, delete on table public.provider_api_usage_logs to authenticated;
grant select, insert, update, delete on table public.provider_api_usage_logs to service_role;

grant select on table public.canonical_vehicles to anon;
grant select, insert, update, delete on table public.canonical_vehicles to authenticated;
grant select, insert, update, delete on table public.canonical_vehicles to service_role;

grant select on table public.cached_analysis to anon;
grant select, insert, update, delete on table public.cached_analysis to authenticated;
grant select, insert, update, delete on table public.cached_analysis to service_role;

grant select on table public.image_cache to anon;
grant select, insert, update, delete on table public.image_cache to authenticated;
grant select, insert, update, delete on table public.image_cache to service_role;

grant select on table public.user_unlock_balances to anon;
grant select, insert, update, delete on table public.user_unlock_balances to authenticated;
grant select, insert, update, delete on table public.user_unlock_balances to service_role;

grant select on table public.user_vehicle_unlocks to anon;
grant select, insert, update, delete on table public.user_vehicle_unlocks to authenticated;
grant select, insert, update, delete on table public.user_vehicle_unlocks to service_role;

grant select on table public.vehicle_scan_popularity to anon;
grant select, insert, update, delete on table public.vehicle_scan_popularity to authenticated;
grant select, insert, update, delete on table public.vehicle_scan_popularity to service_role;

grant select on table public.vehicle_global_trending to anon;
grant select, insert, update, delete on table public.vehicle_global_trending to authenticated;
grant select, insert, update, delete on table public.vehicle_global_trending to service_role;

alter table public.vehicles enable row level security;
alter table public.scans enable row level security;
alter table public.garage_items enable row level security;
alter table public.valuations enable row level security;
alter table public.listing_results enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_counters enable row level security;
alter table public.vision_debug_logs enable row level security;
alter table public.provider_specs_cache enable row level security;
alter table public.provider_values_cache enable row level security;
alter table public.provider_listings_cache enable row level security;
alter table public.provider_vehicle_specs_cache enable row level security;
alter table public.provider_vehicle_values_cache enable row level security;
alter table public.provider_vehicle_listings_cache enable row level security;
alter table public.provider_api_usage_logs enable row level security;
alter table public.canonical_vehicles enable row level security;
alter table public.cached_analysis enable row level security;
alter table public.image_cache enable row level security;
alter table public.user_unlock_balances enable row level security;
alter table public.user_vehicle_unlocks enable row level security;
alter table public.vehicle_scan_popularity enable row level security;
alter table public.vehicle_global_trending enable row level security;

drop policy if exists vehicles_select_public on public.vehicles;
create policy vehicles_select_public
on public.vehicles
for select
to anon, authenticated
using (true);

drop policy if exists vehicles_insert_none on public.vehicles;
create policy vehicles_insert_none
on public.vehicles
for insert
to authenticated
with check (false);

drop policy if exists vehicles_update_none on public.vehicles;
create policy vehicles_update_none
on public.vehicles
for update
to authenticated
using (false)
with check (false);

drop policy if exists vehicles_delete_none on public.vehicles;
create policy vehicles_delete_none
on public.vehicles
for delete
to authenticated
using (false);

drop policy if exists canonical_vehicles_select_public on public.canonical_vehicles;
create policy canonical_vehicles_select_public
on public.canonical_vehicles
for select
to anon, authenticated
using (true);

drop policy if exists canonical_vehicles_insert_none on public.canonical_vehicles;
create policy canonical_vehicles_insert_none
on public.canonical_vehicles
for insert
to authenticated
with check (false);

drop policy if exists canonical_vehicles_update_none on public.canonical_vehicles;
create policy canonical_vehicles_update_none
on public.canonical_vehicles
for update
to authenticated
using (false)
with check (false);

drop policy if exists canonical_vehicles_delete_none on public.canonical_vehicles;
create policy canonical_vehicles_delete_none
on public.canonical_vehicles
for delete
to authenticated
using (false);

drop policy if exists scans_select_own on public.scans;
create policy scans_select_own
on public.scans
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists scans_insert_own on public.scans;
create policy scans_insert_own
on public.scans
for insert
to authenticated
with check ((auth.uid())::text = user_id);

drop policy if exists scans_update_own on public.scans;
create policy scans_update_own
on public.scans
for update
to authenticated
using ((auth.uid())::text = user_id)
with check ((auth.uid())::text = user_id);

drop policy if exists scans_delete_own on public.scans;
create policy scans_delete_own
on public.scans
for delete
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists scans_select_none_anon on public.scans;
create policy scans_select_none_anon
on public.scans
for select
to anon
using (false);

drop policy if exists garage_items_select_own on public.garage_items;
create policy garage_items_select_own
on public.garage_items
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists garage_items_insert_own on public.garage_items;
create policy garage_items_insert_own
on public.garage_items
for insert
to authenticated
with check ((auth.uid())::text = user_id);

drop policy if exists garage_items_update_own on public.garage_items;
create policy garage_items_update_own
on public.garage_items
for update
to authenticated
using ((auth.uid())::text = user_id)
with check ((auth.uid())::text = user_id);

drop policy if exists garage_items_delete_own on public.garage_items;
create policy garage_items_delete_own
on public.garage_items
for delete
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists garage_items_select_none_anon on public.garage_items;
create policy garage_items_select_none_anon
on public.garage_items
for select
to anon
using (false);

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own
on public.subscriptions
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists subscriptions_insert_own on public.subscriptions;
create policy subscriptions_insert_own
on public.subscriptions
for insert
to authenticated
with check ((auth.uid())::text = user_id);

drop policy if exists subscriptions_update_own on public.subscriptions;
create policy subscriptions_update_own
on public.subscriptions
for update
to authenticated
using ((auth.uid())::text = user_id)
with check ((auth.uid())::text = user_id);

drop policy if exists subscriptions_delete_own on public.subscriptions;
create policy subscriptions_delete_own
on public.subscriptions
for delete
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists subscriptions_select_none_anon on public.subscriptions;
create policy subscriptions_select_none_anon
on public.subscriptions
for select
to anon
using (false);

drop policy if exists usage_counters_select_own on public.usage_counters;
create policy usage_counters_select_own
on public.usage_counters
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists usage_counters_insert_own on public.usage_counters;
create policy usage_counters_insert_own
on public.usage_counters
for insert
to authenticated
with check ((auth.uid())::text = user_id);

drop policy if exists usage_counters_update_own on public.usage_counters;
create policy usage_counters_update_own
on public.usage_counters
for update
to authenticated
using ((auth.uid())::text = user_id)
with check ((auth.uid())::text = user_id);

drop policy if exists usage_counters_delete_own on public.usage_counters;
create policy usage_counters_delete_own
on public.usage_counters
for delete
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists usage_counters_select_none_anon on public.usage_counters;
create policy usage_counters_select_none_anon
on public.usage_counters
for select
to anon
using (false);

drop policy if exists vision_debug_logs_select_own on public.vision_debug_logs;
create policy vision_debug_logs_select_own
on public.vision_debug_logs
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists vision_debug_logs_insert_own on public.vision_debug_logs;
create policy vision_debug_logs_insert_own
on public.vision_debug_logs
for insert
to authenticated
with check ((auth.uid())::text = user_id);

drop policy if exists vision_debug_logs_update_own on public.vision_debug_logs;
create policy vision_debug_logs_update_own
on public.vision_debug_logs
for update
to authenticated
using ((auth.uid())::text = user_id)
with check ((auth.uid())::text = user_id);

drop policy if exists vision_debug_logs_delete_own on public.vision_debug_logs;
create policy vision_debug_logs_delete_own
on public.vision_debug_logs
for delete
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists vision_debug_logs_select_none_anon on public.vision_debug_logs;
create policy vision_debug_logs_select_none_anon
on public.vision_debug_logs
for select
to anon
using (false);

drop policy if exists user_unlock_balances_select_own on public.user_unlock_balances;
create policy user_unlock_balances_select_own
on public.user_unlock_balances
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists user_unlock_balances_insert_own on public.user_unlock_balances;
create policy user_unlock_balances_insert_own
on public.user_unlock_balances
for insert
to authenticated
with check ((auth.uid())::text = user_id);

drop policy if exists user_unlock_balances_update_own on public.user_unlock_balances;
create policy user_unlock_balances_update_own
on public.user_unlock_balances
for update
to authenticated
using ((auth.uid())::text = user_id)
with check ((auth.uid())::text = user_id);

drop policy if exists user_unlock_balances_delete_own on public.user_unlock_balances;
create policy user_unlock_balances_delete_own
on public.user_unlock_balances
for delete
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists user_unlock_balances_select_none_anon on public.user_unlock_balances;
create policy user_unlock_balances_select_none_anon
on public.user_unlock_balances
for select
to anon
using (false);

drop policy if exists user_vehicle_unlocks_select_own on public.user_vehicle_unlocks;
create policy user_vehicle_unlocks_select_own
on public.user_vehicle_unlocks
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists user_vehicle_unlocks_insert_own on public.user_vehicle_unlocks;
create policy user_vehicle_unlocks_insert_own
on public.user_vehicle_unlocks
for insert
to authenticated
with check ((auth.uid())::text = user_id);

drop policy if exists user_vehicle_unlocks_update_own on public.user_vehicle_unlocks;
create policy user_vehicle_unlocks_update_own
on public.user_vehicle_unlocks
for update
to authenticated
using ((auth.uid())::text = user_id)
with check ((auth.uid())::text = user_id);

drop policy if exists user_vehicle_unlocks_delete_own on public.user_vehicle_unlocks;
create policy user_vehicle_unlocks_delete_own
on public.user_vehicle_unlocks
for delete
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists user_vehicle_unlocks_select_none_anon on public.user_vehicle_unlocks;
create policy user_vehicle_unlocks_select_none_anon
on public.user_vehicle_unlocks
for select
to anon
using (false);

drop policy if exists valuations_select_none on public.valuations;
create policy valuations_select_none
on public.valuations
for select
to anon, authenticated
using (false);

drop policy if exists valuations_insert_none on public.valuations;
create policy valuations_insert_none
on public.valuations
for insert
to authenticated
with check (false);

drop policy if exists valuations_update_none on public.valuations;
create policy valuations_update_none
on public.valuations
for update
to authenticated
using (false)
with check (false);

drop policy if exists valuations_delete_none on public.valuations;
create policy valuations_delete_none
on public.valuations
for delete
to authenticated
using (false);

drop policy if exists listing_results_select_none on public.listing_results;
create policy listing_results_select_none
on public.listing_results
for select
to anon, authenticated
using (false);

drop policy if exists listing_results_insert_none on public.listing_results;
create policy listing_results_insert_none
on public.listing_results
for insert
to authenticated
with check (false);

drop policy if exists listing_results_update_none on public.listing_results;
create policy listing_results_update_none
on public.listing_results
for update
to authenticated
using (false)
with check (false);

drop policy if exists listing_results_delete_none on public.listing_results;
create policy listing_results_delete_none
on public.listing_results
for delete
to authenticated
using (false);

drop policy if exists provider_specs_cache_select_none on public.provider_specs_cache;
create policy provider_specs_cache_select_none
on public.provider_specs_cache
for select
to anon, authenticated
using (false);

drop policy if exists provider_specs_cache_insert_none on public.provider_specs_cache;
create policy provider_specs_cache_insert_none
on public.provider_specs_cache
for insert
to authenticated
with check (false);

drop policy if exists provider_specs_cache_update_none on public.provider_specs_cache;
create policy provider_specs_cache_update_none
on public.provider_specs_cache
for update
to authenticated
using (false)
with check (false);

drop policy if exists provider_specs_cache_delete_none on public.provider_specs_cache;
create policy provider_specs_cache_delete_none
on public.provider_specs_cache
for delete
to authenticated
using (false);

drop policy if exists provider_values_cache_select_none on public.provider_values_cache;
create policy provider_values_cache_select_none
on public.provider_values_cache
for select
to anon, authenticated
using (false);

drop policy if exists provider_values_cache_insert_none on public.provider_values_cache;
create policy provider_values_cache_insert_none
on public.provider_values_cache
for insert
to authenticated
with check (false);

drop policy if exists provider_values_cache_update_none on public.provider_values_cache;
create policy provider_values_cache_update_none
on public.provider_values_cache
for update
to authenticated
using (false)
with check (false);

drop policy if exists provider_values_cache_delete_none on public.provider_values_cache;
create policy provider_values_cache_delete_none
on public.provider_values_cache
for delete
to authenticated
using (false);

drop policy if exists provider_listings_cache_select_none on public.provider_listings_cache;
create policy provider_listings_cache_select_none
on public.provider_listings_cache
for select
to anon, authenticated
using (false);

drop policy if exists provider_listings_cache_insert_none on public.provider_listings_cache;
create policy provider_listings_cache_insert_none
on public.provider_listings_cache
for insert
to authenticated
with check (false);

drop policy if exists provider_listings_cache_update_none on public.provider_listings_cache;
create policy provider_listings_cache_update_none
on public.provider_listings_cache
for update
to authenticated
using (false)
with check (false);

drop policy if exists provider_listings_cache_delete_none on public.provider_listings_cache;
create policy provider_listings_cache_delete_none
on public.provider_listings_cache
for delete
to authenticated
using (false);

drop policy if exists provider_vehicle_specs_cache_select_none on public.provider_vehicle_specs_cache;
create policy provider_vehicle_specs_cache_select_none
on public.provider_vehicle_specs_cache
for select
to anon, authenticated
using (false);

drop policy if exists provider_vehicle_specs_cache_insert_none on public.provider_vehicle_specs_cache;
create policy provider_vehicle_specs_cache_insert_none
on public.provider_vehicle_specs_cache
for insert
to authenticated
with check (false);

drop policy if exists provider_vehicle_specs_cache_update_none on public.provider_vehicle_specs_cache;
create policy provider_vehicle_specs_cache_update_none
on public.provider_vehicle_specs_cache
for update
to authenticated
using (false)
with check (false);

drop policy if exists provider_vehicle_specs_cache_delete_none on public.provider_vehicle_specs_cache;
create policy provider_vehicle_specs_cache_delete_none
on public.provider_vehicle_specs_cache
for delete
to authenticated
using (false);

drop policy if exists provider_vehicle_values_cache_select_none on public.provider_vehicle_values_cache;
create policy provider_vehicle_values_cache_select_none
on public.provider_vehicle_values_cache
for select
to anon, authenticated
using (false);

drop policy if exists provider_vehicle_values_cache_insert_none on public.provider_vehicle_values_cache;
create policy provider_vehicle_values_cache_insert_none
on public.provider_vehicle_values_cache
for insert
to authenticated
with check (false);

drop policy if exists provider_vehicle_values_cache_update_none on public.provider_vehicle_values_cache;
create policy provider_vehicle_values_cache_update_none
on public.provider_vehicle_values_cache
for update
to authenticated
using (false)
with check (false);

drop policy if exists provider_vehicle_values_cache_delete_none on public.provider_vehicle_values_cache;
create policy provider_vehicle_values_cache_delete_none
on public.provider_vehicle_values_cache
for delete
to authenticated
using (false);

drop policy if exists provider_vehicle_listings_cache_select_none on public.provider_vehicle_listings_cache;
create policy provider_vehicle_listings_cache_select_none
on public.provider_vehicle_listings_cache
for select
to anon, authenticated
using (false);

drop policy if exists provider_vehicle_listings_cache_insert_none on public.provider_vehicle_listings_cache;
create policy provider_vehicle_listings_cache_insert_none
on public.provider_vehicle_listings_cache
for insert
to authenticated
with check (false);

drop policy if exists provider_vehicle_listings_cache_update_none on public.provider_vehicle_listings_cache;
create policy provider_vehicle_listings_cache_update_none
on public.provider_vehicle_listings_cache
for update
to authenticated
using (false)
with check (false);

drop policy if exists provider_vehicle_listings_cache_delete_none on public.provider_vehicle_listings_cache;
create policy provider_vehicle_listings_cache_delete_none
on public.provider_vehicle_listings_cache
for delete
to authenticated
using (false);

drop policy if exists provider_api_usage_logs_select_none on public.provider_api_usage_logs;
create policy provider_api_usage_logs_select_none
on public.provider_api_usage_logs
for select
to anon, authenticated
using (false);

drop policy if exists provider_api_usage_logs_insert_none on public.provider_api_usage_logs;
create policy provider_api_usage_logs_insert_none
on public.provider_api_usage_logs
for insert
to authenticated
with check (false);

drop policy if exists provider_api_usage_logs_update_none on public.provider_api_usage_logs;
create policy provider_api_usage_logs_update_none
on public.provider_api_usage_logs
for update
to authenticated
using (false)
with check (false);

drop policy if exists provider_api_usage_logs_delete_none on public.provider_api_usage_logs;
create policy provider_api_usage_logs_delete_none
on public.provider_api_usage_logs
for delete
to authenticated
using (false);

drop policy if exists cached_analysis_select_none on public.cached_analysis;
create policy cached_analysis_select_none
on public.cached_analysis
for select
to anon, authenticated
using (false);

drop policy if exists cached_analysis_insert_none on public.cached_analysis;
create policy cached_analysis_insert_none
on public.cached_analysis
for insert
to authenticated
with check (false);

drop policy if exists cached_analysis_update_none on public.cached_analysis;
create policy cached_analysis_update_none
on public.cached_analysis
for update
to authenticated
using (false)
with check (false);

drop policy if exists cached_analysis_delete_none on public.cached_analysis;
create policy cached_analysis_delete_none
on public.cached_analysis
for delete
to authenticated
using (false);

drop policy if exists image_cache_select_none on public.image_cache;
create policy image_cache_select_none
on public.image_cache
for select
to anon, authenticated
using (false);

drop policy if exists image_cache_insert_none on public.image_cache;
create policy image_cache_insert_none
on public.image_cache
for insert
to authenticated
with check (false);

drop policy if exists image_cache_update_none on public.image_cache;
create policy image_cache_update_none
on public.image_cache
for update
to authenticated
using (false)
with check (false);

drop policy if exists image_cache_delete_none on public.image_cache;
create policy image_cache_delete_none
on public.image_cache
for delete
to authenticated
using (false);

drop policy if exists vehicle_scan_popularity_select_none on public.vehicle_scan_popularity;
create policy vehicle_scan_popularity_select_none
on public.vehicle_scan_popularity
for select
to anon, authenticated
using (false);

drop policy if exists vehicle_scan_popularity_insert_none on public.vehicle_scan_popularity;
create policy vehicle_scan_popularity_insert_none
on public.vehicle_scan_popularity
for insert
to authenticated
with check (false);

drop policy if exists vehicle_scan_popularity_update_none on public.vehicle_scan_popularity;
create policy vehicle_scan_popularity_update_none
on public.vehicle_scan_popularity
for update
to authenticated
using (false)
with check (false);

drop policy if exists vehicle_scan_popularity_delete_none on public.vehicle_scan_popularity;
create policy vehicle_scan_popularity_delete_none
on public.vehicle_scan_popularity
for delete
to authenticated
using (false);

drop policy if exists vehicle_global_trending_select_none on public.vehicle_global_trending;
create policy vehicle_global_trending_select_none
on public.vehicle_global_trending
for select
to anon, authenticated
using (false);

drop policy if exists vehicle_global_trending_insert_none on public.vehicle_global_trending;
create policy vehicle_global_trending_insert_none
on public.vehicle_global_trending
for insert
to authenticated
with check (false);

drop policy if exists vehicle_global_trending_update_none on public.vehicle_global_trending;
create policy vehicle_global_trending_update_none
on public.vehicle_global_trending
for update
to authenticated
using (false)
with check (false);

drop policy if exists vehicle_global_trending_delete_none on public.vehicle_global_trending;
create policy vehicle_global_trending_delete_none
on public.vehicle_global_trending
for delete
to authenticated
using (false);
