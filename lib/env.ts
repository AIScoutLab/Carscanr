import Constants from "expo-constants";
import * as Updates from "expo-updates";

export type MobileAppEnv = "local" | "preview" | "production";

type ExpoExtraPublicEnv = {
  apiBaseUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  planOverride?: string;
  revenueCatIosApiKey?: string;
  revenueCatEntitlementId?: string;
  showQaDebug?: string;
};

type ExpoExtraShape = {
  appEnv?: string;
  publicEnv?: ExpoExtraPublicEnv;
  expoClient?: {
    extra?: {
      appEnv?: string;
      publicEnv?: ExpoExtraPublicEnv;
    };
  };
};

function mergePublicEnv(target: ExpoExtraPublicEnv, source?: ExpoExtraPublicEnv | null) {
  if (!source) {
    return target;
  }
  return {
    apiBaseUrl: target.apiBaseUrl || source.apiBaseUrl,
    supabaseUrl: target.supabaseUrl || source.supabaseUrl,
    supabaseAnonKey: target.supabaseAnonKey || source.supabaseAnonKey,
    planOverride: target.planOverride || source.planOverride,
    revenueCatIosApiKey: target.revenueCatIosApiKey || source.revenueCatIosApiKey,
    revenueCatEntitlementId: target.revenueCatEntitlementId || source.revenueCatEntitlementId,
    showQaDebug: target.showQaDebug || source.showQaDebug,
  };
}

function getExpoExtraCandidates() {
  const updatesManifestExtra = (Updates.manifest && "extra" in Updates.manifest ? Updates.manifest.extra : undefined) as ExpoExtraShape | undefined;
  const manifest2Extra = Constants.manifest2?.extra as ExpoExtraShape | undefined;
  const manifestValue = Constants.manifest as (ExpoExtraShape & { extra?: ExpoExtraShape }) | null;
  const manifestExtra = (manifestValue?.extra ?? manifestValue) as ExpoExtraShape | undefined;
  const expoConfigExtra = Constants.expoConfig?.extra as ExpoExtraShape | undefined;

  return [
    { source: "updates-manifest-extra-publicEnv", publicEnv: updatesManifestExtra?.publicEnv },
    { source: "updates-manifest-expoClient-extra-publicEnv", publicEnv: updatesManifestExtra?.expoClient?.extra?.publicEnv },
    { source: "expo-config-extra-publicEnv", publicEnv: expoConfigExtra?.publicEnv },
    { source: "manifest2-extra-publicEnv", publicEnv: manifest2Extra?.publicEnv },
    { source: "manifest2-expoClient-extra-publicEnv", publicEnv: manifest2Extra?.expoClient?.extra?.publicEnv },
    { source: "manifest-extra-publicEnv", publicEnv: manifestExtra?.publicEnv },
    { source: "manifest-expoClient-extra-publicEnv", publicEnv: manifestExtra?.expoClient?.extra?.publicEnv },
  ] as const;
}

function getExpoExtraPublicEnv() {
  const candidates = getExpoExtraCandidates();
  let values: ExpoExtraPublicEnv = {};
  const sourcesUsed: string[] = [];

  candidates.forEach((candidate) => {
    const before = JSON.stringify(values);
    values = mergePublicEnv(values, candidate.publicEnv);
    if (candidate.publicEnv && JSON.stringify(values) !== before) {
      sourcesUsed.push(candidate.source);
    }
  });

  return {
    values,
    sourcesUsed,
  };
}

function getExpoAppEnvCandidate() {
  const updatesManifestExtra = (Updates.manifest && "extra" in Updates.manifest ? Updates.manifest.extra : undefined) as ExpoExtraShape | undefined;
  const manifest2Extra = Constants.manifest2?.extra as ExpoExtraShape | undefined;
  const manifestValue = Constants.manifest as (ExpoExtraShape & { extra?: ExpoExtraShape }) | null;
  const manifestExtra = (manifestValue?.extra ?? manifestValue) as ExpoExtraShape | undefined;
  const expoConfigExtra = Constants.expoConfig?.extra as ExpoExtraShape | undefined;

  return (
    process.env.EXPO_PUBLIC_APP_ENV ??
    expoConfigExtra?.appEnv ??
    expoConfigExtra?.expoClient?.extra?.appEnv ??
    updatesManifestExtra?.appEnv ??
    updatesManifestExtra?.expoClient?.extra?.appEnv ??
    manifest2Extra?.appEnv ??
    manifest2Extra?.expoClient?.extra?.appEnv ??
    manifestExtra?.appEnv ??
    manifestExtra?.expoClient?.extra?.appEnv
  );
}

function normalizeEnvName(value: string | undefined): MobileAppEnv {
  if (value === "preview" || value === "production") {
    return value;
  }
  return "local";
}

function normalizeString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
}

function isPlaceholderValue(value: string) {
  return (
    !value ||
    value.includes("your-project") ||
    value.includes("your-anon-key") ||
    value.includes("public-anon-key-placeholder") ||
    value.includes("carscanr.example.com") ||
    value.includes("api.carscanr.example.com") ||
    value.includes("your-eas-project-id") ||
    value.includes("yourname")
  );
}

function isValidHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const expoExtraPublicEnv = getExpoExtraPublicEnv();

export const mobileAppEnv = normalizeEnvName(getExpoAppEnvCandidate());

