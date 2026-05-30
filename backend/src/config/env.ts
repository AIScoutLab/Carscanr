import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: backendEnvPath });
dotenv.config();

const providerSchema = z.enum(["mock", "marketcheck"]);
const appEnvSchema = z.enum(["local", "preview", "production"]);
const forceProviderModeSchema = z.enum(["live", "mock", "success", "quota_exhausted"]);
const trendingPreseedModeSchema = z.enum(["bootstrap", "growth"]);
const vehicleVisionProviderSchema = z.enum(["mock", "openai", "google", "aws", "clarifai", "ensemble"]);
const DEFAULT_LOCAL_REVENUECAT_WEBHOOK_TOKEN = "local-dev-revenuecat-webhook-token";
const MARKETCHECK_API_KEY_PLACEHOLDERS = new Set([
  "your_marketcheck_api_key",
  "your-marketcheck-api-key",
  "marketcheck_api_key",
  "marketcheck-api-key",
  "changeme",
  "change_me",
  "replace_me",
  "test_key",
  "placeholder",
]);

function booleanEnv(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value !== 0;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();

      if (["true", "1", "yes", "y", "on"].includes(normalized)) {
        return true;
      }

      if (["false", "0", "no", "n", "off"].includes(normalized)) {
        return false;
      }
    }

    return value;
  }, z.boolean().default(defaultValue));
}

