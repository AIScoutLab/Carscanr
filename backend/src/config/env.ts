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

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: appEnvSchema.default(process.env.NODE_ENV === "production" ? "production" : "local"),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGIN: z.string().default("*"),
  ALLOW_MOCK_FALLBACKS: z.coerce.boolean().default(process.env.NODE_ENV === "production" ? false : true),
  SUPABASE_URL: z.string().url().or(z.literal("")).default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_JWT_SECRET: z.string().default(""),
  AUTH_DEV_BYPASS_ENABLED: z.coerce.boolean().default(false),
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
  SCAN_RATE_LIMIT_PER_MIN: z.coerce.number().default(5),
  UNLOCK_RATE_LIMIT_PER_10_MIN: z.coerce.number().default(10),
  VEHICLE_SPECS_PROVIDER: providerSchema.default("mock"),
  VEHICLE_VALUE_PROVIDER: providerSchema.default("mock"),
  VEHICLE_LISTINGS_PROVIDER: providerSchema.default("mock"),
  MARKETCHECK_API_KEY: z.string().default(""),
  MARKETCHECK_BASE_URL: z.string().url().default("https://api.marketcheck.com"),
  MARKETCHECK_VALUE_RADIUS_MILES: z.coerce.number().default(100),
  PROVIDER_SPECS_CACHE_TTL_HOURS: z.coerce.number().default(24 * 30),
  PROVIDER_VALUES_CACHE_TTL_HOURS: z.coerce.number().default(24),
  PROVIDER_LISTINGS_CACHE_TTL_HOURS: z.coerce.number().default(6),
});

const parsedEnv = envSchema.parse(process.env);

function isHostedLikeAppEnv(appEnv: z.infer<typeof appEnvSchema>) {
  return appEnv === "preview" || appEnv === "production";
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

  if (hostedLike && env.VISION_PROVIDER === "mock") {
    issues.push("VISION_PROVIDER cannot be mock for preview and production deployments.");
  }

  if (env.VISION_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
    issues.push("OPENAI_API_KEY is required when VISION_PROVIDER=openai.");
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

  if (usingMarketCheck && !env.MARKETCHECK_API_KEY) {
    issues.push("MARKETCHECK_API_KEY is required when any MarketCheck provider is enabled.");
  }

  if (!env.CORS_ORIGIN) {
    issues.push("CORS_ORIGIN must not be empty.");
  }

  if (issues.length > 0) {
    throw new Error(`Invalid backend environment configuration:\n- ${issues.join("\n- ")}`);
  }

  return env;
}

export const env = validateEnv(parsedEnv);

export function isHostedAppEnv() {
  return isHostedLikeAppEnv(env.APP_ENV);
}

export function getStartupDiagnostics() {
  return {
    nodeEnv: env.NODE_ENV,
    appEnv: env.APP_ENV,
    port: env.PORT,
    host: env.HOST,
    allowMockFallbacks: env.ALLOW_MOCK_FALLBACKS,
    authDevBypassEnabled: env.AUTH_DEV_BYPASS_ENABLED,
    supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_JWT_SECRET),
    openAIConfigured: Boolean(env.OPENAI_API_KEY),
    visionProvider: env.VISION_PROVIDER,
    vehicleProviders: {
      specs: env.VEHICLE_SPECS_PROVIDER,
      value: env.VEHICLE_VALUE_PROVIDER,
      listings: env.VEHICLE_LISTINGS_PROVIDER,
    },
    marketCheckConfigured: Boolean(env.MARKETCHECK_API_KEY),
  };
}
