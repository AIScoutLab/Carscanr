import { test } from "node:test";
import assert from "node:assert/strict";
import { env } from "../src/config/env.js";
import { resetProviders, setProviders } from "../src/lib/providerRegistry.js";
import { resetRepositories, setRepositories } from "../src/lib/repositoryRegistry.js";
import { trendingVehicleService } from "../src/services/trendingVehicleService.js";
import { createTestProviders, createTestRepositories, createVisionProviderResult } from "./helpers/testData.js";

function restoreEnv(previousAppEnv: typeof env.APP_ENV, previousAllowPreload: typeof env.ALLOW_PRELOAD) {
  env.APP_ENV = previousAppEnv;
  env.ALLOW_PRELOAD = previousAllowPreload;
}

test("production trending scheduler blocks preload provider calls", async () => {
  const previousAppEnv = env.APP_ENV;
  const previousAllowPreload = env.ALLOW_PRELOAD;
  const testRepositories = createTestRepositories();
  setRepositories(testRepositories.repositories);
  let specsProviderCalls = 0;
  let visionProviderCalls = 0;
  setProviders({
    ...createTestProviders(),
    specsProviderName: "marketcheck",
    visionProvider: {
      async identifyFromImage() {
        visionProviderCalls += 1;
        return createVisionProviderResult();
      },
    },
    specsProvider: {
      async getVehicleSpecs() {
        specsProviderCalls += 1;
        return null;
      },
      async searchVehicles() {
        specsProviderCalls += 1;
        return [];
      },
      async searchCandidates() {
        specsProviderCalls += 1;
        return [];
      },
    },
  });

  try {
    env.APP_ENV = "production";
    env.ALLOW_PRELOAD = false;
    const interval = trendingVehicleService.startScheduler();
    clearInterval(interval);
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    restoreEnv(previousAppEnv, previousAllowPreload);
    resetRepositories();
    resetProviders();
  }

  assert.equal(specsProviderCalls, 0);
  assert.equal(visionProviderCalls, 0);
  assert.equal(testRepositories.state.providerApiUsageLogs.length, 0);
});

test("production global trending refresh updates rows without live providers", async () => {
  const previousAppEnv = env.APP_ENV;
  const previousAllowPreload = env.ALLOW_PRELOAD;
  const testRepositories = createTestRepositories();
  setRepositories(testRepositories.repositories);
  let specsProviderCalls = 0;
  let visionProviderCalls = 0;
  setProviders({
    ...createTestProviders(),
    specsProviderName: "marketcheck",
    visionProvider: {
      async identifyFromImage() {
        visionProviderCalls += 1;
        return createVisionProviderResult();
      },
    },
    specsProvider: {
      async getVehicleSpecs() {
        specsProviderCalls += 1;
        return null;
      },
      async searchVehicles() {
        specsProviderCalls += 1;
        return [];
      },
      async searchCandidates() {
        specsProviderCalls += 1;
        return [];
      },
    },
  });
  await testRepositories.repositories.vehicleScanPopularity.increment({
    normalizedKey: "2024-toyota-rav4-base",
    year: 2024,
    normalizedMake: "toyota",
    normalizedModel: "rav4",
    normalizedTrim: "base",
    lastSeenAt: "2026-05-19T12:00:00.000Z",
  });

  try {
    env.APP_ENV = "production";
    env.ALLOW_PRELOAD = false;
    await trendingVehicleService.refreshGlobalTrending();
  } finally {
    restoreEnv(previousAppEnv, previousAllowPreload);
    resetRepositories();
    resetProviders();
  }

  const globalTrend = await testRepositories.repositories.vehicleGlobalTrending.findByNormalizedKey("2024-toyota-rav4-base");
  assert.ok(globalTrend);
  assert.equal(specsProviderCalls, 0);
  assert.equal(visionProviderCalls, 0);
  assert.equal(testRepositories.state.providerApiUsageLogs.length, 0);
});
