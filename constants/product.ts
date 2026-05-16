// Keep the free Pro unlock allowance in one canonical place.
// This has drifted between 3 and 5 in the past when screens/services used local fallbacks.
export const FREE_PRO_UNLOCKS_TOTAL = 3;

export function normalizeFreeUnlockCounter(input: {
  total?: number | null;
  used?: number | null;
  remaining?: number | null;
}) {
  const limit = FREE_PRO_UNLOCKS_TOTAL;
  const rawUsed = typeof input.used === "number" && Number.isFinite(input.used) ? input.used : 0;
  const used = Math.max(0, Math.min(limit, Math.round(rawUsed)));
  const rawRemaining =
    typeof input.remaining === "number" && Number.isFinite(input.remaining)
      ? Math.round(input.remaining)
      : limit - used;
  const remaining = Math.max(0, Math.min(limit - used, rawRemaining));

  return {
    limit,
    used,
    remaining,
  };
}
