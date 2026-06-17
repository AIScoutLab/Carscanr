import { FREE_PRO_UNLOCKS_TOTAL, normalizeFreeUnlockCounter } from "@/constants/product";

export function resolveFreeUnlockDisplayCounter(input: {
  total?: number | null;
  backendFreeUnlocksUsed?: number | null;
  backendFreeUnlocksRemaining?: number | null;
  localUsed?: number | null;
}) {
  const limit = normalizeFreeUnlockCounter({ total: input.total ?? FREE_PRO_UNLOCKS_TOTAL }).limit;
  const backendRemaining =
    typeof input.backendFreeUnlocksRemaining === "number" && Number.isFinite(input.backendFreeUnlocksRemaining)
      ? Math.max(0, Math.min(limit, Math.round(input.backendFreeUnlocksRemaining)))
      : null;
  const backendUsed =
    backendRemaining != null
      ? Math.max(0, limit - backendRemaining)
      : typeof input.backendFreeUnlocksUsed === "number" && Number.isFinite(input.backendFreeUnlocksUsed)
        ? input.backendFreeUnlocksUsed
        : null;
  const localUsed = typeof input.localUsed === "number" && Number.isFinite(input.localUsed) ? input.localUsed : 0;

  return normalizeFreeUnlockCounter({
    total: limit,
    used: backendUsed ?? localUsed,
    remaining: backendRemaining ?? undefined,
  });
}
