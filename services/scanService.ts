import AsyncStorage from "@react-native-async-storage/async-storage";
import { FREE_PRO_UNLOCKS_TOTAL, normalizeFreeUnlockCounter } from "@/constants/product";
import { defaultSubscriptionStatus } from "@/constants/seedData";
import { getVehicleImage } from "@/constants/vehicleImages";
import { applyPlanOverride } from "@/features/subscription/planOverride";
import { findSampleScanPhoto, getSampleVehicleRouteId } from "@/features/scan/samplePhotos";
import { getApiBaseUrlOrThrow } from "@/lib/env";
import { isProPlan } from "@/lib/subscription";
import { analyticsService, normalizeErrorCategory } from "@/services/analyticsService";
import { authService } from "@/services/authService";
import { guestSessionService } from "@/services/guestSessionService";
import { offlineCanonicalService } from "@/services/offlineCanonicalService";
import { ApiRequestError, apiRequest, apiRequestEnvelope } from "@/services/apiClient";
import { ScanResult, SubscriptionStatus, VehicleCandidate } from "@/types";
import * as FileSystem from "expo-file-system";

let mutableRecentScans: ScanResult[] = [];
const recentScansListeners = new Set<(scans: ScanResult[]) => void>();
let mutableUsage: SubscriptionStatus = { ...defaultSubscriptionStatus };
let mutableUnlockStatus: {
  freeUnlocksTotal: number;
  freeUnlocksUsed: number;
  freeUnlocksRemaining: number;
  unlockCreditsRemaining?: number;
  totalUnlocksAvailable?: number;
  unlockedVehicleCount: number;
  unlockedVehicleIds: string[];
} = {
  freeUnlocksTotal: FREE_PRO_UNLOCKS_TOTAL,
  freeUnlocksUsed: 0,
  freeUnlocksRemaining: FREE_PRO_UNLOCKS_TOTAL,
  unlockedVehicleCount: 0,
  unlockedVehicleIds: [] as string[],
};
let usageRequestInFlight: Promise<SubscriptionStatus> | null = null;
let currentScanFlowSource: "camera" | "library" | "sample" | "unknown" = "unknown";
let mutableRecentScansDiagnostics = {
  currentStorageKey: "in_memory_recent_scans",
  guestStorageKey: "in_memory_recent_scans",
  mirrorStorageKey: "in_memory_recent_scans",
  lastSavedCount: 0,
  lastLoadedCount: 0,
  lastSavedLabel: null as string | null,
  lastSavedAt: null as string | null,
  lastLoadedAt: null as string | null,
  lastSaveError: null as string | null,
  lastLoadError: null as string | null,
  lastMigratedFromKeys: [] as string[],
};

const MAX_UPLOAD_BYTES = 4.8 * 1024 * 1024;
const BACKEND_WAKE_TIMEOUT_MS = 45000;
const IDENTIFY_TIMEOUT_MS = 60000;
const IDENTIFY_TIMEOUT_MS_AFTER_SLOW_WAKE = 90000;
const OFFLINE_SCAN_CACHE_KEY = "offline_scan_result_cache_v1";
const RECENT_SCAN_STORAGE_PREFIX = "carscanr.recentScans.v1";
const MAX_RECENT_SCANS = 6;

type IdentifyStageLogger = (stage: string, payload?: unknown) => void;
type BackendHealthResponse = {
  status: string;
  environment: string;
  appEnv: string;
};

type BackendUsageResponse = {
  userId: string;
  plan: "free" | "pro" | "pro_monthly" | "pro_yearly";
  isPro: boolean;
  scansUsed: number;
  scansRemaining: number | null;
  limitType: "lifetime";
  limit: number | null;
  scansUsedToday: number;
  dailyScanLimit: number | null;
  scansRemainingToday: number | null;
  abuseWindowLimit: number;
  freeUnlocksTotal?: number;
  freeUnlocksUsed?: number;
  freeUnlocksRemaining?: number;
  unlockCreditsRemaining?: number;
  totalUnlocksAvailable?: number;
  unlockedVehicleCount?: number;
  unlockedVehicleIds?: string[];
};

type BackendScanCandidate = {
  vehicleId: string;
  year: number;
  displayYearLabel?: string | null;
  displayTitleLabel?: string | null;
  displayTrimLabel?: string | null;
  yearRange?: {
    start: number;
    end: number;
  } | null;
  make: string;
  model: string;
  trim: string;
  confidence: number;
  matchReason: string;
};

type BackendScanResponse = {
  id: string;
  userId: string;
  imageUrl: string;
  detectedVehicleType: "car" | "truck" | "motorcycle";
  confidence: number;
  createdAt: string;
  normalizedResult: {
    visible_clues: string[];
    likely_year?: number;
    likely_make?: string;
    likely_model?: string;
    likely_trim?: string;
    source?: "visual_candidate" | "ocr_override" | "visual_override";
  };
  candidates: BackendScanCandidate[];
};

