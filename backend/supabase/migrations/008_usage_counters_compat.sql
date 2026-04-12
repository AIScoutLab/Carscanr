create extension if not exists pgcrypto;

alter table if exists public.usage_counters
  add column if not exists total_scans integer not null default 0;

insert into public.usage_counters (
  id,
  user_id,
  date,
  scan_count,
  total_scans,
  last_scan_at,
  recent_attempt_timestamps
)
select
  gen_random_uuid(),
  existing.user_id,
  date '1970-01-01',
  coalesce(sum(existing.scan_count), 0),
  coalesce(sum(existing.scan_count), 0),
  max(existing.last_scan_at),
  '[]'::jsonb
from public.usage_counters existing
where existing.date <> date '1970-01-01'
group by existing.user_id
on conflict (user_id, date) do update
set
  scan_count = greatest(public.usage_counters.scan_count, excluded.scan_count),
  total_scans = greatest(public.usage_counters.total_scans, excluded.total_scans),
  last_scan_at = coalesce(excluded.last_scan_at, public.usage_counters.last_scan_at);

update public.usage_counters
set total_scans = greatest(coalesce(total_scans, 0), coalesce(scan_count, 0))
where date = date '1970-01-01';
