create table if not exists public.revenuecat_events (
  id text primary key,
  app_user_id text,
  user_id text,
  event_type text not null,
  product_id text,
  transaction_id text,
  original_transaction_id text,
  processed boolean not null default false,
  processed_action text,
  payload_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists revenuecat_events_user_id_idx
  on public.revenuecat_events(user_id);

create index if not exists revenuecat_events_transaction_id_idx
  on public.revenuecat_events(transaction_id)
  where transaction_id is not null;

alter table public.revenuecat_events enable row level security;

revoke all on table public.revenuecat_events from anon, authenticated;
grant select, insert, update, delete on table public.revenuecat_events to service_role;

drop policy if exists revenuecat_events_deny_anon on public.revenuecat_events;
create policy revenuecat_events_deny_anon on public.revenuecat_events
  for select to anon
  using (false);

drop policy if exists revenuecat_events_deny_authenticated on public.revenuecat_events;
create policy revenuecat_events_deny_authenticated on public.revenuecat_events
  for select to authenticated
  using (false);
