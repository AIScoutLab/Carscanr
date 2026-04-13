import { defaultSubscriptionStatus } from "@/constants/seedData";
import { getVehicleImage } from "@/constants/vehicleImages";
import { applyPlanOverride } from "@/features/subscription/planOverride";
import { getApiBaseUrlOrThrow } from "@/lib/env";
import { authService } from "@/services/authService";
import { guestSessionService } from "@/services/guestSessionService";
import { ApiRequestError, apiRequest, apiRequestEnvelope } from "@/services/apiClient";
import { ScanResult, SubscriptionStatus, VehicleCandidate } from "@/types";
import * as FileSystem from "expo-file-system";

let mutableRecentScans: ScanResult[] = [];
let mutableUsage: SubscriptionStatus = { ...defaultSubscriptionStatus };
let mutableUnlockStatus = {
  freeUnlocksTotal: 5,
  freeUnlocksUsed: 0,
  freeUnlocksRemaining: 5,
  unlockedVehicleCount: 0,
  unlockedVehicleIds: [] as string[],
};

const MAX_UPLOAD_BYTES = 4.8 * 1024 * 1024;
const BACKEND_WAKE_TIMEOUT_MS = 45000;
const IDENTIFY_TIMEOUT_MS = 60000;
const IDENTIFY_TIMEOUT_MS_AFTER_SLOW_WAKE = 90000;

type IdentifyStageLogger = (stage: string, payload?: unknown) => void;
type BackendHealthResponse = {
  status: string;
  environment: string;
  appEnv: string;
};

type BackendUsageResponse = {
  userId: string;
  plan: "free" | "pro";
  isPro: boolean;
  scansUsed: number;
  scansRemaining: number | null;
  limitType: "lifetime";
  limit: number;
  scansUsedToday: number;
  dailyScanLimit: number | null;
  scansRemainingToday: number | null;
  abuseWindowLimit: number;
  freeUnlocksTotal?: number;
  freeUnlocksUsed?: number;
  freeUnlocksRemaining?: number;
  unlockedVehicleCount?: number;
  unlockedVehicleIds?: string[];
};

type BackendScanCandidate = {
  vehicleId: string;
  year: number;
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
  detectedVehicleType: "car" | "motorcycle";
  confidence: number;
  createdAt: string;
  normalizedResult: {
    visible_clues: string[];
  };
  candidates: BackendScanCandidate[];
};

