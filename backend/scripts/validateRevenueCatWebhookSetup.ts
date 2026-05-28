import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
const placeholderToken = "local-dev-revenuecat-webhook-token";
const minTokenLength = 32;

dotenv.config({ path: path.join(backendRoot, ".env") });
dotenv.config();

function fail(message: string): never {
  console.error(`RevenueCat webhook setup validation failed: ${message}`);
  process.exit(1);
}

function ok(message: string) {
  console.log(`ok - ${message}`);
}

function warn(message: string) {
  console.warn(`warn - ${message}`);
}

function readProjectFile(relativePath: string) {
  const filePath = path.join(backendRoot, relativePath);
  if (!existsSync(filePath)) {
    fail(`${relativePath} is missing.`);
  }
  return readFileSync(filePath, "utf8");
}

function validateToken() {
  const token = process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN?.trim() ?? "";
  if (!token) {
    fail("REVENUECAT_WEBHOOK_AUTH_TOKEN is not set in the backend environment.");
  }
  if (token === placeholderToken) {
    fail("REVENUECAT_WEBHOOK_AUTH_TOKEN is still the local placeholder value.");
  }
  if (token.length < minTokenLength) {
    fail(`REVENUECAT_WEBHOOK_AUTH_TOKEN must be at least ${minTokenLength} characters.`);
  }
  if (/\s/.test(token)) {
    fail("REVENUECAT_WEBHOOK_AUTH_TOKEN must not contain whitespace.");
  }
  ok("backend RevenueCat webhook auth token is present and strong enough");
}

function validateRouteRegistration() {
  const routes = readProjectFile("src/routes/index.ts");
  const controller = readProjectFile("src/controllers/subscriptionController.ts");
  const service = readProjectFile("src/services/subscriptionService.ts");

  if (!routes.includes('"/revenuecat/webhook"')) {
    fail("POST /api/revenuecat/webhook is not registered in src/routes/index.ts.");
  }
  const webhookRouteIndex = routes.indexOf('"/revenuecat/webhook"');
  const optionalAuthIndex = routes.indexOf("router.use(optionalAuthMiddleware)");
  const requiredAuthIndex = routes.indexOf("router.use(authMiddleware)");
  if (optionalAuthIndex !== -1 && optionalAuthIndex < webhookRouteIndex) {
    fail("POST /api/revenuecat/webhook must be registered before optionalAuthMiddleware so RevenueCat Authorization is not treated as app auth.");
  }
  if (requiredAuthIndex !== -1 && requiredAuthIndex < webhookRouteIndex) {
    fail("POST /api/revenuecat/webhook must be registered before authMiddleware so RevenueCat Authorization is not treated as app auth.");
  }
  if (!controller.includes("processRevenueCatWebhook")) {
    fail("subscription controller is not wired to process RevenueCat webhooks.");
  }
  if (!service.includes("verifyRevenueCatAuthorization") || !service.includes("REVENUECAT_WEBHOOK_AUTH_TOKEN")) {
    fail("RevenueCat webhook auth enforcement is missing from subscriptionService.");
  }
  ok("webhook route is registered and auth enforcement is wired");
}

function validateProductionStartupIfRequested() {
  const forceProductionCheck = process.argv.includes("--production-check");
  const currentAppEnv = process.env.APP_ENV;
  const hostedLike = currentAppEnv === "preview" || currentAppEnv === "production";
  if (!forceProductionCheck && !hostedLike) {
    warn("production startup validation skipped; run with --production-check in a production-like backend environment");
    return;
  }

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "-e", "await import('./src/config/env.ts')"],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        APP_ENV: currentAppEnv === "preview" ? "preview" : "production",
        NODE_ENV: "production",
        AUTH_DEV_BYPASS_ENABLED: "false",
        ALLOW_MOCK_FALLBACKS: "false",
      },
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr]
      .join("\n")
      .replace(/REVENUECAT_WEBHOOK_AUTH_TOKEN=[^\s]+/g, "REVENUECAT_WEBHOOK_AUTH_TOKEN=<redacted>")
      .trim();
    fail(`production backend env validation did not pass.\n${output}`);
  }
  ok("production backend env validation starts successfully");
}

function main() {
  validateToken();
  validateRouteRegistration();
  validateProductionStartupIfRequested();
  console.log("RevenueCat webhook setup validation complete.");
}

main();
