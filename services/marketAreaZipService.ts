import AsyncStorage from "@react-native-async-storage/async-storage";
import { authService } from "@/services/authService";
import { MarketAreaZipSource, isValidMarketAreaZip, normalizeMarketAreaZip, resolveMarketAreaZip } from "@/lib/marketAreaZip";

const LEGACY_MARKET_AREA_ZIP_STORAGE_KEY_PREFIX = "carscanr.marketAreaZip.v1";
const LEGACY_V2_MARKET_AREA_ZIP_STORAGE_KEY_PREFIX = "carscanr.marketAreaZip.v2";
const LEGACY_V3_MARKET_AREA_ZIP_STORAGE_KEY_PREFIX = "carscanr.marketAreaZip.v3";
const MARKET_AREA_ZIP_STORAGE_KEY_PREFIX = "carscanr.marketAreaZip.v4";

type PersistedMarketAreaZip = {
  zip: string;
  source: Extract<MarketAreaZipSource, "user_input" | "persisted_recent">;
  enteredManually?: boolean;
  storageVersion?: "v3" | "v4";
};

function buildStorageKey(userId: string | null) {
  return `${MARKET_AREA_ZIP_STORAGE_KEY_PREFIX}:${userId ?? "guest"}`;
}

function buildLegacyStorageKey(userId: string | null) {
  return `${LEGACY_MARKET_AREA_ZIP_STORAGE_KEY_PREFIX}:${userId ?? "guest"}`;
}

type MarketAreaZipDebug = {
  storageKey: string;
  storageVersion: "v4";
  wasLegacy60610Ignored: boolean;
};

function buildLegacyV2StorageKey(userId: string | null) {
  return `${LEGACY_V2_MARKET_AREA_ZIP_STORAGE_KEY_PREFIX}:${userId ?? "guest"}`;
}

function buildLegacyV3StorageKey(userId: string | null) {
  return `${LEGACY_V3_MARKET_AREA_ZIP_STORAGE_KEY_PREFIX}:${userId ?? "guest"}`;
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
      enteredManually: parsed.enteredManually !== false,
      storageVersion: parsed.storageVersion === "v4" ? "v4" : "v3",
    };
  } catch {
    return null;
  }
}

function shouldIgnoreLegacyChicagoZip(payload: PersistedMarketAreaZip | null) {
  if (!payload) {
    return false;
  }
  return payload.zip === "60610" && payload.enteredManually !== true;
}