const envSchema = z.object({
  BACKEND_BUILD_COMMIT: z
    .string()
    .default(process.env.RENDER_GIT_COMMIT ?? process.env.COMMIT_SHA ?? process.env.SOURCE_VERSION ?? process.env.GIT_COMMIT ?? "unknown"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: appEnvSchema.default(process.env.NODE_ENV === "production" ? "production" : "local"),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGIN: z.string().default("*"),
  ALLOW_MOCK_FALLBACKS: booleanEnv(process.env.NODE_ENV === "production" ? false : true),
  ALLOW_PRELOAD: booleanEnv(process.env.NODE_ENV === "production" ? false : true),
  FORCE_PROVIDER_MODE: forceProviderModeSchema.default("live"),
  VEHICLE_VISION_PROVIDER: vehicleVisionProviderSchema.default(process.env.NODE_ENV === "production" ? "openai" : "ensemble"),
  STRICT_DISPLAY_IDENTITY_LOCK: booleanEnv(true),
  TRENDING_PRESEED_MODE: trendingPreseedModeSchema.default("bootstrap"),
  TRENDING_PRESEED_SCORE_THRESHOLD: z.coerce.number().default(process.env.TRENDING_PRESEED_MODE === "growth" ? 20 : 35),
  TRENDING_PRELOAD_BATCH_LIMIT: z.coerce.number().default(process.env.TRENDING_PRESEED_MODE === "growth" ? 50 : 12),
  SUPABASE_URL: z.string().url().or(z.literal("")).default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_JWT_SECRET: z.string().default(""),
  AUTH_DEV_BYPASS_ENABLED: booleanEnv(false),
  AUTH_DEV_BYPASS_USER_ID: z.string().default("demo-user"),
  AUTH_DEV_BYPASS_EMAIL: z.string().email().default("demo@example.com"),
  UPLOAD_MAX_FILE_SIZE_BYTES: z.coerce.number().default(5 * 1024 * 1024),
  FREE_SCAN_LIMIT_PER_DAY: z.coerce.number().default(5),
  ABUSE_MAX_SCAN_ATTEMPTS_PER_10_MIN: z.coerce.number().default(10),
  VISION_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_VISION_MODEL: z.string().default("gpt-4o"),
  OPENAI_VISION_TIMEOUT_MS: z.coerce.number().default(12000),
  CLARIFAI_API_KEY: z.string().default(""),
  CLARIFAI_BASE_URL: z.string().url().default("https://api.clarifai.com/v2"),
  CLARIFAI_VEHICLE_MODEL_ID: z.string().default("vehicle-recognition"),
  AWS_REGION: z.string().default(""),
  AWS_ACCESS_KEY_ID: z.string().default(""),
  AWS_SECRET_ACCESS_KEY: z.string().default(""),
  SCAN_RATE_LIMIT_PER_MIN: z.coerce.number().default(5),
  UNLOCK_RATE_LIMIT_PER_10_MIN: z.coerce.number().default(10),
  VEHICLE_SPECS_PROVIDER: providerSchema.default("mock"),
  VEHICLE_VALUE_PROVIDER: providerSchema.default("mock"),
  VEHICLE_LISTINGS_PROVIDER: providerSchema.default("mock"),
  MARKETCHECK_ENABLED: booleanEnv(true),
  ENABLE_LIVE_PROVIDER_CALLS: booleanEnv(false),
  ENABLE_BACKGROUND_MARKETCHECK: booleanEnv(false),
  ENABLE_USER_IMAGE_AUTO_APPROVAL: booleanEnv(false),
  MARKETCHECK_API_KEY: z.string().default(""),
  MARKETCHECK_BASE_URL: z.string().url().default("https://api.marketcheck.com"),
  MARKETCHECK_VALUE_RADIUS_MILES: z.coerce.number().default(100),
  MARKETCHECK_MONTHLY_CALL_LIMIT: z.coerce.number().default(500),
  MARKETCHECK_WARN_AT: z.coerce.number().default(400),
  MARKETCHECK_DISABLE_EXTERNAL_CALLS: booleanEnv(false),
  MARKETCHECK_ENABLE_SCAN_ENRICHMENT: booleanEnv(false),
  MARKETCHECK_ENABLE_AUTO_SPECS: booleanEnv(false),
  MARKETCHECK_ENABLE_AUTO_LISTINGS: booleanEnv(false),
  MARKETCHECK_ENABLE_BACKGROUND_REFRESH: booleanEnv(false),
  REVENUECAT_WEBHOOK_AUTH_TOKEN: z.string().default(DEFAULT_LOCAL_REVENUECAT_WEBHOOK_TOKEN),
  PROVIDER_SPECS_CACHE_TTL_HOURS: z.coerce.number().default(24 * 30),
  PROVIDER_VALUES_CACHE_TTL_HOURS: z.coerce.number().default(24),
  PROVIDER_LISTINGS_CACHE_TTL_HOURS: z.coerce.number().default(6),
});

const parsedEnv = envSchema.parse(process.env);

function logStartupEnvDiagnostics(env: typeof parsedEnv) {
  console.info(
    "[startup-env]",
    JSON.stringify({
      backendBuildCommit: env.BACKEND_BUILD_COMMIT,
      appEnv: env.APP_ENV,
      nodeEnv: env.NODE_ENV,
      authDevBypassEnabled: env.AUTH_DEV_BYPASS_ENABLED,
      allowMockFallbacks: env.ALLOW_MOCK_FALLBACKS,
      allowPreload: env.ALLOW_PRELOAD,
      forceProviderMode: env.FORCE_PROVIDER_MODE,
      strictDisplayIdentityLock: env.STRICT_DISPLAY_IDENTITY_LOCK,
      trendingPreseedMode: env.TRENDING_PRESEED_MODE,
      trendingPreseedScoreThreshold: env.TRENDING_PRESEED_SCORE_THRESHOLD,
      trendingPreloadBatchLimit: env.TRENDING_PRELOAD_BATCH_LIMIT,
      vehicleProviders: {
        specs: env.VEHICLE_SPECS_PROVIDER,
        value: env.VEHICLE_VALUE_PROVIDER,
        listings: env.VEHICLE_LISTINGS_PROVIDER,
      },
      marketCheckEnabled: env.MARKETCHECK_ENABLED,
      marketCheckMonthlyCallLimit: env.MARKETCHECK_MONTHLY_CALL_LIMIT,
      marketCheckWarnAt: env.MARKETCHECK_WARN_AT,
      marketCheckDisableExternalCalls: env.MARKETCHECK_DISABLE_EXTERNAL_CALLS,
      marketCheckEnableScanEnrichment: env.MARKETCHECK_ENABLE_SCAN_ENRICHMENT,
      marketCheckEnableAutoSpecs: env.MARKETCHECK_ENABLE_AUTO_SPECS,
      marketCheckEnableAutoListings: env.MARKETCHECK_ENABLE_AUTO_LISTINGS,
      marketCheckEnableBackgroundRefresh: env.MARKETCHECK_ENABLE_BACKGROUND_REFRESH,
      enableLiveProviderCalls: env.ENABLE_LIVE_PROVIDER_CALLS,
      enableBackgroundMarketCheck: env.ENABLE_BACKGROUND_MARKETCHECK,
      enableUserImageAutoApproval: env.ENABLE_USER_IMAGE_AUTO_APPROVAL,
      marketCheckConfigured: Boolean(env.MARKETCHECK_API_KEY),
      marketCheckCredentialState: getMarketCheckCredentialState(env.MARKETCHECK_API_KEY),
      revenueCatWebhookConfigured: Boolean(env.REVENUECAT_WEBHOOK_AUTH_TOKEN),
    }),
  );
}

function isHostedLikeAppEnv(appEnv: z.infer<typeof appEnvSchema>) {
  return appEnv === "preview" || appEnv === "production";
}

function getMarketCheckCredentialState(apiKey: string) {
  const normalized = apiKey.trim().toLowerCase();
  if (!normalized) {
    return "missing";
  }

  return MARKETCHECK_API_KEY_PLACEHOLDERS.has(normalized) ? "placeholder" : "configured";
}

export function isLiveProviderCallsEnabledForEnv(input: {
  appEnv: z.infer<typeof appEnvSchema>;
  enableLiveProviderCalls: boolean;
}) {
  if (isHostedLikeAppEnv(input.appEnv)) {
    return true;
  }

  return input.enableLiveProviderCalls;
}

function validateEnv(env: typeof parsedEnv) {
  const issues: string[] = [];
  const hostedLike = isHostedLikeAppEnv(env.APP_ENV);
  const usingMarketCheck =
    env.VEHICLE_SPECS_PROVIDER === "marketcheck" ||
    env.VEHICLE_VALUE_PROVIDER === "marketcheck" ||
    env.VEHICLE_LISTINGS_PROVIDER === "marketcheck";

  if (env.NODE_ENV === "production" && env.AUTH_DEV_BYPASS_ENABLED) {
    issues.push("AUTH_DEV_BYPASS_ENABLED must be false when NODE_ENV=production.");
  }

  if (hostedLike && env.AUTH_DEV_BYPASS_ENABLED) {
    issues.push("AUTH_DEV_BYPASS_ENABLED must be false for preview and production deployments.");
  }

  if (hostedLike && env.ALLOW_MOCK_FALLBACKS) {
    issues.push("ALLOW_MOCK_FALLBACKS must be false for preview and production deployments.");
  }

  if (hostedLike && !env.SUPABASE_URL) {
    issues.push("SUPABASE_URL is required for preview and production deployments.");
  }

  if (hostedLike && !env.SUPABASE_SERVICE_ROLE_KEY) {
    issues.push("SUPABASE_SERVICE_ROLE_KEY is required for preview and production deployments.");
  }

  if (hostedLike && !env.SUPABASE_JWT_SECRET) {
    issues.push("SUPABASE_JWT_SECRET is required for preview and production deployments.");
  }

  if (hostedLike && env.VEHICLE_VISION_PROVIDER === "mock") {
    issues.push("VEHICLE_VISION_PROVIDER cannot be mock for preview and production deployments.");
  }

  if ((env.VEHICLE_VISION_PROVIDER === "openai" || env.VEHICLE_VISION_PROVIDER === "ensemble") && !env.OPENAI_API_KEY && env.NODE_ENV === "production") {
    issues.push("OPENAI_API_KEY is required for production when VEHICLE_VISION_PROVIDER relies on OpenAI.");
  }

  if (hostedLike && env.VEHICLE_SPECS_PROVIDER === "mock") {
    issues.push("VEHICLE_SPECS_PROVIDER cannot be mock for preview and production deployments.");
  }

  if (hostedLike && env.VEHICLE_VALUE_PROVIDER === "mock") {
    issues.push("VEHICLE_VALUE_PROVIDER cannot be mock for preview and production deployments.");
  }

  if (hostedLike && env.VEHICLE_LISTINGS_PROVIDER === "mock") {
    issues.push("VEHICLE_LISTINGS_PROVIDER cannot be mock for preview and production deployments.");
  }

  const marketCheckCredentialState = getMarketCheckCredentialState(env.MARKETCHECK_API_KEY);

  if (usingMarketCheck && marketCheckCredentialState === "missing") {
    issues.push("MARKETCHECK_API_KEY is required when any MarketCheck provider is enabled.");
  }

  if (hostedLike && usingMarketCheck && marketCheckCredentialState === "placeholder") {
    issues.push("MARKETCHECK_API_KEY must be a real backend-only MarketCheck credential for preview and production deployments.");
  }

  if (hostedLike && (!env.REVENUECAT_WEBHOOK_AUTH_TOKEN || env.REVENUECAT_WEBHOOK_AUTH_TOKEN === DEFAULT_LOCAL_REVENUECAT_WEBHOOK_TOKEN)) {
    issues.push("REVENUECAT_WEBHOOK_AUTH_TOKEN must be set to a production secret for preview and production deployments.");
  }

  if (!env.CORS_ORIGIN) {
    issues.push("CORS_ORIGIN must not be empty.");
  }

  if (issues.length > 0) {
    throw new Error(`Invalid backend environment configuration:\n- ${issues.join("\n- ")}`);
  }

  return env;
}

logStartupEnvDiagnostics(parsedEnv);

export const env = validateEnv(parsedEnv);

export function isHostedAppEnv() {
  return isHostedLikeAppEnv(env.APP_ENV);
}

export function isLiveProviderCallsEnabled() {
  return isLiveProviderCallsEnabledForEnv({
    appEnv: env.APP_ENV,
    enableLiveProviderCalls: env.ENABLE_LIVE_PROVIDER_CALLS,
  });
}

export function isMarketCheckScanEnrichmentEnabled() {
  return env.MARKETCHECK_ENABLE_SCAN_ENRICHMENT && isLiveProviderCallsEnabled();
}

export function isMarketCheckAutoSpecsEnabled() {
  return env.MARKETCHECK_ENABLE_AUTO_SPECS && isLiveProviderCallsEnabled();
}

export function isMarketCheckAutoListingsEnabled() {
  return env.MARKETCHECK_ENABLE_AUTO_LISTINGS && isLiveProviderCallsEnabled();
}

export function isMarketCheckBackgroundRefreshEnabled() {
  return env.MARKETCHECK_ENABLE_BACKGROUND_REFRESH && env.ENABLE_BACKGROUND_MARKETCHECK && isLiveProviderCallsEnabled();
}

export function getStartupDiagnostics() {
  const supabaseHost = env.SUPABASE_URL
    ? (() => {
        try {
          return new URL(env.SUPABASE_URL).host;
        } catch {
          return "invalid-supabase-url";
        }
      })()
    : null;
  return {
    backendBuildCommit: env.BACKEND_BUILD_COMMIT,
    nodeEnv: env.NODE_ENV,
    appEnv: env.APP_ENV,
    port: env.PORT,
    host: env.HOST,
    allowMockFallbacks: env.ALLOW_MOCK_FALLBACKS,
      allowPreload: env.ALLOW_PRELOAD,
      forceProviderMode: env.FORCE_PROVIDER_MODE,
      vehicleVisionProvider: env.VEHICLE_VISION_PROVIDER,
      strictDisplayIdentityLock: env.STRICT_DISPLAY_IDENTITY_LOCK,
    trendingPreseedMode: env.TRENDING_PRESEED_MODE,
    trendingPreseedScoreThreshold: env.TRENDING_PRESEED_SCORE_THRESHOLD,
    trendingPreloadBatchLimit: env.TRENDING_PRELOAD_BATCH_LIMIT,
    authDevBypassEnabled: env.AUTH_DEV_BYPASS_ENABLED,
    supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_JWT_SECRET),
    supabaseHost,
    openAIConfigured: Boolean(env.OPENAI_API_KEY),
    visionProvider: env.VEHICLE_VISION_PROVIDER,
    vehicleProviders: {
      specs: env.VEHICLE_SPECS_PROVIDER,
      value: env.VEHICLE_VALUE_PROVIDER,
      listings: env.VEHICLE_LISTINGS_PROVIDER,
    },
    marketCheckEnabled: env.MARKETCHECK_ENABLED,
    marketCheckMonthlyCallLimit: env.MARKETCHECK_MONTHLY_CALL_LIMIT,
    marketCheckWarnAt: env.MARKETCHECK_WARN_AT,
    marketCheckDisableExternalCalls: env.MARKETCHECK_DISABLE_EXTERNAL_CALLS,
    marketCheckEnableScanEnrichment: env.MARKETCHECK_ENABLE_SCAN_ENRICHMENT,
    marketCheckEnableAutoSpecs: env.MARKETCHECK_ENABLE_AUTO_SPECS,
    marketCheckEnableAutoListings: env.MARKETCHECK_ENABLE_AUTO_LISTINGS,
    marketCheckEnableBackgroundRefresh: env.MARKETCHECK_ENABLE_BACKGROUND_REFRESH,
    liveProviderCallsEnabled: isLiveProviderCallsEnabled(),
    enableBackgroundMarketCheck: env.ENABLE_BACKGROUND_MARKETCHECK,
    enableUserImageAutoApproval: env.ENABLE_USER_IMAGE_AUTO_APPROVAL,
    marketCheckConfigured: Boolean(env.MARKETCHECK_API_KEY),
    marketCheckCredentialState: getMarketCheckCredentialState(env.MARKETCHECK_API_KEY),
    revenueCatWebhookConfigured: Boolean(env.REVENUECAT_WEBHOOK_AUTH_TOKEN),
  };
}
