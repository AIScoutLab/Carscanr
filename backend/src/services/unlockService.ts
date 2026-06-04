import crypto from "node:crypto";
import { AppError } from "../errors/appError.js";
import { buildUnlockKey, buildVehicleKey } from "../lib/cacheKeys.js";
import { resolveStoredVehicleRecordById } from "../lib/canonicalVehicleCatalog.js";
import { logger } from "../lib/logger.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { isProPlan } from "../lib/subscription.js";
import { VehicleLookupDescriptor, VehicleRecord } from "../types/domain.js";
import { SubscriptionService } from "./subscriptionService.js";
import { VehicleService } from "./vehicleService.js";

export type UnlockEntitlementResult = {
  isPro: boolean;
  alreadyUnlocked: boolean;
  usedUnlock: boolean;
  remainingUnlocks: number;
  allowed: boolean;
  reason: string;
};

export class UnlockService {
  constructor(
    private readonly subscriptionService = new SubscriptionService(),
    private readonly vehicleService = new VehicleService(),
  ) {}

  private async resolveUnlockableVehicle(vehicleId: string): Promise<VehicleRecord | null> {
    const storedVehicle = await resolveStoredVehicleRecordById(vehicleId);
    if (storedVehicle) {
      return storedVehicle;
    }

    try {
      const liveVehicle = await this.vehicleService.getSpecs(vehicleId);
      return liveVehicle.data ?? null;
    } catch {
      return null;
    }
  }

