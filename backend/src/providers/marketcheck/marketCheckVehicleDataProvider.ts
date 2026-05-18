import { env } from "../../config/env.js";
import { AppError } from "../../errors/appError.js";
import { createProviderApiUsageLog, normalizeCondition } from "../../lib/providerCache.js";
import { logger } from "../../lib/logger.js";
import { repositories } from "../../lib/repositoryRegistry.js";
import { isSpecialtyExoticMake, isSpecialtyModelFamilyMatch } from "../../lib/specialtyVehicles.js";
import { resolveHorsepower } from "../../lib/vehicleData.js";
import { ListingRecord, ValuationRecord, VehicleRecord } from "../../types/domain.js";
import { MarketCheckRequestMeta, VehicleListingsProvider, VehicleSpecsProvider, VehicleValueProvider } from "../interfaces.js";
import { buildLiveVehicleId, parseLiveVehicleId } from "./vehicleId.js";

type InventorySearchResponse = {
  listings?: MarketCheckListing[];
  stats?: Record<string, unknown>;
};

type MarketCheckListing = {
  id?: string;
  vin?: string;
  vdp_url?: string;
  url?: string;
  dealer_url?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  heading?: string;
  price?: number;
  msrp?: number;
  miles?: number;
  dealer_name?: string;
  seller?: { name?: string; city?: string; state?: string };
  dist?: number;
  city?: string;
  state?: string;
  media?: { photo_links?: string[] };
  img_url?: string;
  dealer?: { name?: string; city?: string; state?: string };
  build?: {
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    body_type?: string;
    vehicle_type?: string;
    transmission?: string;
    drivetrain?: string;
    engine?: string;
    horsepower?: number | string;
    engine_hp?: number | string;
    fuel_type?: string;
    made_in?: string;
    city_mpg?: number;
    highway_mpg?: number;
  };
  body_type?: string;
  vehicle_type?: string;
  drivetrain?: string;
  transmission?: string;
  engine?: string;
  horsepower?: number | string;
  engine_hp?: number | string;
  cylinders?: number;
  city_mpg?: number;
  highway_mpg?: number;
  base_ext_color?: string;
  exterior_color?: string;
  dom_active?: number;
  first_seen_at_date?: string;
  last_seen_at_date?: string;
};

type SearchDescriptor = {
  year: number;
  make: string;
  model: string;
  trim?: string;
  vehicle?: VehicleRecord | null;
};

const DEFAULT_TIMEOUT_MS = 12000;
const MONTHLY_SUMMARY_CACHE_MS = 60 * 1000;
const MARKETCHECK_BLOCKED_SOURCE_SCREENS = new Set([
  "scan",
  "scanResult",
  "unknown",
  "backgroundHydration",
  "trendingScheduler",
  "preload",
  "bootstrap",
]);

type InventoryOperation = "specs" | "search" | "values" | "listings";
type MarketCheckSummary = {
  monthKey: string;
  total: number;
  byEndpoint: {
    specs: number;
    value: number;
    listings: number;
  };
  cacheHits: number;
  deduped: number;
  skipped: number;
};

type CachedInventoryResponse = {
  payload: InventorySearchResponse;
  statusCode: number;
  expiresAtMs: number;
};

function buildTrimmedStackTrace() {
  const raw = new Error().stack;
  if (!raw) {
    return null;
  }

  return raw
    .split("\n")
    .slice(2, 8)
    .map((line) => line.trim())
    .join("\n");
}

function summarizeInventoryResponse(operation: string, response: InventorySearchResponse) {
  return {
    operation,
    listingsCount: Array.isArray(response.listings) ? response.listings.length : 0,
    hasStats: Boolean(response.stats),
  };
}

