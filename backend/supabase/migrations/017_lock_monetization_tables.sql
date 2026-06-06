-- Lock monetization and entitlement tables behind the backend service role.
--
-- These tables are user-owned/private, but their contents are security
-- decisions: subscription status, usage counters, free unlock balances, and
-- vehicle unlock grants. Authenticated clients may read their own rows for
-- transparency, but must not insert/update/delete them through the Supabase
-- Data API. All mutations should flow through backend routes/RPCs that verify
-- RevenueCat/backend entitlement state and unlock eligibility.

revoke all on table public.subscriptions from anon, authenticated, service_role;
grant select on table public.subscriptions to authenticated;
grant select, insert, update, delete on table public.subscriptions to service_role;

revoke all on table public.usage_counters from anon, authenticated, service_role;
grant select on table public.usage_counters to authenticated;
grant select, insert, update, delete on table public.usage_counters to service_role;

revoke all on table public.user_unlock_balances from anon, authenticated, service_role;
grant select on table public.user_unlock_balances to authenticated;
grant select, insert, update, delete on table public.user_unlock_balances to service_role;

revoke all on table public.user_vehicle_unlocks from anon, authenticated, service_role;
grant select on table public.user_vehicle_unlocks to authenticated;
grant select, insert, update, delete on table public.user_vehicle_unlocks to service_role;

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own
on public.subscriptions
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists usage_counters_select_own on public.usage_counters;
create policy usage_counters_select_own
on public.usage_counters
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists user_unlock_balances_select_own on public.user_unlock_balances;
create policy user_unlock_balances_select_own
on public.user_unlock_balances
for select
to authenticated
using ((auth.uid())::text = user_id);

drop policy if exists user_vehicle_unlocks_select_own on public.user_vehicle_unlocks;
create policy user_vehicle_unlocks_select_own
on public.user_vehicle_unlocks
for select
to authenticated
using ((auth.uid())::text = user_id);

-- Remove old owner-scoped client write policies for monetization tables.
drop policy if exists subscriptions_insert_own on public.subscriptions;
drop policy if exists subscriptions_update_own on public.subscriptions;
drop policy if exists subscriptions_delete_own on public.subscriptions;
drop policy if exists usage_counters_insert_own on public.usage_counters;
drop policy if exists usage_counters_update_own on public.usage_counters;
drop policy if exists usage_counters_delete_own on public.usage_counters;
drop policy if exists user_unlock_balances_insert_own on public.user_unlock_balances;
drop policy if exists user_unlock_balances_update_own on public.user_unlock_balances;
drop policy if exists user_unlock_balances_delete_own on public.user_unlock_balances;
drop policy if exists user_vehicle_unlocks_insert_own on public.user_vehicle_unlocks;
drop policy if exists user_vehicle_unlocks_update_own on public.user_vehicle_unlocks;
drop policy if exists user_vehicle_unlocks_delete_own on public.user_vehicle_unlocks;

-- Defense in depth if authenticated DML grants are accidentally reintroduced.
create policy subscriptions_insert_none
on public.subscriptions
for insert
to authenticated
with check (false);

create policy subscriptions_update_none
on public.subscriptions
for update
to authenticated
using (false)
with check (false);

create policy subscriptions_delete_none
on public.subscriptions
for delete
to authenticated
using (false);

create policy usage_counters_insert_none
on public.usage_counters
for insert
to authenticated
with check (false);

create policy usage_counters_update_none
on public.usage_counters
for update
to authenticated
using (false)
with check (false);

create policy usage_counters_delete_none
on public.usage_counters
for delete
to authenticated
using (false);

create policy user_unlock_balances_insert_none
on public.user_unlock_balances
for insert
to authenticated
with check (false);

create policy user_unlock_balances_update_none
on public.user_unlock_balances
for update
to authenticated
using (false)
with check (false);

create policy user_unlock_balances_delete_none
on public.user_unlock_balances
for delete
to authenticated
using (false);

create policy user_vehicle_unlocks_insert_none
on public.user_vehicle_unlocks
for insert
to authenticated
with check (false);

create policy user_vehicle_unlocks_update_none
on public.user_vehicle_unlocks
for update
to authenticated
using (false)
with check (false);

create policy user_vehicle_unlocks_delete_none
on public.user_vehicle_unlocks
for delete
to authenticated
using (false);
