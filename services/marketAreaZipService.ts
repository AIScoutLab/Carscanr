import AsyncStorage from "@react-native-async-storage/async-storage";
import { authService } from "@/services/authService";
import { MarketAreaZipSource, isValidMarketAreaZip, normalizeMarketAreaZip, resolveMarketAreaZip } from "@/lib/marketAreaZip";

const MARKET_AREA_ZIP_STORAGE_KEY_PREFIX = "carscanr.marketAreaZip.v1";

function buildStorageKey(userId: string | null) {
  return `${MARKET_AREA_ZIP_STORAGE_KEY_PREFIX}:${userId ?? "guest"}`;
}

async function loadRawPersistedZip() {
  const user = await authService.getCurrentUser().catch(() => null);
  const perUserKey = buildStorageKey(user?.id ?? null);
  const primary = await AsyncStorage.getItem(perUserKey);
  if (isValidMarketAreaZip(primary)) {
    return normalizeMarketAreaZip(primary);
  }

  if (user?.id) {
    const guestFallback = await AsyncStorage.getItem(buildStorageKey(null));
    if (isValidMarketAreaZip(guestFallback)) {
      return normalizeMarketAreaZip(guestFallback);
    }
  }

  return "";
}

export const marketAreaZipService = {
  async getInitialMarketAreaZip(): Promise<{ zip: string; zipSource: MarketAreaZipSource }> {
    const persistedRecentZip = await loadRawPersistedZip();
    return resolveMarketAreaZip({
      persistedRecentZip,
    });
  },

  async saveLastUsedZip(zip: string) {
    const normalizedZip = normalizeMarketAreaZip(zip);
    if (!isValidMarketAreaZip(normalizedZip)) {
      return;
    }
    const user = await authService.getCurrentUser().catch(() => null);
    await AsyncStorage.setItem(buildStorageKey(user?.id ?? null), normalizedZip);
  },
};