function normalizeSourceScreen(value: string | null | undefined) {
  if (typeof value !== "string") {
    return "unknown";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

function shouldBlockExternalMarketCheckForSource(requestMeta?: MarketCheckRequestMeta) {
  const sourceScreen = normalizeSourceScreen(requestMeta?.sourceScreen);
  const reason = requestMeta?.reason ?? null;
  const stackTag = requestMeta?.stackTag ?? null;
  const caller = requestMeta?.caller ?? null;
  const route = requestMeta?.route ?? null;
  const action = requestMeta?.action ?? null;
  const contextTags = [reason, stackTag, caller, route, action]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
  const hasBlockedContextTag = contextTags.some((value) =>
    value.includes("scan") ||
    value.includes("backgroundhydration") ||
    value.includes("preload") ||
    value.includes("bootstrap") ||
    value.includes("trending"),
  );
  const isScanTagged =
    sourceScreen === "scan" ||
    reason === "scan_identify_provider_enrichment" ||
    stackTag === "scan-identify" ||
    (typeof caller === "string" && caller.toLowerCase().includes("scanservice"));

  if (MARKETCHECK_BLOCKED_SOURCE_SCREENS.has(sourceScreen) || isScanTagged || hasBlockedContextTag) {
    return {
      blocked: true,
      sourceScreen,
      guardReason: isScanTagged
        ? "scan-budget-zero"
        : hasBlockedContextTag
          ? "blocked-context-tag"
          : `blocked-source-${sourceScreen}`,
    };
  }

  return {
    blocked: false,
    sourceScreen,
    guardReason: null,
  };
}

function isExplicitMarketCheckActionAllowed(operation: InventoryOperation, requestMeta?: MarketCheckRequestMeta) {
  const sourceScreen = normalizeSourceScreen(requestMeta?.sourceScreen);
  const action = requestMeta?.action ?? null;
  const forceLive = requestMeta?.forceLive === true;
  const allowLive = requestMeta?.allowLive === true;
  const reason = requestMeta?.reason ?? null;

  if (operation === "values") {
    return forceLive || action === "valueRefresh" || reason === "user_requested_value_refresh" || (sourceScreen === "valueScreen" && allowLive);
  }

  if (operation === "listings") {
    return forceLive || action === "listingsRefresh" || reason === "user_requested_listings_refresh" || (sourceScreen === "listingsScreen" && allowLive);
  }

  return false;
}

function normalizeMarketCheckKeyPart(value: string | number | undefined | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildMarketCheckRequestKey(operation: InventoryOperation, params: Record<string, string | number | undefined>) {
  return [
    "marketcheck",
    operation,
    ...Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== "")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${normalizeMarketCheckKeyPart(key)}=${normalizeMarketCheckKeyPart(value)}`),
  ].join(":");
}

function getInventoryTtlMs(operation: InventoryOperation) {
  if (operation === "values") {
    return 24 * 60 * 60 * 1000;
  }
  if (operation === "listings") {
    return 6 * 60 * 60 * 1000;
  }
  return 7 * 24 * 60 * 60 * 1000;
}

function buildMonthKey(date = new Date()) {
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function buildMonthStartIso(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

function mapOperationToSummaryEndpoint(operation: InventoryOperation): "specs" | "value" | "listings" {
  if (operation === "values") {
    return "value";
  }
  if (operation === "listings") {
    return "listings";
  }
  return "specs";
}

function titleCase(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalized === "4runner") return "4Runner";
  if (normalized === "ct4") return "CT4";
  if (normalized === "ct5") return "CT5";
  if (normalized === "f 150" || normalized === "f150") return "F-150";
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeListingMatchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isHighlanderLikeModel(value: string) {
  return value.includes("highlander") && !value.includes("grandhighlander");
}

function isCrvLikeModel(value: string) {
  return value === "crv" || value === "cr-v" || value === "cr v";
}

function listingModelMatchesRequestedModel(requestedMake: string, requestedModel: string, listingModel: string) {
  if (!requestedModel || !listingModel) {
    return false;
  }

  if (requestedModel === listingModel) {
    return true;
  }

  if (isHighlanderLikeModel(requestedModel)) {
    return isHighlanderLikeModel(listingModel);
  }

  if (isCrvLikeModel(requestedModel)) {
    return isCrvLikeModel(listingModel);
  }

  if (isSpecialtyModelFamilyMatch(requestedMake, requestedModel, listingModel)) {
    return true;
  }

  return false;
}

function compact<T>(values: Array<T | null | undefined | false>): T[] {
  return values.filter(Boolean) as T[];
}

function getImageUrl(listing: MarketCheckListing) {
  return listing.media?.photo_links?.[0] ?? listing.img_url ?? "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80";
}

function getLocation(listing: MarketCheckListing) {
  const city = listing.city ?? listing.seller?.city;
  const state = listing.state ?? listing.seller?.state;
  return compact([city, state]).join(", ") || "Local market";
}

function getListingUrl(listing: MarketCheckListing) {
  const url = listing.vdp_url ?? listing.url ?? listing.dealer_url ?? null;
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  if (/example\.com/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function getPriceStats(stats: Record<string, unknown> | undefined) {
  const price = stats?.price as Record<string, unknown> | undefined;
  if (!price || typeof price !== "object") {
    return null;
  }

  const mean = Number(price.mean ?? price.average ?? price.avg ?? 0) || null;
  const median = Number(price.median ?? 0) || null;
  const min = Number(price.min ?? 0) || null;
  const max = Number(price.max ?? 0) || null;

  return { mean, median, min, max };
}

function getConditionMultiplier(condition: string) {
  switch (normalizeCondition(condition)) {
    case "excellent":
      return 1.04;
    case "very_good":
      return 1.02;
    case "good":
      return 1;
    case "fair":
      return 0.95;
    case "poor":
      return 0.9;
    default:
      return 1;
  }
}

function normalizeInventoryListings(input: {
  descriptor: SearchDescriptor;
  vehicleId: string;
  rawListings: MarketCheckListing[];
  radiusMiles: number;
  yearRangeStart?: number | null;
  yearRangeEnd?: number | null;
  traceLabel: "LISTINGS_PROVIDER_FILTER_TRACE" | "VALUE_PROVIDER_FILTER_TRACE";
  zip: string;
}) {
  const requestedMake = normalizeListingMatchText(input.descriptor.make);
  const requestedModel = normalizeListingMatchText(input.descriptor.model);
  const effectiveYearMin =
    input.yearRangeStart != null && input.yearRangeEnd != null
      ? Math.min(input.yearRangeStart, input.yearRangeEnd) - 1
      : input.descriptor.year - 2;
  const effectiveYearMax =
    input.yearRangeStart != null && input.yearRangeEnd != null
      ? Math.max(input.yearRangeStart, input.yearRangeEnd) + 1
      : input.descriptor.year + 2;

  const baseListings = input.rawListings.flatMap((listing) => {
    const year = listing.year ?? listing.build?.year;
    const make = listing.make ?? listing.build?.make;
    const model = listing.model ?? listing.build?.model;
    if (!year || !make || !model || !listing.price) {
      return [];
    }
    return [{
      raw: listing,
      year,
      make,
      model,
      listingUrl: getListingUrl(listing),
    }];
  });

  const sampleRejectedInvalidUrl =
    baseListings.find((entry) => !entry.listingUrl)
      ? {
          title: baseListings.find((entry) => !entry.listingUrl)?.raw.heading ?? null,
          make: baseListings.find((entry) => !entry.listingUrl)?.make ?? null,
          model: baseListings.find((entry) => !entry.listingUrl)?.model ?? null,
          year: baseListings.find((entry) => !entry.listingUrl)?.year ?? null,
          url: baseListings.find((entry) => !entry.listingUrl)?.listingUrl ?? null,
        }
      : null;

  const urlFiltered = baseListings.filter((entry) => Boolean(entry.listingUrl));
  const sampleRejectedModel =
    urlFiltered.find((entry) => {
      const listingMake = normalizeListingMatchText(entry.make);
      const listingModel = normalizeListingMatchText(entry.model);
      return requestedMake !== listingMake || !listingModelMatchesRequestedModel(input.descriptor.make, requestedModel, listingModel);
    }) ?? null;

  const makeModelFiltered = urlFiltered.filter((entry) => {
    const listingMake = normalizeListingMatchText(entry.make);
    const listingModel = normalizeListingMatchText(entry.model);
    return requestedMake === listingMake && listingModelMatchesRequestedModel(input.descriptor.make, requestedModel, listingModel);
  });

  const sampleRejectedYear =
    makeModelFiltered.find((entry) => entry.year < effectiveYearMin || entry.year > effectiveYearMax) ?? null;
  const yearFiltered = makeModelFiltered.filter((entry) => entry.year >= effectiveYearMin && entry.year <= effectiveYearMax);

  logger.info(
    {
      label: input.traceLabel,
      vehicleId: input.vehicleId,
      zip: input.zip,
      radiusMiles: input.radiusMiles,
      requestedYear: input.descriptor.year,
      requestedYearRange:
        input.yearRangeStart != null && input.yearRangeEnd != null
          ? { start: Math.min(input.yearRangeStart, input.yearRangeEnd), end: Math.max(input.yearRangeStart, input.yearRangeEnd) }
          : null,
      requestedMake: input.descriptor.make,
      requestedModel: input.descriptor.model,
      requestedTrim: input.descriptor.trim ?? null,
      specialtyVehicle: isSpecialtyExoticMake(input.descriptor.make),
      rawCount: input.rawListings.length,
      afterUrlCount: urlFiltered.length,
      afterMakeModelCount: makeModelFiltered.length,
      afterYearCount: yearFiltered.length,
      sampleRejectedInvalidUrl,
      sampleRejectedMakeModel: sampleRejectedModel
        ? {
            title: sampleRejectedModel.raw.heading ?? null,
            make: sampleRejectedModel.make,
            model: sampleRejectedModel.model,
            year: sampleRejectedModel.year,
            url: sampleRejectedModel.listingUrl,
          }
        : null,
      sampleRejectedYear: sampleRejectedYear
        ? {
            title: sampleRejectedYear.raw.heading ?? null,
            make: sampleRejectedYear.make,
            model: sampleRejectedYear.model,
            year: sampleRejectedYear.year,
            url: sampleRejectedYear.listingUrl,
          }
        : null,
    },
    input.traceLabel,
  );

  const listings = yearFiltered.map((entry) => {
    const trim = entry.raw.trim?.trim() || entry.raw.build?.trim?.trim() || input.descriptor.trim || "Base";
    return {
      id: `live-listing-${entry.raw.id ?? entry.raw.vin ?? buildLiveVehicleId({ year: entry.year, make: entry.make, model: entry.model, trim })}`,
      vehicleId: input.vehicleId,
      year: entry.year,
      make: titleCase(entry.make),
      model: titleCase(entry.model),
      trim,
      title: entry.raw.heading ?? `${entry.year} ${titleCase(entry.make)} ${titleCase(entry.model)} ${trim}`.trim(),
      price: entry.raw.price!,
      mileage: entry.raw.miles ?? 0,
      dealer: entry.raw.dealer_name ?? entry.raw.dealer?.name ?? entry.raw.seller?.name ?? "Market listing",
      distanceMiles: Math.round(entry.raw.dist ?? input.radiusMiles),
      location: getLocation(entry.raw),
      imageUrl: getImageUrl(entry.raw),
      listingUrl: entry.listingUrl,
      listedAt: entry.raw.first_seen_at_date ?? entry.raw.last_seen_at_date ?? new Date().toISOString(),
    } satisfies ListingRecord;
  });

  return {
    listings,
    rawCount: input.rawListings.length,
    normalizedCount: listings.length,
  };
}

function getDescriptor(vehicleId: string, vehicle?: VehicleRecord | null): SearchDescriptor | null {
  if (vehicle) {
    return {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      vehicle,
    };
  }

  const parsed = parseLiveVehicleId(vehicleId);
  if (!parsed) {
    return null;
  }

  return {
    year: parsed.year,
    make: parsed.make,
    model: parsed.model,
    trim: parsed.trim,
    vehicle: null,
  };
}

function mapListingToVehicle(listing: MarketCheckListing): VehicleRecord | null {
  const year = listing.year ?? listing.build?.year;
  const make = listing.make ?? listing.build?.make;
  const model = listing.model ?? listing.build?.model;

  if (!year || !make || !model) {
    return null;
  }

  const trim = listing.trim?.trim() || listing.build?.trim?.trim() || "Base";
  const colors = compact([listing.base_ext_color, listing.exterior_color]).map(titleCase);
  const cityMpg = listing.city_mpg ?? listing.build?.city_mpg;
  const highwayMpg = listing.highway_mpg ?? listing.build?.highway_mpg;
  const mpg = cityMpg && highwayMpg ? `${cityMpg} city / ${highwayMpg} hwy` : "Unknown";
  const engine = listing.engine ?? listing.build?.engine ?? "Unknown";
  const drivetrain = listing.drivetrain ?? listing.build?.drivetrain ?? "Unknown";
  const transmission = listing.transmission ?? listing.build?.transmission ?? "Unknown";
  const parsedHorsepower = resolveHorsepower(
    listing.horsepower,
    listing.engine_hp,
    listing.build?.horsepower,
    listing.build?.engine_hp,
  );
  logger.info(
    {
      label: "HORSEPOWER_PROVIDER_MAPPING",
      provider: "marketcheck",
      rawHorsepowerFields: {
        horsepower: listing.horsepower ?? null,
        engine_hp: listing.engine_hp ?? null,
        build_horsepower: listing.build?.horsepower ?? null,
        build_engine_hp: listing.build?.engine_hp ?? null,
      },
      parsedHorsepower,
      year,
      make,
      model,
      trim,
    },
    "HORSEPOWER_PROVIDER_MAPPING",
  );

  return {
    id: buildLiveVehicleId({
      year,
      make,
      model,
      trim,
    }),
    vin: listing.vin ?? null,
    year,
    make: titleCase(make),
    model: titleCase(model),
    trim: trim,
    bodyStyle: listing.body_type ?? listing.build?.body_type ?? "Vehicle",
    vehicleType: String(listing.vehicle_type ?? listing.build?.vehicle_type ?? "car").toLowerCase() === "motorcycle" ? "motorcycle" : "car",
    msrp: listing.msrp ?? listing.price ?? 0,
    engine,
    horsepower: parsedHorsepower,
    torque: "Unknown",
    transmission,
    drivetrain,
    mpgOrRange: mpg,
    colors,
  };
}

export class MarketCheckVehicleDataProvider implements VehicleSpecsProvider, VehicleValueProvider, VehicleListingsProvider {
  private readonly apiKey = env.MARKETCHECK_API_KEY;
  private readonly baseUrl = env.MARKETCHECK_BASE_URL.replace(/\/$/, "");
  private marketCheckCallCount = 0;
  private readonly responseCache = new Map<string, CachedInventoryResponse>();
  private readonly inflightRequests = new Map<string, Promise<InventorySearchResponse>>();
  private summaryCache:
    | {
        expiresAtMs: number;
        summary: MarketCheckSummary;
      }
    | null = null;

  private async writeUsageEvent(input: {
    endpointType: "specs" | "values" | "listings";
    eventType: "provider_request" | "cache_hit" | "inflight_dedupe" | "skipped_rate_guard" | "provider_error";
    cacheKey: string;
    requestMeta?: MarketCheckRequestMeta;
    requestSummary: Record<string, unknown>;
    responseSummary: Record<string, unknown>;
  }) {
    await repositories.providerApiUsageLogs
      .create(
        createProviderApiUsageLog({
          provider: "marketcheck",
          endpointType: input.endpointType,
          eventType: input.eventType,
          cacheKey: input.cacheKey,
          requestSummary: {
            requestId: input.requestMeta?.requestId ?? null,
            userId: input.requestMeta?.userId ?? null,
            sourceScreen: input.requestMeta?.sourceScreen ?? null,
            ...input.requestSummary,
          },
          responseSummary: input.responseSummary,
        }),
      )
      .catch((error) => {
        logger.warn(
          {
            label: "MARKETCHECK_USAGE_EVENT_WRITE_FAILED",
            endpointType: input.endpointType,
            eventType: input.eventType,
            cacheKey: input.cacheKey,
            message: error instanceof Error ? error.message : "Unknown provider usage event failure",
          },
          "MARKETCHECK_USAGE_EVENT_WRITE_FAILED",
        );
      });
  }

  private async getMonthlySummary() {
    const now = Date.now();
    if (this.summaryCache && this.summaryCache.expiresAtMs > now) {
      return this.summaryCache.summary;
    }

    const summaryResponse = await repositories.providerApiUsageLogs
      .summarizeSince({
        sinceIso: buildMonthStartIso(),
        provider: "marketcheck",
      })
      .catch(() => ({
        total: 0,
        byEndpoint: {
          specs: 0,
          values: 0,
          listings: 0,
        },
        byEvent: {} as Record<string, number>,
      }));

    const summary: MarketCheckSummary = {
      monthKey: buildMonthKey(),
      total: summaryResponse.total,
      byEndpoint: {
        specs: summaryResponse.byEndpoint.specs ?? 0,
        value: summaryResponse.byEndpoint.values ?? 0,
        listings: summaryResponse.byEndpoint.listings ?? 0,
      },
      cacheHits: summaryResponse.byEvent.cache_hit ?? 0,
      deduped: summaryResponse.byEvent.inflight_dedupe ?? 0,
      skipped: summaryResponse.byEvent.skipped_rate_guard ?? 0,
    };

    this.summaryCache = {
      expiresAtMs: now + MONTHLY_SUMMARY_CACHE_MS,
      summary,
    };
    return summary;
  }

  private invalidateMonthlySummaryCache() {
    this.summaryCache = null;
  }

  private async logMarketCheckSummary(trigger: string) {
    const summary = await this.getMonthlySummary();
    logger.info(
      {
        label: "MARKETCHECK_USAGE_SUMMARY",
        trigger,
        monthKey: summary.monthKey,
        total: summary.total,
        byEndpoint: summary.byEndpoint,
        cacheHits: summary.cacheHits,
        deduped: summary.deduped,
        skipped: summary.skipped,
      },
      "MARKETCHECK_USAGE_SUMMARY",
    );
  }

  private buildRequestContext(input: {
    operation: InventoryOperation;
    endpoint: string;
    params: Record<string, string | number | undefined>;
    requestMeta?: MarketCheckRequestMeta;
    cacheKey: string;
    requestId: string;
    retryAttempt?: number;
  }) {
    return {
      requestId: input.requestId,
      userId: input.requestMeta?.userId ?? null,
      endpointType: input.operation === "values" ? "value" : input.operation === "listings" ? "listings" : "specs",
      vin: input.requestMeta?.vin ?? null,
      vehicleId: input.requestMeta?.vehicleId ?? null,
      year: input.requestMeta?.year ?? null,
      make: input.requestMeta?.make ?? null,
      model: input.requestMeta?.model ?? null,
      trim: input.requestMeta?.trim ?? null,
      action: input.requestMeta?.action ?? null,
      route: input.requestMeta?.route ?? input.requestMeta?.caller ?? null,
      reason: input.requestMeta?.reason ?? null,
      stackTag: input.requestMeta?.stackTag ?? null,
      scanId: input.requestMeta?.scanId ?? null,
      sourceScreen: normalizeSourceScreen(input.requestMeta?.sourceScreen),
      forceLive: input.requestMeta?.forceLive ?? null,
      cacheKey: input.cacheKey,
      retryAttempt: input.retryAttempt ?? input.requestMeta?.retryAttempt ?? 0,
      zip: input.requestMeta?.zip ?? null,
      radiusMiles: input.requestMeta?.radiusMiles ?? null,
      mileage: input.requestMeta?.mileage ?? null,
      condition: input.requestMeta?.condition ?? null,
      endpoint: input.endpoint,
      requestParams: input.params,
    };
  }

  private logDisabledSkip(operation: string, endpoint: string, requestMeta?: MarketCheckRequestMeta) {
    logger.info(
      {
        label: "MARKETCHECK_DISABLED_SKIP",
        endpoint,
        operation,
        reason: requestMeta?.reason ?? null,
        allowLive: requestMeta?.allowLive ?? null,
        scanId: requestMeta?.scanId ?? null,
        vehicleId: requestMeta?.vehicleId ?? null,
        year: requestMeta?.year ?? null,
        make: requestMeta?.make ?? null,
        model: requestMeta?.model ?? null,
        trim: requestMeta?.trim ?? null,
        action: requestMeta?.action ?? null,
        route: requestMeta?.route ?? requestMeta?.caller ?? null,
        caller: requestMeta?.caller ?? null,
        sourceScreen: normalizeSourceScreen(requestMeta?.sourceScreen),
        stackTag: requestMeta?.stackTag ?? null,
        requestMeta: requestMeta ?? null,
        trimmedStackTrace: buildTrimmedStackTrace(),
      },
      "MARKETCHECK_DISABLED_SKIP",
    );
  }

  private async fetchInventorySearch(
    operation: string,
    params: Record<string, string | number | undefined>,
    requestMeta?: MarketCheckRequestMeta,
  ) {
    const typedOperation = operation as InventoryOperation;
    const endpoint = "/v2/search/car/active";
    if (!env.MARKETCHECK_ENABLED) {
      this.logDisabledSkip(operation, endpoint, requestMeta);
      throw new AppError(503, "MARKETCHECK_DISABLED", "MarketCheck is disabled.");
    }

    if (!this.apiKey) {
      throw new Error("MARKETCHECK_API_KEY is not configured.");
    }

    const cacheKey = requestMeta?.cacheKey ?? buildMarketCheckRequestKey(typedOperation, params);
    const requestId = requestMeta?.requestId ?? `marketcheck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requestContext = this.buildRequestContext({
      operation: typedOperation,
      endpoint,
      params,
      requestMeta,
      cacheKey,
      requestId,
    });
    const blockedSourceDecision = shouldBlockExternalMarketCheckForSource(requestMeta);
    const cached = this.responseCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      const cachedResultCount = Array.isArray(cached.payload.listings) ? cached.payload.listings.length : 0;
      const shouldBypassZeroCache = cachedResultCount === 0 && isExplicitMarketCheckActionAllowed(typedOperation, requestMeta);
      if (shouldBypassZeroCache) {
        logger.info(
          {
            label: "MARKETCHECK_ZERO_CACHE_BYPASSED",
            ...requestContext,
            cacheHit: true,
            statusCode: cached.statusCode,
            resultCount: cachedResultCount,
            reason: "explicit-refresh-zero-result-cache",
          },
          "MARKETCHECK_ZERO_CACHE_BYPASSED",
        );
      } else {
        logger.info(
          {
            label: "MARKETCHECK_API_CACHE_HIT",
            ...requestContext,
            cacheHit: true,
            statusCode: cached.statusCode,
            resultCount: cachedResultCount,
          },
          "MARKETCHECK_API_CACHE_HIT",
        );
        await this.writeUsageEvent({
          endpointType: mapOperationToSummaryEndpoint(typedOperation) === "value" ? "values" : mapOperationToSummaryEndpoint(typedOperation) === "listings" ? "listings" : "specs",
          eventType: "cache_hit",
          cacheKey,
          requestMeta,
          requestSummary: requestContext,
          responseSummary: {
            statusCode: cached.statusCode,
            resultCount: cachedResultCount,
            cacheHit: true,
          },
        });
        this.invalidateMonthlySummaryCache();
        await this.logMarketCheckSummary("cache-hit");
        return cached.payload;
      }
    }

    const inflight = this.inflightRequests.get(cacheKey);
    if (inflight) {
      logger.info(
        {
          label: "MARKETCHECK_API_INFLIGHT_DEDUPE",
          ...requestContext,
          cacheHit: false,
        },
        "MARKETCHECK_API_INFLIGHT_DEDUPE",
      );
      await this.writeUsageEvent({
        endpointType: mapOperationToSummaryEndpoint(typedOperation) === "value" ? "values" : mapOperationToSummaryEndpoint(typedOperation) === "listings" ? "listings" : "specs",
        eventType: "inflight_dedupe",
        cacheKey,
        requestMeta,
        requestSummary: requestContext,
        responseSummary: {},
      });
      this.invalidateMonthlySummaryCache();
      return inflight;
    }

    const requestPromise = (async () => {
      if (blockedSourceDecision.blocked) {
        logger.warn(
          {
            label: "MARKETCHECK_ACTION_BUDGET_EXCEEDED",
            ...requestContext,
            action: blockedSourceDecision.sourceScreen,
            endpointType: requestContext.endpointType,
            reason: blockedSourceDecision.guardReason,
            allowedCalls: 0,
          },
          "MARKETCHECK_ACTION_BUDGET_EXCEEDED",
        );
        logger.warn(
          {
            label: "MARKETCHECK_API_SKIPPED_RATE_GUARD",
            ...requestContext,
            guardReason: blockedSourceDecision.guardReason,
            currentMonthlyTotal: null,
            monthlyLimit: env.MARKETCHECK_MONTHLY_CALL_LIMIT,
          },
          "MARKETCHECK_API_SKIPPED_RATE_GUARD",
        );
        await this.writeUsageEvent({
          endpointType: mapOperationToSummaryEndpoint(typedOperation) === "value" ? "values" : mapOperationToSummaryEndpoint(typedOperation) === "listings" ? "listings" : "specs",
          eventType: "skipped_rate_guard",
          cacheKey,
          requestMeta: {
            ...requestMeta,
            sourceScreen: blockedSourceDecision.sourceScreen,
          },
          requestSummary: requestContext,
          responseSummary: {
            guardReason: blockedSourceDecision.guardReason,
          },
        });
        this.invalidateMonthlySummaryCache();
        await this.logMarketCheckSummary("guard-skip");
        return { listings: [], stats: {} } as InventorySearchResponse;
      }

      const summary = await this.getMonthlySummary();
      if (isExplicitMarketCheckActionAllowed(typedOperation, requestMeta)) {
        logger.info(
          {
            label: "MARKETCHECK_EXPLICIT_ACTION_ALLOWED",
            ...requestContext,
          },
          "MARKETCHECK_EXPLICIT_ACTION_ALLOWED",
        );
      }
      const limitReached = env.MARKETCHECK_DISABLE_EXTERNAL_CALLS || summary.total >= env.MARKETCHECK_MONTHLY_CALL_LIMIT;
      if (summary.total >= env.MARKETCHECK_WARN_AT) {
        logger.warn(
          {
            label: "MARKETCHECK_USAGE_WARNING",
            requestId,
            total: summary.total,
            warnAt: env.MARKETCHECK_WARN_AT,
            limit: env.MARKETCHECK_MONTHLY_CALL_LIMIT,
          },
          "MARKETCHECK_USAGE_WARNING",
        );
      }
      if (limitReached) {
        logger.warn(
          {
            label: "MARKETCHECK_API_SKIPPED_RATE_GUARD",
            ...requestContext,
            guardReason: env.MARKETCHECK_DISABLE_EXTERNAL_CALLS ? "external-calls-disabled" : "monthly-limit-reached",
            currentMonthlyTotal: summary.total,
            monthlyLimit: env.MARKETCHECK_MONTHLY_CALL_LIMIT,
          },
          "MARKETCHECK_API_SKIPPED_RATE_GUARD",
        );
        await this.writeUsageEvent({
          endpointType: mapOperationToSummaryEndpoint(typedOperation) === "value" ? "values" : mapOperationToSummaryEndpoint(typedOperation) === "listings" ? "listings" : "specs",
          eventType: "skipped_rate_guard",
          cacheKey,
          requestMeta,
          requestSummary: requestContext,
          responseSummary: {
            guardReason: env.MARKETCHECK_DISABLE_EXTERNAL_CALLS ? "external-calls-disabled" : "monthly-limit-reached",
            currentMonthlyTotal: summary.total,
          },
        });
        this.invalidateMonthlySummaryCache();
        await this.logMarketCheckSummary("guard-skip");
        return { listings: [], stats: {} } as InventorySearchResponse;
      }

      const searchParams = new URLSearchParams();
      searchParams.set("api_key", this.apiKey);
      searchParams.set("country", "us");
      searchParams.set("dedup", "true");
      searchParams.set("nodedup", "false");

      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
          searchParams.set(key, String(value));
        }
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const startedAt = Date.now();
      this.marketCheckCallCount += 1;
      logger.info(
        {
          label: "MARKETCHECK_API_REQUEST_START",
          ...requestContext,
          cacheHit: false,
          marketCheckCallCount: this.marketCheckCallCount,
          appEnv: env.APP_ENV,
          nodeEnv: env.NODE_ENV,
          trimmedStackTrace: buildTrimmedStackTrace(),
        },
        "MARKETCHECK_API_REQUEST_START",
      );
      await this.writeUsageEvent({
        endpointType: mapOperationToSummaryEndpoint(typedOperation) === "value" ? "values" : mapOperationToSummaryEndpoint(typedOperation) === "listings" ? "listings" : "specs",
        eventType: "provider_request",
        cacheKey,
        requestMeta,
        requestSummary: requestContext,
        responseSummary: {},
      });
      this.invalidateMonthlySummaryCache();

      try {
        const response = await fetch(`${this.baseUrl}${endpoint}?${searchParams.toString()}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (!response.ok) {
          const bodyText = await response.text().catch(() => "");
          throw new AppError(
            response.status,
            response.status === 429 ? "MARKETCHECK_RATE_LIMITED" : "MARKETCHECK_REQUEST_FAILED",
            `MarketCheck inventory search failed with status ${response.status}.`,
            {
              operation,
              status: response.status,
              body: bodyText.slice(0, 500),
            },
          );
        }

        const payload = (await response.json()) as InventorySearchResponse;
        const durationMs = Date.now() - startedAt;
        this.responseCache.set(cacheKey, {
          payload,
          statusCode: response.status,
          expiresAtMs: Date.now() + getInventoryTtlMs(typedOperation),
        });
        logger.info(
          {
            label: "MARKETCHECK_API_RESPONSE",
            ...requestContext,
            cacheHit: false,
            durationMs,
            statusCode: response.status,
            resultCount: Array.isArray(payload.listings) ? payload.listings.length : 0,
            responseSummary: summarizeInventoryResponse(operation, payload),
          },
          "MARKETCHECK_API_RESPONSE",
        );
        await this.logMarketCheckSummary("provider-response");
        return payload;
      } catch (error) {
        await this.writeUsageEvent({
          endpointType: mapOperationToSummaryEndpoint(typedOperation) === "value" ? "values" : mapOperationToSummaryEndpoint(typedOperation) === "listings" ? "listings" : "specs",
          eventType: "provider_error",
          cacheKey,
          requestMeta,
          requestSummary: requestContext,
          responseSummary: {
            message: error instanceof Error ? error.message : "Unknown MarketCheck failure",
          },
        });
        this.invalidateMonthlySummaryCache();
        logger.error(
          {
            label: "MARKETCHECK_CALL_FAILURE",
            endpoint,
            provider: "marketcheck",
            operation,
            durationMs: Date.now() - startedAt,
            reason: requestMeta?.reason ?? null,
            caller: requestMeta?.caller ?? null,
            stackTag: requestMeta?.stackTag ?? null,
            requestMeta: requestMeta ?? null,
            requestParams: params,
            trimmedStackTrace: buildTrimmedStackTrace(),
            message: error instanceof Error ? error.message : "Unknown MarketCheck failure",
            stack: error instanceof Error ? error.stack : undefined,
            code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
            details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
          },
          "MARKETCHECK_CALL_FAILURE",
        );
        throw error;
      } finally {
        clearTimeout(timeout);
        this.inflightRequests.delete(cacheKey);
      }
    })();

    this.inflightRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  async getVehicleSpecs(input: { vehicleId: string; vehicle?: VehicleRecord | null; requestMeta?: MarketCheckRequestMeta }): Promise<VehicleRecord | null> {
    const descriptor = getDescriptor(input.vehicleId, input.vehicle);
    if (!descriptor) {
      return null;
    }

    if (!env.MARKETCHECK_ENABLED) {
      this.logDisabledSkip("specs", "/v2/search/car/active", input.requestMeta);
      return null;
    }

    const response = await this.fetchInventorySearch("specs", {
      year: descriptor.year,
      make: descriptor.make,
      model: descriptor.model,
      trim: descriptor.trim,
      rows: 1,
      start: 0,
      car_type: "used",
    }, {
      requestId: input.requestMeta?.requestId ?? null,
      userId: input.requestMeta?.userId ?? null,
      year: descriptor.year,
      make: descriptor.make,
      model: descriptor.model,
      trim: descriptor.trim ?? null,
      vehicleId: input.vehicleId,
      zip: null,
      radiusMiles: null,
      mileage: null,
      condition: null,
      ...input.requestMeta,
    });

    return mapListingToVehicle(response.listings?.[0] ?? {});
  }

  async searchVehicles(input: {
    year?: string;
    make?: string;
    model?: string;
    requestMeta?: MarketCheckRequestMeta;
  }): Promise<VehicleRecord[]> {
    if (!env.MARKETCHECK_ENABLED) {
      this.logDisabledSkip("search", "/v2/search/car/active", input.requestMeta);
      return [];
    }

    const response = await this.fetchInventorySearch("search", {
      year: input.year,
      make: input.make,
      model: input.model,
      rows: 12,
      start: 0,
      car_type: "used",
    }, {
      requestId: input.requestMeta?.requestId ?? null,
      userId: input.requestMeta?.userId ?? null,
      year: input.year ?? null,
      make: input.make ?? null,
      model: input.model ?? null,
      zip: null,
      radiusMiles: null,
      mileage: null,
      condition: null,
      ...input.requestMeta,
    });

    const unique = new Map<string, VehicleRecord>();

    for (const listing of response.listings ?? []) {
      const vehicle = mapListingToVehicle(listing);
      if (!vehicle) {
        continue;
      }
      if (!unique.has(vehicle.id)) {
        unique.set(vehicle.id, vehicle);
      }
    }

    return [...unique.values()];
  }

  async searchCandidates(input: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    requestMeta?: MarketCheckRequestMeta;
  }): Promise<VehicleRecord[]> {
    return this.searchVehicles({
      year: String(input.year),
      make: input.make,
      model: input.model,
      requestMeta: {
        year: input.year,
        make: input.make,
        model: input.model,
        trim: input.trim ?? null,
        ...input.requestMeta,
      },
    });
  }

  async getValuation(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
    zip: string;
    mileage: number;
    condition: string;
    requestMeta?: MarketCheckRequestMeta;
  }): Promise<ValuationRecord | null> {
    const descriptor = getDescriptor(input.vehicleId, input.vehicle);
    if (!descriptor) {
      return null;
    }

    if (!env.MARKETCHECK_ENABLED) {
      this.logDisabledSkip("values", "/v2/search/car/active", input.requestMeta);
      return null;
    }

    const response = await this.fetchInventorySearch("values", {
      year: descriptor.year,
      make: descriptor.make,
      model: descriptor.model,
      trim: descriptor.trim,
      zip: input.zip,
      radius: input.requestMeta?.radiusMiles ?? env.MARKETCHECK_VALUE_RADIUS_MILES,
      rows: 16,
      stats: "price",
      car_type: "used",
      miles_range: `${Math.max(0, input.mileage - 15000)}-${input.mileage + 15000}`,
    }, {
      requestId: input.requestMeta?.requestId ?? null,
      userId: input.requestMeta?.userId ?? null,
      year: descriptor.year,
      make: descriptor.make,
      model: descriptor.model,
      trim: descriptor.trim ?? null,
      vehicleId: input.vehicleId,
      zip: input.zip,
      radiusMiles: input.requestMeta?.radiusMiles ?? env.MARKETCHECK_VALUE_RADIUS_MILES,
      mileage: input.mileage,
      condition: input.condition,
      ...input.requestMeta,
    });

    const normalizedListings = normalizeInventoryListings({
      descriptor,
      vehicleId: input.vehicleId,
      rawListings: response.listings ?? [],
      radiusMiles: input.requestMeta?.radiusMiles ?? env.MARKETCHECK_VALUE_RADIUS_MILES,
      yearRangeStart: input.requestMeta?.yearRangeStart ?? null,
      yearRangeEnd: input.requestMeta?.yearRangeEnd ?? null,
      traceLabel: "VALUE_PROVIDER_FILTER_TRACE",
      zip: input.zip,
    });
    const stats = getPriceStats(response.stats);
    if ((!stats || (!stats.mean && !stats.median && !stats.min && !stats.max)) && normalizedListings.listings.length === 0) {
      return null;
    }

    const listingPrices = normalizedListings.listings
      .map((listing) => listing.price)
      .filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0)
      .sort((left, right) => left - right);
    const listingMedian = listingPrices.length > 0 ? listingPrices[Math.floor(listingPrices.length / 2)] ?? null : null;
    const listingMin = listingPrices[0] ?? null;
    const listingMax = listingPrices.at(-1) ?? null;
    const anchor = stats?.median ?? stats?.mean ?? listingMedian ?? stats?.max ?? listingMax ?? stats?.min ?? listingMin ?? descriptor.vehicle?.msrp ?? 0;
    const conditionMultiplier = getConditionMultiplier(input.condition);
    const adjustedAnchor = Math.round(anchor * conditionMultiplier);
    const privatePartyLow = Math.round((stats?.min ?? listingMin ?? adjustedAnchor * 0.94) * conditionMultiplier);
    const privatePartyHigh = Math.round((stats?.max ?? listingMax ?? adjustedAnchor * 1.06) * conditionMultiplier);
    const tradeInLow = Math.round(privatePartyLow * 0.92);
    const tradeInHigh = Math.round(privatePartyHigh * 0.92);
    const dealerRetailLow = Math.round(privatePartyLow * 1.06);
    const dealerRetailHigh = Math.round(privatePartyHigh * 1.08);
    const tradeIn = Math.round(adjustedAnchor * 0.92);
    const privateParty = Math.round(adjustedAnchor);
    const dealerRetail = Math.round((stats?.max ?? listingMax ?? adjustedAnchor * 1.06) * conditionMultiplier);

    return {
      id: `live-valuation-${input.vehicleId}-${input.zip}-${input.mileage}`,
      vehicleId: input.vehicleId,
      zip: input.zip,
      mileage: input.mileage,
      condition: normalizeCondition(input.condition),
      status: "loaded_value",
      tradeIn,
      tradeInLow,
      tradeInHigh,
      privateParty,
      privatePartyLow,
      privatePartyHigh,
      dealerRetail,
      dealerRetailLow,
      dealerRetailHigh,
      currency: "USD",
      generatedAt: new Date().toISOString(),
      sourceLabel: normalizedListings.listings.length > 0 ? "Based on live MarketCheck listings" : "Based on market data",
      confidenceLabel:
        stats?.min && stats?.max && (stats.median || stats.mean)
          ? "High confidence"
          : normalizedListings.listings.length > 0
            ? "Limited comps"
            : "Moderate confidence",
      modelType: normalizedListings.listings.length > 0 && (!stats || (!stats.mean && !stats.median && !stats.min && !stats.max)) ? "listing_derived" : "provider_range",
      listingCount: normalizedListings.listings.length || null,
      supportingListings: normalizedListings.listings,
    };
  }

  async getListings(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
    zip: string;
    radiusMiles: number;
    requestMeta?: MarketCheckRequestMeta;
  }): Promise<ListingRecord[]> {
    const descriptor = getDescriptor(input.vehicleId, input.vehicle);
    if (!descriptor) {
      return [];
    }

    if (!env.MARKETCHECK_ENABLED) {
      this.logDisabledSkip("listings", "/v2/search/car/active", input.requestMeta);
      return [];
    }

    const response = await this.fetchInventorySearch("listings", {
      year: descriptor.year,
      make: descriptor.make,
      model: descriptor.model,
      trim: descriptor.trim,
      zip: input.zip,
      radius: input.radiusMiles,
      rows: 8,
      start: 0,
      car_type: "used",
    }, {
      requestId: input.requestMeta?.requestId ?? null,
      userId: input.requestMeta?.userId ?? null,
      year: descriptor.year,
      make: descriptor.make,
      model: descriptor.model,
      trim: descriptor.trim ?? null,
      vehicleId: input.vehicleId,
      zip: input.zip,
      radiusMiles: input.radiusMiles,
      mileage: null,
      condition: null,
      ...input.requestMeta,
    });

    return normalizeInventoryListings({
      descriptor,
      vehicleId: input.vehicleId,
      rawListings: response.listings ?? [],
      radiusMiles: input.radiusMiles,
      yearRangeStart:
        typeof input.requestMeta?.yearRangeStart === "number" && Number.isFinite(input.requestMeta.yearRangeStart)
          ? input.requestMeta.yearRangeStart
          : null,
      yearRangeEnd:
        typeof input.requestMeta?.yearRangeEnd === "number" && Number.isFinite(input.requestMeta.yearRangeEnd)
          ? input.requestMeta.yearRangeEnd
          : null,
      traceLabel: "LISTINGS_PROVIDER_FILTER_TRACE",
      zip: input.zip,
    }).listings;
  }
}
