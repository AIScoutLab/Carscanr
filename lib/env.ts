export type MobileAppEnv = "local" | "preview" | "production";

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

export const mobileAppEnv = normalizeEnvName(process.env.EXPO_PUBLIC_APP_ENV);

export const mobileEnv = {
  appEnv: mobileAppEnv,
  apiBaseUrl: normalizeString(process.env.EXPO_PUBLIC_API_BASE_URL),
  supabaseUrl: normalizeString(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: normalizeString(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  planOverride: normalizeString(process.env.EXPO_PUBLIC_PLAN_OVERRIDE),
};

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
  if (isSupabaseMobileConfigured()) {
    return null;
  }
  return "Supabase mobile auth is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY for this build.";
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
