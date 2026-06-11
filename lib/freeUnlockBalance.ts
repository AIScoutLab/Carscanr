import { FREE_PRO_UNLOCKS_TOTAL, normalizeFreeUnlockCounter } from "@/constants/product";

export function resolveFreeUnlockDisplayCounter(input: {
  total?: number | null;
  backendFreeUnlocksUsed?: number | null;
  localUsed?: number | null;
}) {
  const backendUsed =
    typeof input.backendFreeUnlocksUsed === "number" && Number.isFinite(input.backendFreeUnlocksUsed)
      ? input.backendFreeUnlocksUsed
      : null;
  const localUsed = typeof input.localUsed === "number" && Number.isFinite(input.localUsed) ? input.localUsed : 0;

  return normalizeFreeUnlockCounter({
    total: input.total ?? FREE_PRO_UNLOCKS_TOTAL,
    used: backendUsed ?? localUsed,
  });
}

