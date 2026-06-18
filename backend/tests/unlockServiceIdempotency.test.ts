import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { buildMarketAccessVehicleKey, buildUnlockKey, buildVehicleKey } from "../src/lib/cacheKeys.js";
import { repositories, setRepositories } from "../src/lib/repositoryRegistry.js";
import { db } from "../src/repositories/mockDatabase.js";
import {
  MockSubscriptionsRepository,
  MockUnlockBalanceRepository,
  MockVehicleUnlockRepository,
} from "../src/repositories/mockRepositories.js";
import { UnlockService } from "../src/services/unlockService.js";
import { UserVehicleUnlockRecord, VehicleLookupDescriptor } from "../src/types/domain.js";

const originalRepositories = repositories;

function resetMockState() {
  db.unlockBalances = [];
  db.vehicleUnlocks = [];
  db.subscriptions = [];
  setRepositories({
    ...originalRepositories,
    unlockBalances: new MockUnlockBalanceRepository(),
    vehicleUnlocks: new MockVehicleUnlockRepository(),
    subscriptions: new MockSubscriptionsRepository(),
  });
}

function descriptor(overrides: Partial<VehicleLookupDescriptor> = {}): VehicleLookupDescriptor {
  return {
    year: 2024,
    make: "Toyota",
    model: "Camry",
    trim: "SE",
    vehicleType: "car",
    ...overrides,
  };
}

function unlockKeyForDescriptor(input: VehicleLookupDescriptor) {
  const vehicleKey = buildMarketAccessVehicleKey({
    year: input.year,
    make: input.make,
    model: input.model,
    vehicleType: input.vehicleType,
  });
  const unlock = buildUnlockKey({ vehicleKey });
  assert.ok(unlock.key);
  return { unlockKey: unlock.key, vehicleKey };
}

function legacyUnlockKeyForDescriptor(input: VehicleLookupDescriptor) {
  const vehicleKey = buildVehicleKey({
    year: input.year,
    make: input.make,
    model: input.model,
    trim: input.trim,
    vehicleType: input.vehicleType,
  });
  const unlock = buildUnlockKey({ vehicleKey });
  assert.ok(unlock.key);
  return { unlockKey: unlock.key, vehicleKey };
}

beforeEach(() => {
  resetMockState();
});

after(() => {
  setRepositories(originalRepositories);
});

describe("UnlockService vehicle idempotency", () => {
  test("fresh user one visible unlock leaves two of three free unlocks remaining", async () => {
    const service = new UnlockService();

    const result = await service.grantUnlockForLookup({
      userId: "fresh-user",
      vehicleId: "scan-result-1",
      descriptor: descriptor(),
      scanId: "scan-1",
    });
    const status = await service.getStatus("fresh-user");

    assert.equal(result.allowed, true);
    assert.equal(result.usedUnlock, true);
    assert.equal(result.alreadyUnlocked, false);
    assert.equal(result.freeUnlocksRemaining, 2);
    assert.equal(status.freeUnlocksUsed, 1);
    assert.equal(status.freeUnlocksRemaining, 2);
    assert.equal(db.vehicleUnlocks.filter((row) => row.userId === "fresh-user").length, 1);
  });

  test("two unlock calls for the same user and key consume only one free unlock", async () => {
    const service = new UnlockService();
    const vehicle = descriptor();

    const first = await service.grantUnlockForLookup({
      userId: "duplicate-user",
      vehicleId: "scan-result-duplicate",
      descriptor: vehicle,
      scanId: "scan-duplicate",
    });
    const second = await service.grantUnlockForLookup({
      userId: "duplicate-user",
      vehicleId: "scan-result-duplicate",
      descriptor: vehicle,
      scanId: "scan-duplicate",
    });
    const status = await service.getStatus("duplicate-user");

    assert.equal(first.resultType, "free_unlock_consumed");
    assert.equal(second.resultType, "already_unlocked");
    assert.equal(second.usedUnlock, false);
    assert.equal(status.freeUnlocksUsed, 1);
    assert.equal(status.freeUnlocksRemaining, 2);
    assert.equal(db.vehicleUnlocks.filter((row) => row.userId === "duplicate-user").length, 1);
  });

  test("scan route and detail route compatible keys cannot consume twice for one vehicle", async () => {
    const service = new UnlockService();
    const userId = "compatible-key-user";
    const vehicle = descriptor();
    const legacyKey = legacyUnlockKeyForDescriptor(vehicle);

    db.unlockBalances.push({
      userId,
      freeUnlocksTotal: 3,
      freeUnlocksUsed: 1,
      unlockCredits: 0,
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-17T12:00:00.000Z",
    });
    db.vehicleUnlocks.push({
      id: "existing-trim-unlock",
      userId,
      unlockKey: legacyKey.unlockKey,
      unlockType: "vehicle",
      vehicleKey: legacyKey.vehicleKey,
      sourceVehicleId: "scan-route-vehicle",
      scanId: "scan-compatible",
      createdAt: "2026-06-17T12:00:00.000Z",
    } satisfies UserVehicleUnlockRecord);

    const detailRouteKey = unlockKeyForDescriptor(vehicle);
    assert.notEqual(detailRouteKey.unlockKey, legacyKey.unlockKey);

    const result = await service.grantUnlockForLookup({
      userId,
      vehicleId: "detail-route-vehicle",
      descriptor: vehicle,
      scanId: "scan-compatible",
    });
    const status = await service.getStatus(userId);

    assert.equal(result.resultType, "already_unlocked");
    assert.equal(result.usedUnlock, false);
    assert.equal(result.freeUnlocksRemaining, 2);
    assert.equal(status.freeUnlocksUsed, 1);
    assert.equal(status.freeUnlocksRemaining, 2);
    assert.equal(db.vehicleUnlocks.filter((row) => row.userId === userId).length, 1);
  });
});
