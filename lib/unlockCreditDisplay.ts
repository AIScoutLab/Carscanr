import { PRICING } from "@/lib/pricing";

const DEFAULT_FREE_UNLOCK_COUNT = 3;

function normalizeCount(value: number, fallback = 0) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : fallback));
}

export function formatPurchasedUnlockPackRemaining(remainingCredits: number) {
  const remaining = normalizeCount(remainingCredits);
  if (remaining <= PRICING.unlockPackCount) {
    return `${remaining} of ${PRICING.unlockPackCount} purchased unlocks remaining`;
  }
  return `${remaining} purchased unlocks remaining`;
}

export function formatFreeUnlockBalance(remainingUnlocks: number, totalUnlocks: number = DEFAULT_FREE_UNLOCK_COUNT) {
  const remaining = normalizeCount(remainingUnlocks);
  const total = normalizeCount(totalUnlocks, DEFAULT_FREE_UNLOCK_COUNT);
  return `Free unlocks: ${remaining} of ${total} remaining`;
}

export function formatPurchasedUnlockBalance(remainingCredits: number, packCount: number = PRICING.unlockPackCount) {
  const remaining = normalizeCount(remainingCredits);
  const total = normalizeCount(packCount, PRICING.unlockPackCount);
  return `Purchased unlocks: ${remaining} of ${total} remaining`;
}

export function formatUnlockBalanceSummary(input: {
  freeUnlocksRemaining: number;
  freeUnlocksTotal?: number;
  unlockCreditsRemaining: number;
  unlockPackCount?: number;
  separator?: string;
}) {
  const separator = input.separator ?? "\n";
  return [
    formatFreeUnlockBalance(input.freeUnlocksRemaining, input.freeUnlocksTotal ?? DEFAULT_FREE_UNLOCK_COUNT),
    formatPurchasedUnlockBalance(input.unlockCreditsRemaining, input.unlockPackCount ?? PRICING.unlockPackCount),
  ].join(separator);
}

export function formatCompactUnlockBalanceSummary(input: {
  freeUnlocksRemaining: number;
  freeUnlocksTotal?: number;
  unlockCreditsRemaining: number;
  unlockPackCount?: number;
}) {
  const freeRemaining = normalizeCount(input.freeUnlocksRemaining);
  const freeTotal = normalizeCount(input.freeUnlocksTotal ?? DEFAULT_FREE_UNLOCK_COUNT, DEFAULT_FREE_UNLOCK_COUNT);
  const purchasedRemaining = normalizeCount(input.unlockCreditsRemaining);
  const purchasedTotal = normalizeCount(input.unlockPackCount ?? PRICING.unlockPackCount, PRICING.unlockPackCount);
  return `Free: ${freeRemaining} of ${freeTotal} remaining • Purchased: ${purchasedRemaining} of ${purchasedTotal} remaining`;
}

export function formatUnlockResultBody(input: {
  resultType?: string;
  freeUnlocksRemaining: number;
  freeUnlocksTotal?: number;
  unlockCreditsRemaining: number;
}) {
  if (input.resultType === "pro_access") {
    return "This vehicle is unlocked through your subscription.";
  }
  const body =
    input.resultType === "already_unlocked"
      ? "This vehicle was already unlocked."
      : "This vehicle is now unlocked.";
  return `${body}\n\n${formatUnlockBalanceSummary({
    freeUnlocksRemaining: input.freeUnlocksRemaining,
    freeUnlocksTotal: input.freeUnlocksTotal,
    unlockCreditsRemaining: input.unlockCreditsRemaining,
  })}`;
}
