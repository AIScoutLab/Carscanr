import { createApp } from "./app.js";
import { env, getStartupDiagnostics } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { providers } from "./lib/providerRegistry.js";
import { isUsingMockRepositories } from "./lib/repositoryRegistry.js";
import { supabaseHeartbeatService } from "./services/supabaseHeartbeatService.js";
import { trendingVehicleService, TRENDING_JOB_INTERVAL_MS, TRENDING_PRESEED_SCORE_THRESHOLD } from "./services/trendingVehicleService.js";

const app = createApp();

const host = env.HOST;
const startupDiagnostics = getStartupDiagnostics();

app.listen(env.PORT, host, () => {
  logger.info(
    {
      ...startupDiagnostics,
      usingMockRepositories: isUsingMockRepositories(),
      activeProviders: {
        vision: startupDiagnostics.visionProvider,
        specs: providers.specsProviderName,
        value: providers.valueProviderName,
        listings: providers.listingsProviderName,
      },
    },
    "CarScanr backend startup diagnostics",
  );
  logger.info({ port: env.PORT, host }, "Car Identifier backend listening");
  if (env.NODE_ENV !== "test") {
    supabaseHeartbeatService.triggerStartupHeartbeat();
    trendingVehicleService.startScheduler();
    logger.info(
      {
        intervalMs: TRENDING_JOB_INTERVAL_MS,
        preseedThreshold: TRENDING_PRESEED_SCORE_THRESHOLD,
      },
      "Started global trending scheduler",
    );
  }
});