async function loadRawPersistedZip() {
  const user = await authService.getCurrentUser().catch(() => null);
  const perUserKey = buildStorageKey(user?.id ?? null);
  const primary = parsePersistedZipPayload(await AsyncStorage.getItem(perUserKey));
  if (shouldIgnoreLegacyChicagoZip(primary)) {
    await AsyncStorage.removeItem(perUserKey);
  } else if (primary) {
    return {
      persisted: primary,
      debug: {
        storageKey: perUserKey,
        storageVersion: "v4" as const,
        wasLegacy60610Ignored: false,
      },
    };
  }

  if (user?.id) {
    const guestFallbackKey = buildStorageKey(null);
    const guestFallback = parsePersistedZipPayload(await AsyncStorage.getItem(guestFallbackKey));
    if (shouldIgnoreLegacyChicagoZip(guestFallback)) {
      await AsyncStorage.removeItem(guestFallbackKey);
    } else if (guestFallback) {
      return {
        persisted: guestFallback,
        debug: {
          storageKey: guestFallbackKey,
          storageVersion: "v4" as const,
          wasLegacy60610Ignored: false,
        },
      };
    }
  }

  const legacyV2Keys = [buildLegacyV2StorageKey(user?.id ?? null), ...(user?.id ? [buildLegacyV2StorageKey(null)] : [])];
  const legacyV3Keys = [buildLegacyV3StorageKey(user?.id ?? null), ...(user?.id ? [buildLegacyV3StorageKey(null)] : [])];
  let wasLegacy60610Ignored = false;

  for (const legacyV3Key of legacyV3Keys) {
    const legacyPayload = parsePersistedZipPayload(await AsyncStorage.getItem(legacyV3Key));
    if (!legacyPayload) {
      continue;
    }

    if (shouldIgnoreLegacyChicagoZip(legacyPayload)) {
      wasLegacy60610Ignored = true;
      await AsyncStorage.removeItem(legacyV3Key);
      continue;
    }

    await AsyncStorage.setItem(
      perUserKey,
      JSON.stringify({
        zip: legacyPayload.zip,
        source: legacyPayload.source,
        enteredManually: legacyPayload.enteredManually === true,
        storageVersion: "v4" as const,
      } satisfies PersistedMarketAreaZip),
    );
    await AsyncStorage.removeItem(legacyV3Key);
    return {
      persisted: {
        ...legacyPayload,
        enteredManually: legacyPayload.enteredManually === true,
        storageVersion: "v4" as const,
      },
      debug: {
        storageKey: perUserKey,
        storageVersion: "v4" as const,
        wasLegacy60610Ignored,
      },
    };
  }

  for (const legacyV2Key of legacyV2Keys) {
    const legacyPayload = parsePersistedZipPayload(await AsyncStorage.getItem(legacyV2Key));
    if (!legacyPayload) {
      continue;
    }

    if (legacyPayload.zip === "60610") {
      wasLegacy60610Ignored = true;
      await AsyncStorage.removeItem(legacyV2Key);
      continue;
    }

    await AsyncStorage.setItem(
      perUserKey,
      JSON.stringify({
        zip: legacyPayload.zip,
        source: legacyPayload.source,
        enteredManually: legacyPayload.enteredManually !== false,
        storageVersion: "v4" as const,
      } satisfies PersistedMarketAreaZip),
    );
    await AsyncStorage.removeItem(legacyV2Key);
    return {
      persisted: {
        ...legacyPayload,
        storageVersion: "v4" as const,
      },
      debug: {
        storageKey: perUserKey,
        storageVersion: "v4" as const,
        wasLegacy60610Ignored,
      },
    };
  }

  await AsyncStorage.removeItem(buildLegacyStorageKey(user?.id ?? null));
  await AsyncStorage.removeItem(buildLegacyV3StorageKey(user?.id ?? null));
  if (user?.id) {
    await AsyncStorage.removeItem(buildLegacyStorageKey(null));
    await AsyncStorage.removeItem(buildLegacyV3StorageKey(null));
  }

  return {
    persisted: null,
    debug: {
      storageKey: perUserKey,
      storageVersion: "v4" as const,
      wasLegacy60610Ignored,
    },
  };
}

async function clearLegacyStorageArtifacts() {
  const user = await authService.getCurrentUser().catch(() => null);
  await AsyncStorage.removeItem(buildLegacyStorageKey(user?.id ?? null));
  await AsyncStorage.removeItem(buildLegacyV3StorageKey(user?.id ?? null));
  if (user?.id) {
    await AsyncStorage.removeItem(buildLegacyStorageKey(null));
    await AsyncStorage.removeItem(buildLegacyV3StorageKey(null));
  }
}

export type MarketAreaZipHydrationResult = {
  zip: string;
  zipSource: MarketAreaZipSource;
  debug: MarketAreaZipDebug;
};

export const marketAreaZipService = {
  async ensureStorageReady() {
    await clearLegacyStorageArtifacts();
  },

  async getInitialMarketAreaZip(): Promise<MarketAreaZipHydrationResult> {
    const persistedRecentZip = await loadRawPersistedZip();
    const resolved = resolveMarketAreaZip({
      persistedRecentZip: persistedRecentZip.persisted?.zip ?? "",
    });
    return {
      ...resolved,
      debug: persistedRecentZip.debug,
    };
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
        enteredManually: true,
        storageVersion: "v4" as const,
      } satisfies PersistedMarketAreaZip),
    );
  },
};
