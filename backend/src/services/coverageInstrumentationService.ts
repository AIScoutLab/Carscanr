import { logger } from "../lib/logger.js";
import { EnrichmentMode, PayloadStrength, VehicleType } from "../types/domain.js";

type CoverageFieldKey =
  | "horsepower"
  | "drivetrain"
  | "bodyStyle"
  | "fuelType"
  | "msrp"
  | "marketValue"
  | "believableListings";

type CoverageFieldPopulation = Record<CoverageFieldKey, boolean> & {
  totalMeaningfulSpecFields: number;
};

type CoverageFieldSources = Record<CoverageFieldKey, string | null>;

type CoverageScanEvent = {
  scanId: string;
  identifiedYear: number | null;
  identifiedMake: string | null;
  identifiedModel: string | null;
  vehicleType: VehicleType | null;
  vinPresent: boolean;
  enrichmentMode: EnrichmentMode;
  payloadStrength: PayloadStrength;
  unlockEligible: boolean;
  unlockRecommendationReason: string;
  fieldPopulation: CoverageFieldPopulation;
  fieldSources: CoverageFieldSources;
  rescuedByAdjacentYear: boolean;
};

type AggregateReport = {
  totalScans: number;
  payloadStrengthRates: Record<PayloadStrength, number>;
  topBlockedMakesModels: Array<{ makeModel: string; count: number }>;
  topBlockedYears: Array<{ year: string; count: number }>;
  topMissingFields: Array<{ field: CoverageFieldKey; count: number }>;
  adjacentYearRescueRate: number;
  vinAvailabilityRate: number;
  listingCoverageRate: number;
  marketValueCoverageRate: number;
};

function incrementCounter(counter: Map<string, number>, key: string) {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function topEntries(counter: Map<string, number>, limit = 5) {
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

class CoverageInstrumentationService {
  private totalScans = 0;
  private payloadStrengthCounts: Record<PayloadStrength, number> = {
    strong: 0,
    usable: 0,
    thin: 0,
    empty: 0,
  };
  private blockedMakesModels = new Map<string, number>();
  private blockedYears = new Map<string, number>();
  private missingFields = new Map<CoverageFieldKey, number>();
  private adjacentYearRescues = 0;
  private vinPresentCount = 0;
  private listingCoverageCount = 0;
  private marketValueCoverageCount = 0;

  recordScan(event: CoverageScanEvent) {
    this.totalScans += 1;
    this.payloadStrengthCounts[event.payloadStrength] += 1;

    if (!event.unlockEligible) {
      incrementCounter(
        this.blockedMakesModels,
        `${event.identifiedMake ?? "Unknown"} ${event.identifiedModel ?? "Vehicle"}`.trim(),
      );
      incrementCounter(this.blockedYears, event.identifiedYear ? String(event.identifiedYear) : "unknown");
    }

    (Object.keys(event.fieldPopulation) as Array<keyof CoverageFieldPopulation>).forEach((field) => {
      if (field === "totalMeaningfulSpecFields") {
        return;
      }
      if (!event.fieldPopulation[field]) {
        incrementCounter(this.missingFields as Map<string, number>, field);
      }
    });

    if (event.rescuedByAdjacentYear) {
      this.adjacentYearRescues += 1;
    }
    if (event.vinPresent) {
      this.vinPresentCount += 1;
    }
    if (event.fieldPopulation.believableListings) {
      this.listingCoverageCount += 1;
    }
    if (event.fieldPopulation.marketValue) {
      this.marketValueCoverageCount += 1;
    }

    logger.info(
      {
        label: "COVERAGE_SCAN_EVENT",
        scanId: event.scanId,
        identifiedYear: event.identifiedYear,
        identifiedMake: event.identifiedMake,
        identifiedModel: event.identifiedModel,
        vehicleType: event.vehicleType,
        vinPresent: event.vinPresent,
        enrichmentMode: event.enrichmentMode,
        payloadStrength: event.payloadStrength,
        unlockEligible: event.unlockEligible,
        unlockRecommendationReason: event.unlockRecommendationReason,
        fieldPopulation: event.fieldPopulation,
        fieldSources: event.fieldSources,
        rescuedByAdjacentYear: event.rescuedByAdjacentYear,
      },
      "COVERAGE_SCAN_EVENT",
    );

    const aggregate = this.buildAggregateReport();
    logger.info(
      {
        label: "COVERAGE_AGGREGATE_REPORT",
        ...aggregate,
      },
      "COVERAGE_AGGREGATE_REPORT",
    );
  }

  private buildAggregateReport(): AggregateReport {
    const total = Math.max(1, this.totalScans);
    return {
      totalScans: this.totalScans,
      payloadStrengthRates: {
        strong: this.payloadStrengthCounts.strong / total,
        usable: this.payloadStrengthCounts.usable / total,
        thin: this.payloadStrengthCounts.thin / total,
        empty: this.payloadStrengthCounts.empty / total,
      },
      topBlockedMakesModels: topEntries(this.blockedMakesModels).map(({ key, count }) => ({
        makeModel: key,
        count,
      })),
      topBlockedYears: topEntries(this.blockedYears).map(({ key, count }) => ({
        year: key,
        count,
      })),
      topMissingFields: topEntries(this.missingFields as Map<string, number>).map(({ key, count }) => ({
        field: key as CoverageFieldKey,
        count,
      })),
      adjacentYearRescueRate: this.adjacentYearRescues / total,
      vinAvailabilityRate: this.vinPresentCount / total,
      listingCoverageRate: this.listingCoverageCount / total,
      marketValueCoverageRate: this.marketValueCoverageCount / total,
    };
  }
}

export const coverageInstrumentationService = new CoverageInstrumentationService();
