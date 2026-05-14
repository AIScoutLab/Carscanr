export type MarketAreaZipSource =
  | "user_input"
  | "profile"
  | "persisted_recent"
  | "device_location"
  | "blank"
  | "unknown";

export function normalizeMarketAreaZip(value: string | null | undefined) {
  if (typeof value !== "string") {
    return "";
  }
  const digitsOnly = value.replace(/\D+/g, "");
  return digitsOnly.slice(0, 5);
}

export function isValidMarketAreaZip(value: string | null | undefined) {
  return normalizeMarketAreaZip(value).length === 5;
}

export function resolveMarketAreaZip(input: {
  currentUserInputZip?: string | null;
  profileZip?: string | null;
  persistedRecentZip?: string | null;
  deviceLocationZip?: string | null;
}) {
  const normalizedUserInputZip = normalizeMarketAreaZip(input.currentUserInputZip);
  if (normalizedUserInputZip.length === 5) {
    return {
      zip: normalizedUserInputZip,
      zipSource: "user_input" as const,
    };
  }

  const normalizedProfileZip = normalizeMarketAreaZip(input.profileZip);
  if (normalizedProfileZip.length === 5) {
    return {
      zip: normalizedProfileZip,
      zipSource: "profile" as const,
    };
  }

  const normalizedPersistedRecentZip = normalizeMarketAreaZip(input.persistedRecentZip);
  if (normalizedPersistedRecentZip.length === 5) {
    return {
      zip: normalizedPersistedRecentZip,
      zipSource: "persisted_recent" as const,
    };
  }

  const normalizedDeviceLocationZip = normalizeMarketAreaZip(input.deviceLocationZip);
  if (normalizedDeviceLocationZip.length === 5) {
    return {
      zip: normalizedDeviceLocationZip,
      zipSource: "device_location" as const,
    };
  }

  return {
    zip: "",
    zipSource: "blank" as const,
  };
}