type BackendScanMeta = {
  provider?: string;
  topCandidateVehicleId?: string | null;
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

function safeNumber(value: unknown, fallback = 0) {
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

function mapUsage(usage: BackendUsageResponse): SubscriptionStatus {
  if (typeof usage.freeUnlocksTotal === "number") {
    mutableUnlockStatus = {
      freeUnlocksTotal: usage.freeUnlocksTotal ?? 5,
      freeUnlocksUsed: usage.freeUnlocksUsed ?? 0,
      freeUnlocksRemaining:
        usage.freeUnlocksRemaining ?? Math.max(0, (usage.freeUnlocksTotal ?? 5) - (usage.freeUnlocksUsed ?? 0)),
      unlockedVehicleCount: usage.unlockedVehicleCount ?? 0,
      unlockedVehicleIds: Array.isArray(usage.unlockedVehicleIds) ? usage.unlockedVehicleIds : mutableUnlockStatus.unlockedVehicleIds,
    };
  }
  return applyPlanOverride({
    plan: usage.plan,
    renewalLabel: usage.plan === "pro" ? "Pro active" : "Upgrade for unlimited scans",
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
  return {
    id: candidateId,
    year: safeNumber(candidate.year, 0),
    make: safeString(candidate.make, "Unknown"),
    model: safeString(candidate.model, "Vehicle"),
    trim: safeString(candidate.trim, ""),
    confidence: safeNumber(candidate.confidence, 0),
    thumbnailUrl: getVehicleImage(candidateId || "unknown-vehicle"),
  };
}

function normalizeBackendScanResponse(raw: BackendScanResponse): BackendScanResponse {
  return {
    id: safeString(raw?.id, `scan-${Date.now()}`),
    userId: safeString(raw?.userId, "unknown-user"),
    imageUrl: safeString(raw?.imageUrl, ""),
    detectedVehicleType: raw?.detectedVehicleType === "motorcycle" ? "motorcycle" : "car",
    confidence: safeNumber(raw?.confidence, 0),
    createdAt: safeString(raw?.createdAt, new Date().toISOString()),
    normalizedResult: {
      visible_clues: Array.isArray(raw?.normalizedResult?.visible_clues)
        ? raw.normalizedResult.visible_clues.filter((clue) => typeof clue === "string")
        : [],
    },
    candidates: Array.isArray(raw?.candidates)
      ? raw.candidates.map((candidate) => ({
          vehicleId: safeString(candidate?.vehicleId, ""),
          year: safeNumber(candidate?.year, 0),
          make: safeString(candidate?.make, "Unknown"),
          model: safeString(candidate?.model, "Vehicle"),
          trim: safeString(candidate?.trim, ""),
          confidence: safeNumber(candidate?.confidence, 0),
          matchReason: safeString(candidate?.matchReason, ""),
        }))
      : [],
  };
}

function mapScanResponse(scan: BackendScanResponse, imageUri: string, usage: SubscriptionStatus): ScanResult {
  const normalized = normalizeBackendScanResponse(scan);
  const candidates = normalized.candidates.map(mapCandidate);
  return {
    id: normalized.id,
    imageUri: safeString(imageUri, normalized.imageUrl),
    identifiedVehicle:
      candidates[0] ??
      ({
        id: "unknown-vehicle",
        year: 0,
        make: "Unknown",
        model: "Vehicle",
        confidence: normalized.confidence,
        thumbnailUrl: getVehicleImage("unknown-vehicle"),
      } satisfies VehicleCandidate),
    candidates,
    confidenceScore: normalized.confidence,
    limitedPreview: usage.plan === "free",
    scannedAt: normalized.createdAt,
  };
}

export const scanService = {
  async getRecentScans(): Promise<ScanResult[]> {
    return mutableRecentScans;
  },

  getCachedUnlockStatus() {
    return mutableUnlockStatus;
  },

  async getUsage(): Promise<SubscriptionStatus> {
    const token = await authService.getAccessToken();
    try {
      const guestId = token ? null : await guestSessionService.getGuestId();
      const usage = await apiRequest<BackendUsageResponse>({
        path: "/api/usage/today",
        authRequired: false,
        headers: guestId ? { "x-carscanr-guest-id": guestId } : undefined,
      });
      mutableUsage = mapUsage(usage);
      return mutableUsage;
    } catch {
      return mutableUsage;
    }
  },

  async identifyVehicle(imageUri: string, options?: { onStage?: IdentifyStageLogger; timeoutMs?: number }): Promise<ScanResult> {
    if (typeof imageUri !== "string" || imageUri.length === 0) {
      throw new Error("Image URI is missing.");
    }
    const accessToken = await authService.getAccessToken();
    const guestId = accessToken ? null : await guestSessionService.getGuestId();
    const identifyUrl = getIdentifyEndpointUrl();
    await assertUploadSize(imageUri);
    const usage = mutableUsage;
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

    if (response.meta?.provider) {
      console.log("[scan-service] vision provider", response.meta.provider);
    }

    const result = mapScanResponse(response.data, imageUri, usage);
    options?.onStage?.("parsed response", {
      scanId: result.id,
      candidateCount: result.candidates.length,
    });
    if (__DEV__) {
      console.log("[scan-service] identify success", {
        scanId: result.id,
        imageUri: result.imageUri,
        candidateCount: result.candidates.length,
      });
    }
    mutableRecentScans = [result, ...mutableRecentScans.filter((entry) => entry.id !== result.id)].slice(0, 6);
    mutableUsage = await scanService.getUsage();
    return result;
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

    const result = mapScanResponse(response.data, imageUri, usage);
    mutableRecentScans = [result, ...mutableRecentScans.filter((entry) => entry.id !== result.id)].slice(0, 6);
    mutableUsage = await scanService.getUsage();
    return { result, entitlement: response.meta?.premium ?? null };
  },

  resetState() {
    mutableRecentScans = [];
    mutableUsage = { ...defaultSubscriptionStatus };
    mutableUnlockStatus = {
      freeUnlocksTotal: 5,
      freeUnlocksUsed: 0,
      freeUnlocksRemaining: 5,
      unlockedVehicleCount: 0,
      unlockedVehicleIds: [],
    };
  },
};
