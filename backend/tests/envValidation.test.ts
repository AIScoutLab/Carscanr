import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runEnvImport(overrides: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", "--eval", "await import('./src/config/env.ts')"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_ENV: "production",
      AUTH_DEV_BYPASS_ENABLED: "false",
      ALLOW_MOCK_FALLBACKS: "false",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      SUPABASE_JWT_SECRET: "test-jwt-secret",
      VEHICLE_VISION_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key",
      VEHICLE_SPECS_PROVIDER: "marketcheck",
      VEHICLE_VALUE_PROVIDER: "marketcheck",
      VEHICLE_LISTINGS_PROVIDER: "marketcheck",
      MARKETCHECK_BASE_URL: "https://api.marketcheck.com",
      REVENUECAT_WEBHOOK_AUTH_TOKEN: "test-revenuecat-webhook-token",
      CORS_ORIGIN: "*",
      ...overrides,
    },
    encoding: "utf8",
  });
}

for (const placeholder of ["your_marketcheck_api_key", "changeme", "test_key", "placeholder"]) {
  test(`production MarketCheck config rejects placeholder API key: ${placeholder}`, () => {
    const result = runEnvImport({ MARKETCHECK_API_KEY: placeholder });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /MARKETCHECK_API_KEY must be a real backend-only MarketCheck credential/);
  });
}

test("production MarketCheck config accepts a non-placeholder API key from env", () => {
  const result = runEnvImport({ MARKETCHECK_API_KEY: "test-real-marketcheck-key-for-env-validation" });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