type StoredOfflineScanCache = Record<string, ScanResult>;
type RecentScanStorageContext = {
  currentStorageKey: string;
  guestStorageKey: string;
  mirrorStorageKey: string;
};

type BackendScanMeta = {
  provider?: string;
  topCandidateVehicleId?: string | null;
  scanRuntimeVersion?: string;
  identificationConfidence?: number | null;
  dataConfidence?: number | null;
  payloadStrength?: "strong" | "usable" | "thin" | "empty" | null;
  enrichmentMode?: "exact" | "adjacent_year" | "generation_fallback" | "fallback_only" | null;
  unlockEligible?: boolean | null;
  unlockRecommendationReason?: string | null;
  premium?: {
    usedUnlock: boolean;
    alreadyUnlocked: boolean;
    remainingUnlocks: number;
    isPro: boolean;
  } | null;
};

function safeString(value: unknown, fallback = "") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function safeNumber(value: unknown, fallback: number | null = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function getUploadFileName(imageUri: string) {
  const lastSegment = imageUri.split("/").pop();
  return lastSegment && lastSegment.length > 0 ? lastSegment : `scan-${Date.now()}.jpg`;
}

function getIdentifyEndpointUrl() {
  return `${getApiBaseUrlOrThrow()}/api/scan/identify`;
}

async function assertUploadSize(imageUri: string) {
  try {
    const info = await FileSystem.getInfoAsync(imageUri, { size: true });
    if (info.exists && typeof info.size === "number" && info.size > MAX_UPLOAD_BYTES) {
      throw new Error("This photo is too large to upload. Try a smaller image or crop the photo.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("too large")) {
      throw error;
    }
    if (__DEV__) {
      console.log("[scan-service] upload size check skipped", error instanceof Error ? error.message : error);
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

function emitRecentScansChanged() {
  for (const listener of recentScansListeners) {
    try {
      listener([...mutableRecentScans]);
    } catch (error) {
      console.log("[scan-service] RECENT_SCANS_LISTENER_FAILURE", {
        message: error instanceof Error ? error.message : "Unknown recent scans listener error",
      });
    }
  }
}

function getRecentScanDisplayName(scan: ScanResult) {
  return `${scan.identifiedVehicle.year} ${scan.identifiedVehicle.make} ${scan.identifiedVehicle.model} ${scan.identifiedVehicle.trim ?? ""}`.trim();
}

function normalizeStoredRecentScans(input: unknown): ScanResult[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((scan): scan is ScanResult => {
    return Boolean(
      scan &&
      typeof scan === "object" &&
      typeof (scan as ScanResult).id === "string" &&
      (scan as ScanResult).identifiedVehicle &&
      typeof (scan as ScanResult).identifiedVehicle === "object",
    );
  }).slice(0, MAX_RECENT_SCANS);
}

async function resolveRecentScanStorageContext(): Promise<RecentScanStorageContext> {
  const user = await authService.getCurrentUser().catch(() => null);
  const guestId = user ? null : await guestSessionService.getGuestId();
  const guestStorageKey = `${RECENT_SCAN_STORAGE_PREFIX}:guest:${guestId ?? "anonymous"}`;
  const currentStorageKey = user?.id ? `${RECENT_SCAN_STORAGE_PREFIX}:user:${user.id}` : guestStorageKey;
  const context = {
    currentStorageKey,
    guestStorageKey,
    mirrorStorageKey: currentStorageKey,
  };
  mutableRecentScansDiagnostics.currentStorageKey = context.currentStorageKey;
  mutableRecentScansDiagnostics.guestStorageKey = context.guestStorageKey;
  mutableRecentScansDiagnostics.mirrorStorageKey = context.mirrorStorageKey;
  return context;
}

async function loadPersistedRecentScans() {
  const context = await resolveRecentScanStorageContext();
  mutableRecentScansDiagnostics.lastLoadedAt = new Date().toISOString();
  mutableRecentScansDiagnostics.lastLoadError = null;
  try {
    const storedCurrent = await AsyncStorage.getItem(context.currentStorageKey);
    const currentScans = normalizeStoredRecentScans(storedCurrent ? JSON.parse(storedCurrent) : []);
    mutableRecentScans = currentScans;
    mutableRecentScansDiagnostics.lastLoadedCount = mutableRecentScans.length;
    mutableRecentScansDiagnostics.lastMigratedFromKeys = [];
    return mutableRecentScans;
  } catch (error) {
    mutableRecentScansDiagnostics.lastLoadError = error instanceof Error ? error.message : "Unknown recent scans load error";
    mutableRecentScansDiagnostics.lastLoadedCount = mutableRecentScans.length;
    return mutableRecentScans;
  }
}

async function persistRecentScans(scans: ScanResult[]) {
  const context = await resolveRecentScanStorageContext();
  const serialized = JSON.stringify(scans.slice(0, MAX_RECENT_SCANS));
  await AsyncStorage.setItem(context.currentStorageKey, serialized);
}

async function saveRecentScan(scan: ScanResult) {
  mutableRecentScans = [scan, ...mutableRecentScans.filter((entry) => entry.id !== scan.id)].slice(0, MAX_RECENT_SCANS);
  mutableRecentScansDiagnostics.lastSavedAt = new Date().toISOString();
  mutableRecentScansDiagnostics.lastSavedCount = mutableRecentScans.length;
  mutableRecentScansDiagnostics.lastSavedLabel = getRecentScanDisplayName(scan);
  mutableRecentScansDiagnostics.lastSaveError = null;
  try {
    await persistRecentScans(mutableRecentScans);
  } catch (error) {
    mutableRecentScansDiagnostics.lastSaveError = error instanceof Error ? error.message : "Unknown recent scans save error";
  }
  emitRecentScansChanged();
}

function createInMemorySampleResult(sampleId: string): ScanResult {
  const sample = findSampleScanPhoto(sampleId);
  if (!sample) {
    throw new Error("Sample photo not found.");
  }

  const vehicleId = getSampleVehicleRouteId(sample.id);
  const thumbnailUrl = sample.previewUrl;

  return {
    id: `sample-${sample.id}`,
    imageUri: sample.previewUrl,
    identifiedVehicle: {
      id: vehicleId,
      year: sample.year,
      make: sample.make,
      model: sample.model,
      trim: sample.trim,
      source: "sample_vehicle",
      confidence: 0.92,
      thumbnailUrl,
    },
    candidates: [
      {
        id: vehicleId,
        year: sample.year,
        make: sample.make,
        model: sample.model,
        trim: sample.trim,
        source: "sample_vehicle",
        confidence: 0.92,
        thumbnailUrl,
      },
    ],
    source: "sample_vehicle",
    confidenceScore: 0.92,
    detectedVehicleType: sample.specs.vehicleType,
    limitedPreview: true,
    scannedAt: new Date().toISOString(),
    quickResult: true,
    quickResultSource: "local_scan_cache",
    offlineDatasetVersion: null,
    identificationConfidence: 0.92,
    dataConfidence: 0.7,
    payloadStrength: "usable",
    enrichmentMode: "fallback_only",
    unlockEligible: false,
    unlockRecommendationReason: "sample_vehicle_demo",
    isSampleVehicle: true,
  };
}

function mapUsage(usage: BackendUsageResponse): SubscriptionStatus {
  if (typeof usage.freeUnlocksTotal === "number") {
    const normalizedCounter = normalizeFreeUnlockCounter({
      total: usage.freeUnlocksTotal ?? FREE_PRO_UNLOCKS_TOTAL,
      used: usage.freeUnlocksUsed ?? 0,
      remaining:
        usage.freeUnlocksRemaining ?? Math.max(0, (usage.freeUnlocksTotal ?? FREE_PRO_UNLOCKS_TOTAL) - (usage.freeUnlocksUsed ?? 0)),
    });
    mutableUnlockStatus = {
      freeUnlocksTotal: normalizedCounter.limit,
      freeUnlocksUsed: normalizedCounter.used,
      freeUnlocksRemaining: normalizedCounter.remaining,
      unlockCreditsRemaining: typeof usage.unlockCreditsRemaining === "number" ? Math.max(0, usage.unlockCreditsRemaining) : undefined,
      totalUnlocksAvailable: typeof usage.totalUnlocksAvailable === "number" ? Math.max(0, usage.totalUnlocksAvailable) : undefined,
      unlockedVehicleCount: usage.unlockedVehicleCount ?? 0,
      unlockedVehicleIds: Array.isArray(usage.unlockedVehicleIds) ? usage.unlockedVehicleIds : mutableUnlockStatus.unlockedVehicleIds,
    };
    console.log("FREE_UNLOCK_COUNTER_STATE", {
      source: "scan_usage",
      used: mutableUnlockStatus.freeUnlocksUsed,
      remaining: mutableUnlockStatus.freeUnlocksRemaining,
      limit: mutableUnlockStatus.freeUnlocksTotal,
      unlockedVehicleCount: mutableUnlockStatus.unlockedVehicleIds.length,
    });
  }
  return applyPlanOverride({
    plan: usage.plan,
    renewalLabel: isProPlan(usage.plan) ? "Pro active" : "Upgrade for unlimited Pro details",
    scansUsed: usage.scansUsed,
    scansRemaining: usage.scansRemaining,
    limitType: usage.limitType,
    limit: usage.limit,
    scansUsedToday: usage.scansUsedToday,
    dailyScanLimit: usage.dailyScanLimit,
  });
}

function mapCandidate(candidate: Partial<BackendScanCandidate>): VehicleCandidate {
  const candidateId = safeString(candidate.vehicleId, "");
  const displayYearLabel = safeString(candidate.displayYearLabel, "");
  const displayTitleLabel = safeString(candidate.displayTitleLabel, "");
  const displayTrimLabel = safeString(candidate.displayTrimLabel, "");
  return {
    id: candidateId,
    year: safeNumber(candidate.year, 0) ?? 0,
    displayYearLabel: displayYearLabel || undefined,
    displayTitleLabel: displayTitleLabel || undefined,
    displayTrimLabel: displayTrimLabel || undefined,
    groundedYearRange:
      typeof candidate.yearRange?.start === "number" && typeof candidate.yearRange?.end === "number"
        ? {
            start: candidate.yearRange.start,
            end: candidate.yearRange.end,
          }
        : null,
    make: safeString(candidate.make, "Unknown"),
    model: safeString(candidate.model, "Vehicle"),
    trim: safeString(candidate.trim, ""),
    source: undefined,
    confidence: safeNumber(candidate.confidence, 0) ?? 0,
    thumbnailUrl: getVehicleImage(candidateId || "unknown-vehicle"),
  };
}

function normalizeBackendScanResponse(raw: BackendScanResponse): BackendScanResponse {
  return {
    id: safeString(raw?.id, `scan-${Date.now()}`),
    userId: safeString(raw?.userId, "unknown-user"),
    imageUrl: safeString(raw?.imageUrl, ""),
    detectedVehicleType: raw?.detectedVehicleType === "motorcycle" ? "motorcycle" : "car",
    confidence: safeNumber(raw?.confidence, 0) ?? 0,
    createdAt: safeString(raw?.createdAt, new Date().toISOString()),
    normalizedResult: {
      source:
        raw?.normalizedResult?.source === "ocr_override"
          ? "ocr_override"
          : raw?.normalizedResult?.source === "visual_override"
            ? "visual_override"
            : "visual_candidate",
      visible_clues: Array.isArray(raw?.normalizedResult?.visible_clues)
        ? raw.normalizedResult.visible_clues.filter((clue) => typeof clue === "string")
        : [],
    },
    candidates: Array.isArray(raw?.candidates)
        ? raw.candidates.map((candidate) => ({
          vehicleId: safeString(candidate?.vehicleId, ""),
          year: safeNumber(candidate?.year, 0) ?? 0,
          displayYearLabel: safeString(candidate?.displayYearLabel, "") || null,
          displayTitleLabel: safeString(candidate?.displayTitleLabel, "") || null,
          displayTrimLabel: safeString(candidate?.displayTrimLabel, "") || null,
          yearRange:
            typeof candidate?.yearRange?.start === "number" && typeof candidate?.yearRange?.end === "number"
              ? {
                  start: candidate.yearRange.start,
                  end: candidate.yearRange.end,
                }
              : null,
          make: safeString(candidate?.make, "Unknown"),
          model: safeString(candidate?.model, "Vehicle"),
          trim: safeString(candidate?.trim, ""),
          confidence: safeNumber(candidate?.confidence, 0) ?? 0,
          matchReason: safeString(candidate?.matchReason, ""),
        }))
      : [],
  };
}

function mapScanResponse(scan: BackendScanResponse, imageUri: string, usage: SubscriptionStatus, meta?: BackendScanMeta | null): ScanResult {
  const normalized = normalizeBackendScanResponse(scan);
  const candidates = normalized.candidates.map(mapCandidate);
  return {
    id: normalized.id,
    imageUri: safeString(imageUri, normalized.imageUrl),
    identifiedVehicle:
      (candidates[0]
        ? {
            ...candidates[0],
            source: normalized.normalizedResult.source,
          }
        : null) ??
      ({
        id: "unknown-vehicle",
        year: 0,
        make: "Unknown",
        model: "Vehicle",
        source: normalized.normalizedResult.source,
        confidence: normalized.confidence,
        thumbnailUrl: getVehicleImage("unknown-vehicle"),
      } satisfies VehicleCandidate),
    candidates,
    source: normalized.normalizedResult.source,
    confidenceScore: normalized.confidence,
    detectedVehicleType: normalized.detectedVehicleType,
    limitedPreview: usage.plan === "free",
    scannedAt: normalized.createdAt,
    quickResult: false,
    quickResultSource: undefined,
    offlineDatasetVersion: null,
    identificationConfidence: safeNumber(meta?.identificationConfidence, null),
    dataConfidence: safeNumber(meta?.dataConfidence, null),
    payloadStrength:
      meta?.payloadStrength === "strong" || meta?.payloadStrength === "usable" || meta?.payloadStrength === "thin" || meta?.payloadStrength === "empty"
        ? meta.payloadStrength
        : null,
    enrichmentMode:
      meta?.enrichmentMode === "exact" ||
      meta?.enrichmentMode === "adjacent_year" ||
      meta?.enrichmentMode === "generation_fallback" ||
      meta?.enrichmentMode === "fallback_only"
        ? meta.enrichmentMode
        : null,
    unlockEligible: typeof meta?.unlockEligible === "boolean" ? meta.unlockEligible : null,
    unlockRecommendationReason: safeString(meta?.unlockRecommendationReason, "") || null,
  };
}

async function getImageFingerprint(imageUri: string) {
  try {
    const info = await FileSystem.getInfoAsync(imageUri, { md5: true } as any);
    return info.exists && "md5" in info ? ((info as any).md5 as string | null) : null;
  } catch {
    return null;
  }
}

async function readOfflineScanCache(): Promise<StoredOfflineScanCache> {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_SCAN_CACHE_KEY);
    if (!stored) {
      return {};
    }
    return JSON.parse(stored) as StoredOfflineScanCache;
  } catch {
    return {};
  }
}

async function writeOfflineScanCache(cache: StoredOfflineScanCache) {
  try {
    await AsyncStorage.setItem(OFFLINE_SCAN_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Best-effort local cache only.
  }
}

async function clearOfflineScanCache() {
  try {
    await AsyncStorage.removeItem(OFFLINE_SCAN_CACHE_KEY);
  } catch {
    // Best-effort local cache only.
  }
}

export const scanService = {
  async getRecentScans(options?: { forceRefresh?: boolean }): Promise<ScanResult[]> {
    if (options?.forceRefresh || mutableRecentScans.length === 0) {
      await loadPersistedRecentScans();
    } else {
      mutableRecentScansDiagnostics.lastLoadedAt = new Date().toISOString();
      mutableRecentScansDiagnostics.lastLoadedCount = mutableRecentScans.length;
    }
    return mutableRecentScans;
  },

  subscribeRecentScans(listener: (scans: ScanResult[]) => void) {
    recentScansListeners.add(listener);
    return () => {
      recentScansListeners.delete(listener);
    };
  },

  getRecentScansDiagnostics() {
    return { ...mutableRecentScansDiagnostics };
  },

  getCachedUnlockStatus() {
    return mutableUnlockStatus;
  },

  updateCachedUnlockStatus(status: {
    freeUnlocksTotal?: number;
    freeUnlocksUsed?: number;
    freeUnlocksRemaining?: number;
    unlockCreditsRemaining?: number;
    totalUnlocksAvailable?: number;
    unlockedVehicleIds?: string[];
  }) {
    const normalizedCounter = normalizeFreeUnlockCounter({
      total: status.freeUnlocksTotal ?? mutableUnlockStatus.freeUnlocksTotal,
      used: status.freeUnlocksUsed ?? mutableUnlockStatus.freeUnlocksUsed,
      remaining:
        status.freeUnlocksRemaining ??
        Math.max(0, (status.freeUnlocksTotal ?? mutableUnlockStatus.freeUnlocksTotal) - (status.freeUnlocksUsed ?? mutableUnlockStatus.freeUnlocksUsed)),
    });
    mutableUnlockStatus = {
      freeUnlocksTotal: normalizedCounter.limit,
      freeUnlocksUsed: normalizedCounter.used,
      freeUnlocksRemaining: normalizedCounter.remaining,
      unlockCreditsRemaining:
        typeof status.unlockCreditsRemaining === "number"
          ? Math.max(0, status.unlockCreditsRemaining)
          : mutableUnlockStatus.unlockCreditsRemaining,
      totalUnlocksAvailable:
        typeof status.totalUnlocksAvailable === "number"
          ? Math.max(0, status.totalUnlocksAvailable)
          : normalizedCounter.remaining + Math.max(0, mutableUnlockStatus.unlockCreditsRemaining ?? 0),
      unlockedVehicleCount: status.unlockedVehicleIds?.length ?? mutableUnlockStatus.unlockedVehicleCount,
      unlockedVehicleIds: Array.isArray(status.unlockedVehicleIds) ? status.unlockedVehicleIds : mutableUnlockStatus.unlockedVehicleIds,
    };
    console.log("FREE_UNLOCK_COUNTER_STATE", {
      source: "scan_cache_updated_after_unlock",
      used: mutableUnlockStatus.freeUnlocksUsed,
      remaining: mutableUnlockStatus.freeUnlocksRemaining,
      limit: mutableUnlockStatus.freeUnlocksTotal,
      unlockCreditsRemaining: mutableUnlockStatus.unlockCreditsRemaining ?? 0,
      totalUnlocksAvailable: mutableUnlockStatus.totalUnlocksAvailable ?? mutableUnlockStatus.freeUnlocksRemaining,
      unlockedVehicleCount: mutableUnlockStatus.unlockedVehicleIds.length,
    });
    return mutableUnlockStatus;
  },

  beginNewScanFlow(input: { source: "camera" | "library" | "sample"; route: string; imageUri?: string | null }) {
    currentScanFlowSource = input.source;
    console.log("[SCAN_ENTRY]", { file: input.route, action: input.source, imageUri: input.imageUri ?? null, forceFreshRequest: true });
    void clearOfflineScanCache();
  },

  async createSampleResult(sampleId: string): Promise<ScanResult> {
    const result = createInMemorySampleResult(sampleId);
    await saveRecentScan(result);
    return result;
  },

  async getUsage(): Promise<SubscriptionStatus> {
    if (usageRequestInFlight) {
      console.log("[scan-service] USAGE_FETCH_START", { source: "deduped-wait" });
      return usageRequestInFlight;
    }

    usageRequestInFlight = (async () => {
      const token = await authService.getAccessToken();
      const guestId = token ? null : await guestSessionService.getGuestId();
      console.log("[scan-service] USAGE_FETCH_START", {
        signedIn: Boolean(token),
        guestIdPresent: Boolean(guestId),
      });
      try {
        const usage = await apiRequest<BackendUsageResponse>({
          path: "/api/usage/today",
          authRequired: false,
          headers: guestId ? { "x-carscanr-guest-id": guestId } : undefined,
        });
        mutableUsage = mapUsage(usage);
        console.log("[scan-service] USAGE_FETCH_SUCCESS", {
          plan: mutableUsage.plan,
          scansUsed: mutableUsage.scansUsed,
          scansRemaining: mutableUsage.scansRemaining,
        });
        return mutableUsage;
      } catch (error) {
        console.log("[scan-service] USAGE_FETCH_FAILURE", {
          message: error instanceof Error ? error.message : "Unknown usage fetch error",
        });
        return mutableUsage;
      } finally {
        usageRequestInFlight = null;
      }
    })();

    return usageRequestInFlight;
  },

  async identifyVehicle(imageUri: string, options?: { onStage?: IdentifyStageLogger; timeoutMs?: number; forceFreshRequest?: boolean }): Promise<ScanResult> {
    if (typeof imageUri !== "string" || imageUri.length === 0) {
      throw new Error("Image URI is missing.");
    }
    await offlineCanonicalService.preload();
    const accessToken = await authService.getAccessToken();
    const guestId = accessToken ? null : await guestSessionService.getGuestId();
    console.log("[scan-service] IDENTIFY_ENTITLEMENT_DECISION", {
      premiumRequested: false,
      signedIn: Boolean(accessToken),
      guestIdPresent: Boolean(guestId),
      freeUnlocksUsed: mutableUnlockStatus.freeUnlocksUsed,
      freeUnlocksRemaining: mutableUnlockStatus.freeUnlocksRemaining,
      decision: "basic_scan_allowed",
    });
    const identifyUrl = getIdentifyEndpointUrl();
    await assertUploadSize(imageUri);
    const usage = mutableUsage;
    const imageFingerprint = await getImageFingerprint(imageUri);
    if (imageFingerprint && options?.forceFreshRequest !== true) {
      const offlineScanCache = await readOfflineScanCache();
      const cachedScan = offlineScanCache[imageFingerprint];
      if (cachedScan) {
        console.log("[scan-service] OFFLINE_MATCH_HIT", {
          source: "local_scan_cache",
          imageFingerprint,
          scanId: cachedScan.id,
        });
        console.log("[scan-service] OFFLINE_RESULT_RENDERED", {
          source: "local_scan_cache",
          scanId: cachedScan.id,
        });
        const quickCached = {
          ...cachedScan,
          quickResult: true,
          quickResultSource: "local_scan_cache" as const,
        };
        await saveRecentScan(quickCached);
        return quickCached;
      }
    }
    console.log("[scan-service] OFFLINE_MATCH_MISS", {
      source: "local_scan_cache",
      imageFingerprintPresent: Boolean(imageFingerprint),
    });
    options?.onStage?.("form-data creation start", { imageUri });
    const fileInfo = await FileSystem.getInfoAsync(imageUri, { size: true });
    if (__DEV__) {
      console.log("[scan-service] preparing identify upload", {
        imageUri,
        fileExists: fileInfo.exists,
        fileSize: fileInfo.exists && typeof fileInfo.size === "number" ? fileInfo.size : null,
      });
    }

    const formData = new FormData();
    formData.append(
      "image",
      {
        uri: imageUri,
        name: getUploadFileName(imageUri),
        type: "image/jpeg",
      } as any,
    );
    options?.onStage?.("form-data creation end", {
      imageUri,
      fileSize: fileInfo.exists && typeof fileInfo.size === "number" ? fileInfo.size : null,
    });

    const healthUrl = `${getApiBaseUrlOrThrow()}/health`;
    const wakeStartedAt = Date.now();
    const wakeStartedAtIso = nowIso();
    options?.onStage?.("health wake-up start", { url: healthUrl, timeoutMs: BACKEND_WAKE_TIMEOUT_MS, startedAt: wakeStartedAtIso });
    try {
      await apiRequest<BackendHealthResponse>({
        path: "/health",
        authRequired: false,
        headers: guestId ? { "x-carscanr-guest-id": guestId } : undefined,
        timeoutMs: BACKEND_WAKE_TIMEOUT_MS,
      });
      const wakeElapsedMs = Date.now() - wakeStartedAt;
      options?.onStage?.("health wake-up success", { statusCode: 200, elapsedMs: wakeElapsedMs, endedAt: nowIso() });
    } catch (error) {
      const wakeElapsedMs = Date.now() - wakeStartedAt;
      options?.onStage?.("health wake-up failure", {
        message: error instanceof Error ? error.message : "Unknown health check error",
        elapsedMs: wakeElapsedMs,
        endedAt: nowIso(),
      });
      if (error instanceof ApiRequestError && error.code === "REQUEST_TIMEOUT") {
        throw new ApiRequestError("The backend took too long to wake up. Please try again.", {
          code: "BACKEND_WAKE_TIMEOUT",
          details: { timeoutMs: BACKEND_WAKE_TIMEOUT_MS, url: healthUrl },
        });
      }
      throw error;
    }

    const wakeElapsedMs = Date.now() - wakeStartedAt;
    const identifyTimeoutMs =
      wakeElapsedMs >= 15000
        ? Math.max(options?.timeoutMs ?? IDENTIFY_TIMEOUT_MS, IDENTIFY_TIMEOUT_MS_AFTER_SLOW_WAKE)
        : options?.timeoutMs ?? IDENTIFY_TIMEOUT_MS;
    const identifyStartedAt = Date.now();
    const identifyStartedAtIso = nowIso();
    options?.onStage?.("identify timeout start", {
      source: "post-health-success",
      startedAt: identifyStartedAtIso,
      timeoutMs: identifyTimeoutMs,
      wakeElapsedMs,
    });
    options?.onStage?.("request url", { url: identifyUrl });
    options?.onStage?.("request timeout", { timeoutMs: identifyTimeoutMs, source: "identify-fetch-only" });
    options?.onStage?.("identify request start", { url: identifyUrl, timeoutMs: identifyTimeoutMs, startedAt: identifyStartedAtIso });
    analyticsService.track("identify_request_sent", {
      scan_source: currentScanFlowSource,
      request_stage: "identify_request",
    });
    console.log("[scan-service] IDENTIFY_REQUEST_START", {
      url: identifyUrl,
      timeoutMs: identifyTimeoutMs,
      startedAt: identifyStartedAtIso,
    });
    let response;
    try {
      response = await apiRequestEnvelope<BackendScanResponse>({
        path: "/api/scan/identify",
        method: "POST",
        formData,
        authRequired: false,
        headers: guestId ? { "x-carscanr-guest-id": guestId } : undefined,
        timeoutMs: identifyTimeoutMs,
      });
    } catch (error) {
      analyticsService.track("identify_failed", {
        scan_source: currentScanFlowSource,
        request_stage: "identify_request",
        error_category: normalizeErrorCategory(error),
      });
      console.log("[scan-service] IDENTIFY_REQUEST_FAILURE", {
        message: error instanceof Error ? error.message : "Unknown identify request error",
        code: error instanceof ApiRequestError ? error.code : undefined,
        elapsedMs: Date.now() - identifyStartedAt,
      });
      options?.onStage?.("identify request failure", {
        message: error instanceof Error ? error.message : "Unknown identify request error",
        elapsedMs: Date.now() - identifyStartedAt,
        endedAt: nowIso(),
        timeoutMs: identifyTimeoutMs,
        code: error instanceof ApiRequestError ? error.code : undefined,
      });
      throw error;
    }
    options?.onStage?.("identify request success", {
      provider: response.meta?.provider,
      requestId: response.requestId,
      elapsedMs: Date.now() - identifyStartedAt,
      endedAt: nowIso(),
    });
    console.log("[scan-service] IDENTIFY_REQUEST_SUCCESS", {
      requestId: response.requestId,
      provider: response.meta?.provider,
      scanRuntimeVersion: response.meta?.scanRuntimeVersion,
      elapsedMs: Date.now() - identifyStartedAt,
    });
    analyticsService.track("identify_succeeded", {
      scan_source: currentScanFlowSource,
      request_stage: "identify_request",
      result_source: response.meta?.provider ? "provider" : "backend",
    });

    if (response.meta?.provider) {
      console.log("[scan-service] vision provider", response.meta.provider);
    }

    const result = mapScanResponse(response.data, imageUri, usage, response.meta ?? null);
    const offlineMatch = await offlineCanonicalService.matchCandidate({
      id: result.identifiedVehicle.id,
      year: result.identifiedVehicle.year,
      make: result.identifiedVehicle.make,
      model: result.identifiedVehicle.model,
      trim: result.identifiedVehicle.trim,
      vehicleType: result.detectedVehicleType,
    });
    const finalResult = offlineMatch
      ? {
          ...result,
          identifiedVehicle: {
            ...result.identifiedVehicle,
            id: offlineMatch.vehicle.id,
            thumbnailUrl: getVehicleImage(offlineMatch.vehicle.id, offlineMatch.vehicle.vehicleType),
          },
          candidates: result.candidates.map((candidate, index) =>
            index === 0
              ? {
                  ...candidate,
                  id: offlineMatch.vehicle.id,
                  thumbnailUrl: getVehicleImage(offlineMatch.vehicle.id, offlineMatch.vehicle.vehicleType),
                }
              : candidate,
          ),
          quickResult: true,
          quickResultSource: "offline_canonical" as const,
          offlineDatasetVersion: offlineMatch.datasetVersion,
        }
      : result;
    if (offlineMatch) {
      console.log("[scan-service] OFFLINE_MATCH_HIT", {
        source: "offline_canonical",
        matchType: offlineMatch.matchType,
        vehicleId: offlineMatch.vehicle.id,
        datasetVersion: offlineMatch.datasetVersion,
      });
      console.log("[scan-service] OFFLINE_RESULT_RENDERED", {
        source: "offline_canonical",
        vehicleId: offlineMatch.vehicle.id,
      });
    } else {
      console.log("[scan-service] OFFLINE_MATCH_MISS", {
        source: "offline_canonical",
        year: result.identifiedVehicle.year,
        make: result.identifiedVehicle.make,
        model: result.identifiedVehicle.model,
      });
    }
    console.log("[scan-service] SCAN_ALLOWED_BASIC_RESULT", {
      scanId: finalResult.id,
      candidateCount: finalResult.candidates.length,
      freeUnlocksRemaining: mutableUnlockStatus.freeUnlocksRemaining,
    });
    options?.onStage?.("parsed response", {
      scanId: finalResult.id,
      candidateCount: finalResult.candidates.length,
    });
    if (__DEV__) {
      console.log("[scan-service] identify success", {
        scanId: finalResult.id,
        imageUri: finalResult.imageUri,
        candidateCount: finalResult.candidates.length,
      });
    }
    if (imageFingerprint) {
      const cache = await readOfflineScanCache();
      cache[imageFingerprint] = finalResult;
      await writeOfflineScanCache(cache);
    }
    await saveRecentScan(finalResult);
    mutableUsage = await scanService.getUsage();
    return finalResult;
  },

  async identifyPremium(imageUri: string): Promise<{ result: ScanResult; entitlement?: BackendScanMeta["premium"] }> {
    if (typeof imageUri !== "string" || imageUri.length === 0) {
      throw new Error("Image URI is missing.");
    }
    if (!(await authService.getAccessToken())) {
      throw new Error("Sign in to unlock premium insights.");
    }
    await assertUploadSize(imageUri);
    const usage = await scanService.getUsage();
    const formData = new FormData();
    formData.append(
      "image",
      {
        uri: imageUri,
        name: getUploadFileName(imageUri),
        type: "image/jpeg",
      } as any,
    );

    const response = await apiRequestEnvelope<BackendScanResponse, BackendScanMeta>({
      path: "/api/scan/premium",
      method: "POST",
      formData,
    });

    if (response.meta?.provider) {
      console.log("[scan-service] premium vision provider", response.meta.provider);
    }

    const result = mapScanResponse(response.data, imageUri, usage, response.meta ?? null);
    await saveRecentScan(result);
    mutableUsage = await scanService.getUsage();
    return { result, entitlement: response.meta?.premium ?? null };
  },

  resetState() {
    mutableRecentScans = [];
    recentScansListeners.clear();
    mutableUsage = { ...defaultSubscriptionStatus };
    mutableUnlockStatus = {
      freeUnlocksTotal: FREE_PRO_UNLOCKS_TOTAL,
      freeUnlocksUsed: 0,
      freeUnlocksRemaining: FREE_PRO_UNLOCKS_TOTAL,
      unlockedVehicleCount: 0,
      unlockedVehicleIds: [],
    };
  },
};
