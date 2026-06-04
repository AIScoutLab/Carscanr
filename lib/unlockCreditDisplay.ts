import { PRICING } from "@/lib/pricing";

export function formatPurchasedUnlockPackRemaining(remainingCredits: number) {
  const remaining = Math.max(0, Math.floor(Number.isFinite(remainingCredits) ? remainingCredits : 0));
  if (remaining <= PRICING.unlockPackCount) {
    return `${remaining} of ${PRICING.unlockPackCount} purchased unlocks remaining`;
  }
  return `${remaining} purchased unlocks remaining`;
}
