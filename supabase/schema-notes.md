# Supabase Notes

Suggested tables for the first backend pass:

- `users`
- `scans`
- `vehicles`
- `garage_items`
- `valuations`
- `listing_results`
- `subscriptions`
- `usage_counters`

Suggested storage buckets:

- `scan-images`
- `garage-photos`

Recommended next step:

- Add row-level security policies keyed by `auth.uid()`