  async getStatus(userId: string) {
    const balance = await repositories.unlockBalances.getOrCreate(userId);
    const unlocks = await repositories.vehicleUnlocks.listByUser(userId);
    const remaining = Math.max(0, balance.freeUnlocksTotal - balance.freeUnlocksUsed);
    const unlockedVehicleIds = Array.from(
      new Set(
        unlocks.flatMap((unlock) => [unlock.sourceVehicleId, unlock.vehicleKey, unlock.unlockKey]).filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );
    return {
      freeUnlocksTotal: balance.freeUnlocksTotal,
      freeUnlocksUsed: balance.freeUnlocksUsed,
      freeUnlocksRemaining: remaining,
      unlockCreditsRemaining: balance.unlockCredits,
      totalUnlocksAvailable: remaining + balance.unlockCredits,
      unlockedVehicleIds,
    };
  }

  async canRequestPremium(userId: string) {
    const plan = await this.subscriptionService.getActivePlan(userId);
    if (isProPlan(plan)) {
      return { isPro: true, remainingUnlocks: Number.POSITIVE_INFINITY };
    }
    const balance = await repositories.unlockBalances.getOrCreate(userId);
    return {
      isPro: false,
      remainingUnlocks: Math.max(0, balance.freeUnlocksTotal - balance.freeUnlocksUsed),
    };
  }

  async grantUnlockForVehicle(input: {
    userId: string;
    vehicle: VehicleRecord;
    scanId?: string | null;
    requested: boolean;
  }): Promise<UnlockEntitlementResult> {
    const plan = await this.subscriptionService.getActivePlan(input.userId);
    if (isProPlan(plan)) {
      return {
        isPro: true,
        alreadyUnlocked: true,
        usedUnlock: false,
        remainingUnlocks: Number.POSITIVE_INFINITY,
        allowed: true,
        reason: "pro",
      };
    }

    const vehicleKey = buildVehicleKey({
      year: input.vehicle.year,
      make: input.vehicle.make,
      model: input.vehicle.model,
      trim: input.vehicle.trim,
      vehicleType: input.vehicle.vehicleType,
    });

    const unlockKeyResult = buildUnlockKey({ vehicleKey });
    if (!unlockKeyResult.key) {
      throw new AppError(400, "UNLOCK_KEY_MISSING", "Unable to build unlock key for this vehicle.");
    }

    if (!input.requested) {
      const balance = await repositories.unlockBalances.getOrCreate(input.userId);
      const remaining = Math.max(0, balance.freeUnlocksTotal - balance.freeUnlocksUsed);
      return {
        isPro: false,
        alreadyUnlocked: false,
        usedUnlock: false,
        remainingUnlocks: remaining,
        allowed: false,
        reason: "unlock_not_requested",
      };
    }

    const payloadEvaluation = await this.vehicleService.evaluateUnlockPayloadForVehicle(input.vehicle);
    if (!payloadEvaluation.unlockEligible || payloadEvaluation.payloadStrength === "thin" || payloadEvaluation.payloadStrength === "empty") {
      const balance = await repositories.unlockBalances.getOrCreate(input.userId);
      logger.warn(
        {
          label: "UNLOCK_BLOCKED",
          userId: input.userId,
          vehicleId: input.vehicle.id,
          payloadStrength: payloadEvaluation.payloadStrength,
          reasons: payloadEvaluation.reasons,
        },
        "UNLOCK_BLOCKED",
      );
      return {
        isPro: false,
        alreadyUnlocked: false,
        usedUnlock: false,
        remainingUnlocks: Math.max(0, balance.freeUnlocksTotal - balance.freeUnlocksUsed),
        allowed: false,
        reason: "payload_too_thin",
      };
    }

    const result = await repositories.vehicleUnlocks.grantUnlock({
      userId: input.userId,
      unlockKey: unlockKeyResult.key,
      unlockType: unlockKeyResult.type,
      vehicleKey: vehicleKey ?? null,
      sourceVehicleId: input.vehicle.id,
      scanId: input.scanId ?? null,
    });

    logger[result.allowed ? "info" : "warn"](
      {
        label: result.allowed ? "UNLOCK_ALLOWED" : "UNLOCK_DENIED",
        userId: input.userId,
        vehicleId: input.vehicle.id,
        vehicleKey,
        alreadyUnlocked: result.alreadyUnlocked,
        usedUnlock: result.usedUnlock,
        usedUnlockCredit: result.usedUnlockCredit,
        allowed: result.allowed,
        freeUnlocksRemaining: result.freeUnlocksRemaining,
        unlockCreditsRemaining: result.unlockCreditsRemaining,
        reason: result.allowed ? (result.alreadyUnlocked ? "already_unlocked" : "consumed") : "no_free_unlocks",
        payloadStrength: payloadEvaluation.payloadStrength,
      },
      result.allowed ? "UNLOCK_ALLOWED" : "UNLOCK_DENIED",
    );

    return {
      isPro: false,
      alreadyUnlocked: result.alreadyUnlocked,
      usedUnlock: result.usedUnlock,
      remainingUnlocks: result.freeUnlocksRemaining,
      allowed: result.allowed,
      reason: result.allowed ? (result.alreadyUnlocked ? "already_unlocked" : "consumed") : "no_free_unlocks",
    };
  }

  buildUnlockFromVehicle(vehicle: VehicleRecord) {
    const vehicleKey = buildVehicleKey({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      vehicleType: vehicle.vehicleType,
    });
    const unlock = buildUnlockKey({ vehicleKey });
    if (!unlock.key) {
      throw new AppError(400, "UNLOCK_KEY_MISSING", "Unable to build unlock key for this vehicle.");
    }
    return { unlockKey: unlock.key, unlockType: unlock.type, vehicleKey };
  }

  async grantUnlockByVehicleId(input: {
    userId: string;
    vehicleId: string;
    scanId?: string | null;
  }): Promise<UnlockEntitlementResult> {
    const vehicle = await this.resolveUnlockableVehicle(input.vehicleId);
    if (!vehicle) {
      throw new AppError(404, "VEHICLE_NOT_FOUND", "Vehicle not found.");
    }
    return this.grantUnlockForVehicle({
      userId: input.userId,
      vehicle,
      scanId: input.scanId ?? null,
      requested: true,
    });
  }

  async grantUnlockForLookup(input: {
    userId: string;
    vehicleId?: string | null;
    descriptor?: VehicleLookupDescriptor | null;
    scanId?: string | null;
  }): Promise<UnlockEntitlementResult> {
    const plan = await this.subscriptionService.getActivePlan(input.userId);
    if (isProPlan(plan)) {
      return {
        isPro: true,
        alreadyUnlocked: true,
        usedUnlock: false,
        remainingUnlocks: Number.POSITIVE_INFINITY,
        allowed: true,
        reason: "pro",
      };
    }

    if (!input.descriptor && input.vehicleId) {
      const vehicle = await this.resolveUnlockableVehicle(input.vehicleId);
      if (vehicle) {
        return this.grantUnlockForVehicle({
          userId: input.userId,
          vehicle,
          scanId: input.scanId ?? null,
          requested: true,
        });
      }

      logger.warn(
        {
          label: "UNLOCK_VEHICLE_ID_RESOLUTION_FAILED",
          userId: input.userId,
          vehicleId: input.vehicleId,
          scanId: input.scanId ?? null,
          reason: "vehicle_not_found_without_descriptor",
        },
        "UNLOCK_VEHICLE_ID_RESOLUTION_FAILED",
      );
      throw new AppError(404, "VEHICLE_NOT_FOUND", "Vehicle not found.");
    }

    if (!input.descriptor) {
      logger.warn(
        {
          label: "UNLOCK_DESCRIPTOR_MISSING",
          userId: input.userId,
          hasVehicleId: Boolean(input.vehicleId),
          scanId: input.scanId ?? null,
        },
        "UNLOCK_DESCRIPTOR_MISSING",
      );
      throw new AppError(400, "UNLOCK_DESCRIPTOR_MISSING", "Vehicle identity is required to grant an unlock.");
    }

    const vehicleKey = buildVehicleKey({
      year: input.descriptor.year,
      make: input.descriptor.make,
      model: input.descriptor.model,
      trim: input.descriptor.trim,
      vehicleType: input.descriptor.vehicleType,
    });
    const unlockKeyResult = buildUnlockKey({ vehicleKey });
    if (!unlockKeyResult.key) {
      logger.warn(
        {
          label: "UNLOCK_KEY_BUILD_FAILED",
          userId: input.userId,
          hasVehicleId: Boolean(input.vehicleId),
          hasDescriptor: true,
          scanId: input.scanId ?? null,
          vehicleKey,
        },
        "UNLOCK_KEY_BUILD_FAILED",
      );
      throw new AppError(400, "UNLOCK_KEY_MISSING", "Unable to build unlock key for this vehicle.");
    }

    logger.info(
      {
        label: "UNLOCK_DESCRIPTOR_GRANT_ATTEMPT",
        userId: input.userId,
        vehicleKey,
        unlockType: unlockKeyResult.type,
        hasSourceVehicleId: Boolean(input.vehicleId),
        sourceVehicleId: input.vehicleId ?? null,
        scanId: input.scanId ?? null,
      },
      "UNLOCK_DESCRIPTOR_GRANT_ATTEMPT",
    );

    const result = await repositories.vehicleUnlocks.grantUnlock({
      userId: input.userId,
      unlockKey: unlockKeyResult.key,
      unlockType: unlockKeyResult.type,
      vehicleKey: vehicleKey ?? null,
      sourceVehicleId: input.vehicleId ?? null,
      scanId: input.scanId ?? null,
    });

    logger[result.allowed ? "info" : "warn"](
      {
        label: result.allowed ? "UNLOCK_ALLOWED" : "UNLOCK_DENIED",
        userId: input.userId,
        vehicleKey,
        sourceVehicleId: input.vehicleId ?? null,
        alreadyUnlocked: result.alreadyUnlocked,
        usedUnlock: result.usedUnlock,
        usedUnlockCredit: result.usedUnlockCredit,
        allowed: result.allowed,
        freeUnlocksRemaining: result.freeUnlocksRemaining,
        unlockCreditsRemaining: result.unlockCreditsRemaining,
        reason: result.allowed ? (result.alreadyUnlocked ? "already_unlocked" : "consumed") : "no_free_unlocks",
      },
      result.allowed ? "UNLOCK_ALLOWED" : "UNLOCK_DENIED",
    );

    return {
      isPro: false,
      alreadyUnlocked: result.alreadyUnlocked,
      usedUnlock: result.usedUnlock,
      remainingUnlocks: result.freeUnlocksRemaining,
      allowed: result.allowed,
      reason: result.allowed ? (result.alreadyUnlocked ? "already_unlocked" : "consumed") : "no_free_unlocks",
    };
  }
}
