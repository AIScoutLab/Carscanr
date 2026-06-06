do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where n.nspname = 'public'
      and t.relname = 'subscriptions'
      and c.contype = 'c'
      and a.attname = 'plan'
  loop
    execute format('alter table public.subscriptions drop constraint if exists %I', constraint_name);
  end loop;
end $$;

alter table if exists public.subscriptions
  add constraint subscriptions_plan_check
  check (plan in ('free', 'pro', 'pro_monthly', 'pro_yearly')) not valid;

alter table if exists public.subscriptions
  validate constraint subscriptions_plan_check;
