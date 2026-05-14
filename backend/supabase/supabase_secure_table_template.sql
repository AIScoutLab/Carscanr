-- Supabase secure public-table template
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

create table if not exists public.example_table (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  created_at timestamptz not null default now()
);

-- Explicit Data API grants
grant select on table public.example_table to anon;

grant select, insert, update, delete
on table public.example_table
to authenticated;

grant select, insert, update, delete
on table public.example_table
to service_role;

-- RLS is required for any table reachable through the Data API
alter table public.example_table
enable row level security;

-- Example policies for a user-owned table
drop policy if exists example_table_select_own on public.example_table;
create policy example_table_select_own
on public.example_table
for select
to authenticated
using ((auth.uid())::text = user_id::text);

drop policy if exists example_table_insert_own on public.example_table;
create policy example_table_insert_own
on public.example_table
for insert
to authenticated
with check ((auth.uid())::text = user_id::text);

drop policy if exists example_table_update_own on public.example_table;
create policy example_table_update_own
on public.example_table
for update
to authenticated
using ((auth.uid())::text = user_id::text)
with check ((auth.uid())::text = user_id::text);

drop policy if exists example_table_delete_own on public.example_table;
create policy example_table_delete_own
on public.example_table
for delete
to authenticated
using ((auth.uid())::text = user_id::text);

-- Optional: if anon should not actually read rows, keep the GRANT explicit but
-- deny access with an RLS policy instead of leaving behavior implicit.
drop policy if exists example_table_select_none_anon on public.example_table;
create policy example_table_select_none_anon
on public.example_table
for select
to anon
using (false);

-- For internal/public-schema tables that should only be available to the
-- backend's service role, keep the explicit grants but replace the policies
-- above with deny-all anon/authenticated policies.
