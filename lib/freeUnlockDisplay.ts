import { FREE_PRO_UNLOCKS_TOTAL } from "@/constants/product";

export function deriveFreeUnlockCounter(input: {
  used?: number | null;
  remaining?: number | null;
  limit?: number | null;
}) {
  const requestedLimit =
    typeof input.limit === "number" && Number.isFinite(input.limit) ? Math.max(0, input.limit) : FREE_PRO_UNLOCKS_TOTAL;
  const normalizedLimit = Math.min(requestedLimit || FREE_PRO_UNLOCKS_TOTAL, FREE_PRO_UNLOCKS_TOTAL);
  const used = Math.min(
    normalizedLimit,
    typeof input.used === "number" && Number.isFinite(input.used) ? Math.max(0, input.used) : 0,
  );
  const requestedRemaining =
    typeof input.remaining === "number" && Number.isFinite(input.remaining) ? Math.max(0, input.remaining) : Math.max(0, normalizedLimit - used);
  const remaining = Math.min(requestedRemaining, Math.max(0, normalizedLimit - used));
  const total = used + remaining;

  return {
    used,
    remaining,
    total: total > 0 ? total : normalizedLimit,
  };
}
