import AsyncStorage from "@react-native-async-storage/async-storage";
import { authService } from "@/services/authService";
import { MarketAreaZipSource, isValidMarketAreaZip, normalizeMarketAreaZip, resolveMarketAreaZip } from "@/lib/marketAreaZip";

const LEGACY_MARKET_AREA_ZIP_STORAGE_KEY_PREFIX = "carscanr.marketAreaZip.v1";
const MARKET_AREA_ZIP_STORAGE_KEY_PREFIX = "carscanr.marketAreaZip.v2";

type PersistedMarketAreaZip = {
  zip: string;
  source: Extract<MarketAreaZipSource, "user_input" | "persisted_recent">;
};

function buildStorageKey(userId: string | null) {
  return `${MARKET_AREA_ZIP_STORAGE_KEY_PREFIX}:${userId ?? "guest"}`;
}

function buildLegacyStorageKey(userId: string | null) {
  return `${LEGACY_MARKET_AREA_ZIP_STORAGE_KEY_PREFIX}:${userId ?? "guest"}`;
}

function parsePersistedZipPayload(raw: string | null): PersistedMarketAreaZip | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedMarketAreaZip>;
    const normalizedZip = normalizeMarketAreaZip(parsed.zip);
    if (!isValidMarketAreaZip(normalizedZip)) {
      return null;
    }
    return {
      zip: normalizedZip,
      source: parsed.source === "user_input" ? "user_input" : "persisted_recent",
    };
  } catch {
    return null;
  }
}

async function loadRawPersistedZip() {
  const user = await authService.getCurrentUser().catch(() => null);
  const perUserKey = buildStorageKey(user?.id ?? null);
  const primary = parsePersistedZipPayload(await AsyncStorage.getItem(perUserKey));
  if (primary) {
    return primary;
  }

  if (user?.id) {
    const guestFallback = parsePersistedZipPayload(await AsyncStorage.getItem(buildStorageKey(null)));
    if (guestFallback) {
      return guestFallback;
    }
  }

  // Ignore legacy v1 string storage entirely so old silent defaults can never be revived.
  await AsyncStorage.removeItem(buildLegacyStorageKey(user?.id ?? null));
  if (user?.id) {
    await AsyncStorage.removeItem(buildLegacyStorageKey(null));
  }

  return null;
}

export const marketAreaZipService = {
  async getInitialMarketAreaZip(): Promise<{ zip: string; zipSource: MarketAreaZipSource }> {
    const persistedRecentZip = await loadRawPersistedZip();
    return resolveMarketAreaZip({
      persistedRecentZip: persistedRecentZip?.zip ?? "",
    });
  },

  async saveLastUsedZip(zip: string) {
    const normalizedZip = normalizeMarketAreaZip(zip);
    if (!isValidMarketAreaZip(normalizedZip)) {
      return;
    }
    const user = await authService.getCurrentUser().catch(() => null);
    await AsyncStorage.setItem(
      buildStorageKey(user?.id ?? null),
      JSON.stringify({
        zip: normalizedZip,
        source: "user_input" as const,
      } satisfies PersistedMarketAreaZip),
    );
  },
};
