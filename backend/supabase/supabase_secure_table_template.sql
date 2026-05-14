-- Supabase secure public-table templates
--
-- Why this exists:
-- Starting with Supabase's 2026 Data API security change, new tables created in
-- `public` are no longer exposed automatically. Every table that should be
-- reachable through supabase-js, PostgREST, or GraphQL needs explicit GRANTs,
-- and any exposed table must have RLS enabled with matching policies.
--
-- Official references:
-- - https://supabase.com/docs/guides/database/data-api
-- - https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
--
-- IMPORTANT:
-- - User-owned tables: authenticated CRUD + service_role CRUD + RLS policies.
-- - Internal/cache tables: service_role only. Do not grant anon/authenticated
--   and then rely on deny-all RLS as the primary control.

------------------------------------------------------------------------------
-- Example 1: user-owned table
------------------------------------------------------------------------------

create table if not exists public.example_user_owned (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  created_at timestamptz not null default now()
);

revoke all on table public.example_user_owned from anon, authenticated, service_role;

grant select, insert, update, delete
on table public.example_user_owned
to authenticated;

grant select, insert, update, delete
on table public.example_user_owned
to service_role;

alter table public.example_user_owned
enable row level security;

drop policy if exists example_user_owned_select_own on public.example_user_owned;
create policy example_user_owned_select_own
on public.example_user_owned
for select
to authenticated
using ((auth.uid())::text = user_id::text);

drop policy if exists example_user_owned_insert_own on public.example_user_owned;
create policy example_user_owned_insert_own
on public.example_user_owned
for insert
to authenticated
with check ((auth.uid())::text = user_id::text);

drop policy if exists example_user_owned_update_own on public.example_user_owned;
create policy example_user_owned_update_own
on public.example_user_owned
for update
to authenticated
using ((auth.uid())::text = user_id::text)
with check ((auth.uid())::text = user_id::text);

drop policy if exists example_user_owned_delete_own on public.example_user_owned;
create policy example_user_owned_delete_own
on public.example_user_owned
for delete
to authenticated
using ((auth.uid())::text = user_id::text);

drop policy if exists example_user_owned_select_none_anon on public.example_user_owned;
create policy example_user_owned_select_none_anon
on public.example_user_owned
for select
to anon
using (false);

------------------------------------------------------------------------------
-- Example 2: internal/cache table
------------------------------------------------------------------------------

create table if not exists public.example_internal_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on table public.example_internal_cache from anon, authenticated, service_role;

grant select, insert, update, delete
on table public.example_internal_cache
to service_role;

alter table public.example_internal_cache
enable row level security;

-- Optional defense in depth. The primary control here is grant minimization.
drop policy if exists example_internal_cache_select_none on public.example_internal_cache;
create policy example_internal_cache_select_none
on public.example_internal_cache
for select
to anon, authenticated
using (false);