export const mobileEnv = {
  appEnv: mobileAppEnv,
  apiBaseUrl: normalizeString(expoExtraPublicEnv.values.apiBaseUrl || process.env.EXPO_PUBLIC_API_BASE_URL),
  supabaseUrl: normalizeString(expoExtraPublicEnv.values.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: normalizeString(expoExtraPublicEnv.values.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  planOverride: normalizeString(expoExtraPublicEnv.values.planOverride || process.env.EXPO_PUBLIC_PLAN_OVERRIDE),
  revenueCatIosApiKey: normalizeString(expoExtraPublicEnv.values.revenueCatIosApiKey || process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY),
  revenueCatEntitlementId: normalizeString(expoExtraPublicEnv.values.revenueCatEntitlementId || process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID),
  showQaDebug: normalizeString(expoExtraPublicEnv.values.showQaDebug || process.env.EXPO_PUBLIC_SHOW_QA_DEBUG),
};

export const requiredExpoPublicEnvKeys = [
  "EXPO_PUBLIC_API_BASE_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
] as const;

export function getMobileEnvDiagnostics() {
  return {
    appEnv: mobileEnv.appEnv,
    envSource: {
      apiBaseUrl: expoExtraPublicEnv.values.apiBaseUrl ? expoExtraPublicEnv.sourcesUsed.join(",") || "expo-extra" : process.env.EXPO_PUBLIC_API_BASE_URL ? "process-env" : "missing",
      supabaseUrl: expoExtraPublicEnv.values.supabaseUrl ? expoExtraPublicEnv.sourcesUsed.join(",") || "expo-extra" : process.env.EXPO_PUBLIC_SUPABASE_URL ? "process-env" : "missing",
      supabaseAnonKey: expoExtraPublicEnv.values.supabaseAnonKey ? expoExtraPublicEnv.sourcesUsed.join(",") || "expo-extra" : process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ? "process-env" : "missing",
    },
    executionEnvironment: Constants.executionEnvironment,
    expoConfigPresent: Boolean(Constants.expoConfig),
    manifestPresent: Boolean(Constants.manifest),
    manifest2Present: Boolean(Constants.manifest2),
    updatesManifestPresent: Boolean(Updates.manifest && "extra" in Updates.manifest),
    apiBaseUrlPresent: Boolean(mobileEnv.apiBaseUrl),
    supabaseUrlPresent: Boolean(mobileEnv.supabaseUrl),
    supabaseAnonKeyPresent: Boolean(mobileEnv.supabaseAnonKey),
    missingKeys: requiredExpoPublicEnvKeys.filter((key) => {
      switch (key) {
        case "EXPO_PUBLIC_API_BASE_URL":
          return !mobileEnv.apiBaseUrl;
        case "EXPO_PUBLIC_SUPABASE_URL":
          return !mobileEnv.supabaseUrl;
        case "EXPO_PUBLIC_SUPABASE_ANON_KEY":
          return !mobileEnv.supabaseAnonKey;
        default:
          return false;
      }
    }),
  };
}

export function isPreviewLikeMobileEnv() {
  return mobileEnv.appEnv === "preview" || mobileEnv.appEnv === "production";
}

export function isSupabaseMobileConfigured() {
  return (
    isValidHttpUrl(mobileEnv.supabaseUrl) &&
    !isPlaceholderValue(mobileEnv.supabaseUrl) &&
    !isPlaceholderValue(mobileEnv.supabaseAnonKey)
  );
}

export function getSupabaseMobileConfigError() {
  if (!isValidHttpUrl(mobileEnv.supabaseUrl) || isPlaceholderValue(mobileEnv.supabaseUrl)) {
    return "Supabase mobile auth is not configured. Set a valid EXPO_PUBLIC_SUPABASE_URL for this build.";
  }
  if (isPreviewLikeMobileEnv() && !mobileEnv.supabaseUrl.startsWith("https://")) {
    return "EXPO_PUBLIC_SUPABASE_URL must use HTTPS for preview and production builds.";
  }
  if (isPlaceholderValue(mobileEnv.supabaseAnonKey)) {
    return "Supabase mobile auth is not configured. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for this build.";
  }
  return null;
}

export function getMobileStartupConfigError() {
  try {
    getApiBaseUrlOrThrow();
  } catch (error) {
    return error instanceof Error ? error.message : "Missing or invalid EXPO_PUBLIC_API_BASE_URL.";
  }

  return getSupabaseMobileConfigError();
}

export function assertMobileStartupConfig() {
  const configError = getMobileStartupConfigError();

  if (configError) {
    throw new Error(configError);
  }
}

export function getApiBaseUrlOrThrow() {
  if (!mobileEnv.apiBaseUrl || isPlaceholderValue(mobileEnv.apiBaseUrl) || !isValidHttpUrl(mobileEnv.apiBaseUrl)) {
    throw new Error("Missing or invalid EXPO_PUBLIC_API_BASE_URL.");
  }

  if (isPreviewLikeMobileEnv() && !mobileEnv.apiBaseUrl.startsWith("https://")) {
    throw new Error("EXPO_PUBLIC_API_BASE_URL must use HTTPS for preview and production builds.");
  }

  return mobileEnv.apiBaseUrl.replace(/\/$/, "");
}

export function getDevPlanOverride() {
  if (mobileEnv.appEnv !== "local") {
    return null;
  }
  const value = mobileEnv.planOverride.toLowerCase();
  return value === "free" || value === "pro" ? value : null;
}
