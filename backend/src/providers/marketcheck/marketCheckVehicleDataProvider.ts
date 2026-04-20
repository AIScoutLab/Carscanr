import { env } from "../../config/env.js";
import { AppError } from "../../errors/appError.js";
import { normalizeCondition } from "../../lib/providerCache.js";
import { resolveHorsepower } from "../../lib/vehicleData.js";
import { logger } from "../../lib/logger.js";
import { ListingRecord, ValuationRecord, VehicleRecord } from "../../types/domain.js";
import { VehicleListingsProvider, VehicleSpecsProvider, VehicleValueProvider } from "../interfaces.js";
import { buildLiveVehicleId, parseLiveVehicleId } from "./vehicleId.js";

type InventorySearchResponse = {
  listings?: MarketCheckListing[];
  stats?: Record<string, unknown>;
};

type MarketCheckListing = {
  id?: string;
  vin?: string;
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

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
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
  const mpg = cityMpg && highwayMpg ? `${cityMpg} city / ${highwayMpg} hwy` : "See live listing";
  const engine = listing.engine ?? listing.build?.engine ?? "See live listing";
  const drivetrain = listing.drivetrain ?? listing.build?.drivetrain ?? "See live listing";
  const transmission = listing.transmission ?? listing.build?.transmission ?? "See live listing";
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
    torque: "See live listing",
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

  private async fetchInventorySearch(operation: string, params: Record<string, string | number | undefined>) {
    if (!this.apiKey) {
      throw new Error("MARKETCHECK_API_KEY is not configured.");
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
    this.marketCheckCallCount += 1;
    logger.info(
      {
        provider: "marketcheck",
        operation,
        marketCheckCallCount: this.marketCheckCallCount,
      },
      "MarketCheck API call",
    );

    try {
      const response = await fetch(`${this.baseUrl}/v2/search/car/active?${searchParams.toString()}`, {
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

      return (await response.json()) as InventorySearchResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getVehicleSpecs(input: { vehicleId: string; vehicle?: VehicleRecord | null }): Promise<VehicleRecord | null> {
    const descriptor = getDescriptor(input.vehicleId, input.vehicle);
    if (!descriptor) {
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
    });

    return mapListingToVehicle(response.listings?.[0] ?? {});
  }

  async searchVehicles(input: {
    year?: string;
    make?: string;
    model?: string;
  }): Promise<VehicleRecord[]> {
    const response = await this.fetchInventorySearch("search", {
      year: input.year,
      make: input.make,
      model: input.model,
      rows: 12,
      start: 0,
      car_type: "used",
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
  }): Promise<VehicleRecord[]> {
    return this.searchVehicles({
      year: String(input.year),
      make: input.make,
      model: input.model,
    });
  }

  async getValuation(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
    zip: string;
    mileage: number;
    condition: string;
  }): Promise<ValuationRecord | null> {
    const descriptor = getDescriptor(input.vehicleId, input.vehicle);
    if (!descriptor) {
      return null;
    }

    const response = await this.fetchInventorySearch("values", {
      year: descriptor.year,
      make: descriptor.make,
      model: descriptor.model,
      trim: descriptor.trim,
      zip: input.zip,
      radius: env.MARKETCHECK_VALUE_RADIUS_MILES,
      rows: 0,
      stats: "price",
      car_type: "used",
      miles_range: `${Math.max(0, input.mileage - 15000)}-${input.mileage + 15000}`,
    });

    const stats = getPriceStats(response.stats);
    if (!stats || (!stats.mean && !stats.median && !stats.min && !stats.max)) {
      return null;
    }

    const anchor = stats.median ?? stats.mean ?? stats.max ?? stats.min ?? descriptor.vehicle?.msrp ?? 0;
    const conditionMultiplier = getConditionMultiplier(input.condition);
    const adjustedAnchor = Math.round(anchor * conditionMultiplier);
    const privatePartyLow = Math.round((stats.min ?? adjustedAnchor * 0.94) * conditionMultiplier);
    const privatePartyHigh = Math.round((stats.max ?? adjustedAnchor * 1.06) * conditionMultiplier);
    const tradeInLow = Math.round(privatePartyLow * 0.92);
    const tradeInHigh = Math.round(privatePartyHigh * 0.92);
    const dealerRetailLow = Math.round(privatePartyLow * 1.06);
    const dealerRetailHigh = Math.round(privatePartyHigh * 1.08);
    const tradeIn = Math.round(adjustedAnchor * 0.92);
    const privateParty = Math.round(adjustedAnchor);
    const dealerRetail = Math.round((stats.max ?? adjustedAnchor * 1.06) * conditionMultiplier);

    return {
      id: `live-valuation-${input.vehicleId}-${input.zip}-${input.mileage}`,
      vehicleId: input.vehicleId,
      zip: input.zip,
      mileage: input.mileage,
      condition: normalizeCondition(input.condition),
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
      sourceLabel: "Based on market data",
      confidenceLabel: stats.min && stats.max && (stats.median || stats.mean) ? "High confidence" : "Moderate confidence",
      modelType: "provider_range",
      listingCount: null,
    };
  }

  async getListings(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
    zip: string;
    radiusMiles: number;
  }): Promise<ListingRecord[]> {
    const descriptor = getDescriptor(input.vehicleId, input.vehicle);
    if (!descriptor) {
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
    });

    return (response.listings ?? []).flatMap((listing) => {
      const year = listing.year ?? listing.build?.year;
      const make = listing.make ?? listing.build?.make;
      const model = listing.model ?? listing.build?.model;

      if (!year || !make || !model || !listing.price) {
        return [];
      }

      const trim = listing.trim?.trim() || listing.build?.trim?.trim() || descriptor.trim || "Base";

      return [
        {
          id: `live-listing-${listing.id ?? listing.vin ?? buildLiveVehicleId({ year, make, model, trim })}`,
          vehicleId: input.vehicleId,
          title: listing.heading ?? `${year} ${titleCase(make)} ${titleCase(model)} ${trim}`.trim(),
          price: listing.price,
          mileage: listing.miles ?? 0,
          dealer: listing.dealer_name ?? listing.dealer?.name ?? listing.seller?.name ?? "Market listing",
          distanceMiles: Math.round(listing.dist ?? input.radiusMiles),
          location: getLocation(listing),
          imageUrl: getImageUrl(listing),
          listedAt: listing.first_seen_at_date ?? listing.last_seen_at_date ?? new Date().toISOString(),
        },
      ];
    });
  }
}
