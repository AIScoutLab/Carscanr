import { Request, Response } from "express";
import { AppError } from "../errors/appError.js";
import { buildUnlockKey, buildVehicleKey } from "../lib/cacheKeys.js";
import { resolveStoredVehicleRecordById } from "../lib/canonicalVehicleCatalog.js";
import { sendSuccess } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { isProPlan } from "../lib/subscription.js";
import { normalizeVehicleBadgeAlias } from "../lib/vehicleAliases.js";
import { env, getStartupDiagnostics } from "../config/env.js";
import { SubscriptionService } from "../services/subscriptionService.js";
import { VehicleService } from "../services/vehicleService.js";
import { VehicleLookupDescriptor, VehicleType } from "../types/domain.js";

function normalizeModelToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\+/g, " ")
    .replace(/[\s-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
  return normalized.length > 0 ? normalized : null;
}

function readLookupDescriptor(query: Request["query"]): VehicleLookupDescriptor | null {
  const year = Number(query.year);
  const make = typeof query.make === "string" ? query.make.trim() : "";
  const model = typeof query.model === "string" ? query.model.trim() : "";
  const yearRangeStart = Number(query.yearRangeStart);
  const yearRangeEnd = Number(query.yearRangeEnd);
  if (!Number.isFinite(year) || !make || !model) {
    return null;
  }

  return {
    year,
    make,
    model,
    trim: typeof query.trim === "string" && query.trim.trim().length > 0 ? query.trim.trim() : null,
    yearRange:
      Number.isFinite(yearRangeStart) && Number.isFinite(yearRangeEnd)
        ? {
            start: Math.min(yearRangeStart, yearRangeEnd),
            end: Math.max(yearRangeStart, yearRangeEnd),
          }
        : null,
    vehicleType:
      typeof query.vehicleType === "string" && query.vehicleType.trim().length > 0
        ? (query.vehicleType.trim().toLowerCase() as VehicleType)
        : null,
    bodyStyle: typeof query.bodyStyle === "string" && query.bodyStyle.trim().length > 0 ? query.bodyStyle.trim() : null,
    normalizedModel: normalizeModelToken(query.normalizedModel ?? query.model),
  };
}

function readOptionalBoolean(queryValue: unknown): boolean | undefined {
  if (typeof queryValue === "boolean") {
    return queryValue;
  }
  if (typeof queryValue === "number") {
    if (queryValue === 1) return true;
    if (queryValue === 0) return false;
    return undefined;
  }
  if (typeof queryValue !== "string") {
    return undefined;
  }
  const normalized = queryValue.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

export class VehicleController {
  constructor(
    private readonly vehicleService: VehicleService,
    private readonly subscriptionService = new SubscriptionService(),
  ) {}

  private isLiveMarketRequest(input: {
    allowLive?: boolean;
    forceLive?: boolean;
    fetchReason?: string | null;
    sourceScreen?: string | null;
    action?: string | null;
    kind: "value" | "listings";
  }) {
    const fetchReason = String(input.fetchReason ?? "");
    const sourceScreen = String(input.sourceScreen ?? "");
    const action = String(input.action ?? "");
    const userRequestedReason =
      input.kind === "value" ? "user_requested_value_refresh" : "user_requested_listings_refresh";
    const refreshAction = input.kind === "value" ? "valueRefresh" : "listingsRefresh";
    const refreshScreen = input.kind === "value" ? "valueScreen" : "listingsScreen";
    return (
      input.forceLive === true ||
      action === refreshAction ||
      fetchReason === userRequestedReason ||
      (input.allowLive === true && sourceScreen === refreshScreen)
    );
  }

  private async resolveUnlockKeyForRequest(input: {
    vehicleId?: string | null;
    descriptor: VehicleLookupDescriptor | null;
  }) {
    const descriptorVehicleKey = input.descriptor
      ? buildVehicleKey({
          year: input.descriptor.year,
          make: input.descriptor.make,
          model: input.descriptor.model,
          trim: input.descriptor.trim,
          vehicleType: input.descriptor.vehicleType,
        })
      : null;
    const storedVehicle = !descriptorVehicleKey && input.vehicleId ? await resolveStoredVehicleRecordById(input.vehicleId) : null;
    const storedVehicleKey = storedVehicle
      ? buildVehicleKey({
          year: storedVehicle.year,
          make: storedVehicle.make,
          model: storedVehicle.model,
          trim: storedVehicle.trim,
          vehicleType: storedVehicle.vehicleType,
        })
      : null;
    const unlock = buildUnlockKey({ vehicleKey: descriptorVehicleKey ?? storedVehicleKey });
    return unlock.key;
  }

  private async assertLiveMarketAccess(input: {
    req: Request;
    vehicleId?: string | null;
    descriptor: VehicleLookupDescriptor | null;
  }) {
    const auth = input.req.auth;
    if (!auth || auth.isGuest) {
      throw new AppError(
        401,
        "AUTH_REQUIRED",
        "Sign in and unlock this vehicle before loading live market value and nearby listings.",
      );
    }

    const plan = await this.subscriptionService.getActivePlan(auth.userId);
    if (isProPlan(plan)) {
      return;
    }

    const unlockKey = await this.resolveUnlockKeyForRequest({
      vehicleId: input.vehicleId,
      descriptor: input.descriptor,
    });
    if (!unlockKey) {
      throw new AppError(400, "UNLOCK_KEY_MISSING", "Unable to verify vehicle unlock for this market request.");
    }

    const existingUnlock = await repositories.vehicleUnlocks.findByUserAndKey(auth.userId, unlockKey);
    if (!existingUnlock) {
      throw new AppError(
        403,
        "PREMIUM_ACCESS_REQUIRED",
        "Unlock Value & Listings for this vehicle before loading live market data.",
      );
    }
  }

  getMarketCheckDebugSummary = async (_req: Request, res: Response) => {
    const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const entries = await repositories.providerApiUsageLogs.listSince({
      sinceIso,
      provider: "marketcheck",
      limit: 250,
    });

    const byEndpoint: Record<string, number> = {};
    const bySourceScreen: Record<string, number> = {};
    const byRoute: Record<string, number> = {};
    const byCacheKey: Record<string, number> = {};
    const byEvent: Record<string, number> = {};

    for (const entry of entries) {
      const endpoint = entry.endpointType ?? "unknown";
      const eventType = entry.eventType ?? "unknown";
      const requestSummary = entry.requestSummary ?? {};
      const sourceScreen = typeof requestSummary.sourceScreen === "string" && requestSummary.sourceScreen.trim().length > 0
        ? requestSummary.sourceScreen.trim()
        : "unknown";
      const route = typeof requestSummary.route === "string" && requestSummary.route.trim().length > 0
        ? requestSummary.route.trim()
        : typeof requestSummary.caller === "string" && requestSummary.caller.trim().length > 0
          ? requestSummary.caller.trim()
          : "unknown";
      const cacheKey = typeof entry.cacheKey === "string" && entry.cacheKey.trim().length > 0 ? entry.cacheKey.trim() : "unknown";

      byEndpoint[endpoint] = (byEndpoint[endpoint] ?? 0) + 1;
      bySourceScreen[sourceScreen] = (bySourceScreen[sourceScreen] ?? 0) + 1;
      byRoute[route] = (byRoute[route] ?? 0) + 1;
      byCacheKey[cacheKey] = (byCacheKey[cacheKey] ?? 0) + 1;
      byEvent[eventType] = (byEvent[eventType] ?? 0) + 1;
    }

    return sendSuccess(
      res,
      {
        sinceIso,
        env: {
          backendBuildCommit: env.BACKEND_BUILD_COMMIT,
          marketCheckDisableExternalCalls: env.MARKETCHECK_DISABLE_EXTERNAL_CALLS,
          marketCheckEnableScanEnrichment: env.MARKETCHECK_ENABLE_SCAN_ENRICHMENT,
          marketCheckEnableAutoSpecs: env.MARKETCHECK_ENABLE_AUTO_SPECS,
          marketCheckEnableAutoListings: env.MARKETCHECK_ENABLE_AUTO_LISTINGS,
          marketCheckEnableBackgroundRefresh: env.MARKETCHECK_ENABLE_BACKGROUND_REFRESH,
          enableBackgroundMarketCheck: env.ENABLE_BACKGROUND_MARKETCHECK,
          enableLiveProviderCalls: env.ENABLE_LIVE_PROVIDER_CALLS,
        },
        startupDiagnostics: getStartupDiagnostics(),
        counts: {
          total: entries.length,
          byEndpoint,
          bySourceScreen,
          byRoute,
          byCacheKey,
          byEvent,
        },
        recentEntries: entries.slice(0, 50),
      },
      { count: entries.length },
    );
  };

  getSearchYears = async (_req: Request, res: Response) => {
    const result = await this.vehicleService.getSearchYears();
    return sendSuccess(res, result, { count: result.length });
  };

  getSearchMakes = async (req: Request, res: Response) => {
    const result = await this.vehicleService.getSearchMakes(Number(req.query.year));
    return sendSuccess(res, result, { count: result.length });
  };

  getSearchModels = async (req: Request, res: Response) => {
    const normalized = normalizeVehicleBadgeAlias({
      make: String(req.query.make ?? ""),
      model: "",
    });
    const result = await this.vehicleService.getSearchModels({
      year: Number(req.query.year),
      make: normalized.make,
    });
    return sendSuccess(res, result, { count: result.length });
  };

  getSearchTrims = async (req: Request, res: Response) => {
    const normalized = normalizeVehicleBadgeAlias({
      make: String(req.query.make ?? ""),
      model: String(req.query.model ?? ""),
      trim: null,
    });
    const result = await this.vehicleService.getSearchTrims({
      year: Number(req.query.year),
      make: normalized.make,
      model: normalized.model,
    });
    return sendSuccess(res, result, { count: result.length });
  };

  search = async (req: Request, res: Response) => {
    const result = await this.vehicleService.searchVehicles({
      year: req.query.year as string | undefined,
      make: req.query.make as string | undefined,
      model: req.query.model as string | undefined,
    });
    return sendSuccess(res, result, { count: result.length });
  };

  getSpecs = async (req: Request, res: Response) => {
    logger.info(
      {
        label: "SPECS_API_REQUEST_RECEIVED",
        requestId: res.locals.requestId,
        vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
        parsedDescriptor: readLookupDescriptor(req.query),
      },
      "SPECS_API_REQUEST_RECEIVED",
    );
    const result = await this.vehicleService.getSpecs({
      vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
      descriptor: readLookupDescriptor(req.query),
      requestId: res.locals.requestId,
      allowLive: readOptionalBoolean(req.query.allowLive),
      fetchReason: typeof req.query.fetchReason === "string" ? req.query.fetchReason : undefined,
      sourceScreen: typeof req.query.sourceScreen === "string" ? req.query.sourceScreen : undefined,
    });
    return sendSuccess(res, result.data, { source: result.source, fetchedAt: result.fetchedAt, expiresAt: result.expiresAt });
  };

  getValue = async (req: Request, res: Response) => {
    try {
      const descriptor = readLookupDescriptor(req.query);
      const normalizedCondition =
        typeof req.query.condition === "string"
          ? req.query.condition.trim().toLowerCase().replace(/[\s-]+/g, "_")
          : req.query.condition;
      logger.info(
        {
          label: "VALUE_API_REQUEST_RECEIVED",
          requestId: res.locals.requestId,
          rawQuery: req.query,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          zip: req.query.zip ?? null,
          mileage: req.query.mileage ?? null,
          condition: req.query.condition ?? null,
          oldDisplayedValue: null,
        },
        "VALUE_API_REQUEST_RECEIVED",
      );
      logger.info(
        {
          label: "VALUE_API_INPUTS",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          parsedDescriptor: descriptor,
          parsedCondition: normalizedCondition ?? null,
          zip: req.query.zip ?? null,
          mileage: req.query.mileage ?? null,
        },
        "VALUE_API_INPUTS",
      );
      const allowLive = readOptionalBoolean(req.query.allowLive);
      const forceLive = readOptionalBoolean(req.query.forceLive);
      const fetchReason = typeof req.query.fetchReason === "string" ? req.query.fetchReason : undefined;
      const sourceScreen = typeof req.query.sourceScreen === "string" ? req.query.sourceScreen : undefined;
      const action = typeof req.query.action === "string" ? req.query.action : undefined;
      const zipSource = typeof req.query.zipSource === "string" ? req.query.zipSource : undefined;
      logger.info(
        {
          label: "VALUE_REFRESH_ACTION_METADATA",
          requestId: res.locals.requestId,
          rawQuery: req.query,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          allowLive: allowLive ?? null,
          fetchReason: fetchReason ?? null,
          sourceScreen: sourceScreen ?? null,
          action: action ?? null,
          forceLive: forceLive ?? null,
          zipSource: zipSource ?? null,
          parsedDescriptor: descriptor,
        },
        "VALUE_REFRESH_ACTION_METADATA",
      );
      if (allowLive || forceLive || fetchReason === "user_requested_value_refresh" || sourceScreen === "valueScreen") {
        logger.info(
          {
            label: "VALUE_LIVE_REFRESH_REQUESTED",
            requestId: res.locals.requestId,
            rawQuery: req.query,
            vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
            allowLive: allowLive ?? null,
            fetchReason: fetchReason ?? null,
            sourceScreen: sourceScreen ?? null,
            action: action ?? null,
            forceLive: forceLive ?? null,
            zipSource: zipSource ?? null,
          },
          "VALUE_LIVE_REFRESH_REQUESTED",
        );
      }
      if (
        this.isLiveMarketRequest({
          kind: "value",
          allowLive,
          forceLive,
          fetchReason,
          sourceScreen,
          action,
        })
      ) {
        await this.assertLiveMarketAccess({
          req,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          descriptor,
        });
      }
      logger.info(
        {
          label: "VALUE_RECALC_REQUEST_RECEIVED",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          zip: req.query.zip ?? null,
          mileage: req.query.mileage ?? null,
          condition: req.query.condition ?? null,
          oldDisplayedValue: null,
        },
        "VALUE_RECALC_REQUEST_RECEIVED",
      );
      const result = await this.vehicleService.getValue({
        requestId: res.locals.requestId,
        vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
        descriptor,
        zip: req.query.zip as string,
        zipSource,
        mileage: Number(req.query.mileage),
        condition: normalizedCondition as string,
        allowLive,
        fetchReason,
        sourceScreen,
        action,
        forceLive,
      });
      return sendSuccess(res, result.data, { source: result.source, fetchedAt: result.fetchedAt, expiresAt: result.expiresAt });
    } catch (error) {
      logger.error(
        {
          label: "VALUE_LOOKUP_FAILURE",
          requestId: res.locals.requestId,
          vehicleId: req.query.vehicleId as string,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          bodyStyle: req.query.bodyStyle ?? null,
          message: error instanceof Error ? error.message : "Unknown valuation controller error",
          stack: error instanceof Error ? error.stack : undefined,
          code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
          details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
          hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
        },
        "VALUE_LOOKUP_FAILURE",
      );
      throw error;
    }
  };

  getListings = async (req: Request, res: Response) => {
    try {
      const descriptor = readLookupDescriptor(req.query);
      const forceLive = readOptionalBoolean(req.query.forceLive);
      const allowLive = readOptionalBoolean(req.query.allowLive);
      const fetchReason = typeof req.query.fetchReason === "string" ? req.query.fetchReason : undefined;
      const sourceScreen = typeof req.query.sourceScreen === "string" ? req.query.sourceScreen : undefined;
      const action = typeof req.query.action === "string" ? req.query.action : undefined;
      logger.info(
        {
          label: "FORSALE_PIPELINE_START",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          yearRangeStart: req.query.yearRangeStart ?? null,
          yearRangeEnd: req.query.yearRangeEnd ?? null,
          zip: req.query.zip ?? null,
          radiusMiles: req.query.radiusMiles ?? null,
          mileage: req.query.mileage ?? null,
        },
        "FORSALE_PIPELINE_START",
      );
      logger.info(
        {
          label: "LISTINGS_PIPELINE_START",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          yearRangeStart: req.query.yearRangeStart ?? null,
          yearRangeEnd: req.query.yearRangeEnd ?? null,
          zip: req.query.zip ?? null,
          radiusMiles: req.query.radiusMiles ?? null,
          mileage: req.query.mileage ?? null,
        },
        "LISTINGS_PIPELINE_START",
      );
      logger.info(
        {
          label: "LISTINGS_API_INPUTS",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          parsedDescriptor: descriptor,
          zip: req.query.zip ?? null,
          radiusMiles: req.query.radiusMiles ?? null,
          mileage: req.query.mileage ?? null,
          yearRange: descriptor?.yearRange ?? null,
        },
        "LISTINGS_API_INPUTS",
      );
      if (
        this.isLiveMarketRequest({
          kind: "listings",
          allowLive,
          forceLive: forceLive ?? undefined,
          fetchReason,
          sourceScreen,
          action,
        })
      ) {
        await this.assertLiveMarketAccess({
          req,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          descriptor,
        });
      }
      const result = await this.vehicleService.getListings({
        requestId: res.locals.requestId,
        vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
        descriptor,
        zip: req.query.zip as string,
        radiusMiles: Number(req.query.radiusMiles),
        mileage: typeof req.query.mileage === "number" ? req.query.mileage : req.query.mileage != null ? Number(req.query.mileage) : undefined,
        allowLive,
        fetchReason,
        sourceScreen,
        action,
        forceLive: forceLive ?? null,
      });
      return sendSuccess(res, result.data, {
        count: result.data.length,
        source: result.source,
        fetchedAt: result.fetchedAt,
        expiresAt: result.expiresAt,
        ...(result.meta ?? {}),
      });
    } catch (error) {
      logger.error(
        {
          label: "LISTINGS_LOOKUP_FAILURE",
          requestId: res.locals.requestId,
          vehicleId: req.query.vehicleId as string,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          bodyStyle: req.query.bodyStyle ?? null,
          message: error instanceof Error ? error.message : "Unknown listings controller error",
          stack: error instanceof Error ? error.stack : undefined,
          code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
          details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
          hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
        },
        "LISTINGS_LOOKUP_FAILURE",
      );
      throw error;
    }
  };
}
