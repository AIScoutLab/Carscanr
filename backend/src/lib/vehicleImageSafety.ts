import { env } from "../config/env.js";
import { CanonicalVehicleImageSafetyStatus, CanonicalVehicleImageSource, CanonicalVehicleImageStatus } from "../types/domain.js";

type VehicleImageSafetyDecision = {
  status: CanonicalVehicleImageStatus;
  safetyStatus: CanonicalVehicleImageSafetyStatus;
  reason: string;
};

type VehicleImageSafetyInput = {
  source: CanonicalVehicleImageSource;
  confidence: number;
  badgeConflict: boolean;
  width?: number | null;
  height?: number | null;
  clusterScanCount: number;
  clusterUniqueUserCount: number;
};

function hasReasonableDimensions(width?: number | null, height?: number | null) {
  if (!width || !height) return false;
  if (width < 480 || height < 320) return false;
  const ratio = width / height;
  return ratio >= 0.75 && ratio <= 2.4;
}

export function computeVehicleImageQualityScore(input: {
  source: CanonicalVehicleImageSource;
  confidence: number;
  badgeConflict: boolean;
  width?: number | null;
  height?: number | null;
  clusterScanCount: number;
  clusterUniqueUserCount: number;
  hasScannedImageSource?: boolean;
  badgeTextMatched?: boolean;
  blurryOrZoomWarning?: boolean;
}): number {
  let score = 0;
  if (input.hasScannedImageSource || input.source === "user_scan") score += 20;
  if (input.confidence >= 0.9) score += 20;
  if (input.badgeTextMatched) score += 15;
  if (input.clusterScanCount >= 3) score += 15;
  if (input.clusterUniqueUserCount >= 2) score += 10;
  if (hasReasonableDimensions(input.width, input.height)) score += 10;
  if ((input.width ?? 0) < 480 || (input.height ?? 0) < 320) score -= 25;
  if (input.blurryOrZoomWarning) score -= 25;
  if (input.badgeConflict) score -= 50;
  return Math.max(0, Math.min(100, score));
}

export function shouldAutoApproveVehicleImage(input: VehicleImageSafetyInput): VehicleImageSafetyDecision {
  if (!(input.source === "user_scan" || input.source === "curated")) {
    return { status: "quarantined", safetyStatus: "failed", reason: "unsupported-source" };
  }
  if (input.badgeConflict) {
    return { status: "quarantined", safetyStatus: "failed", reason: "badge-conflict" };
  }
  if (!hasReasonableDimensions(input.width, input.height)) {
    return { status: "pending", safetyStatus: "manual_review", reason: "dimensions-too-weak" };
  }
  if (input.confidence < 0.9) {
    return { status: "pending", safetyStatus: "manual_review", reason: "confidence-below-threshold" };
  }
  if (!(input.clusterScanCount >= 3 || input.clusterUniqueUserCount >= 2)) {
    return { status: "pending", safetyStatus: "manual_review", reason: "insufficient-cluster-consensus" };
  }
  if (input.source === "user_scan" && !env.ENABLE_USER_IMAGE_AUTO_APPROVAL) {
    return { status: "pending", safetyStatus: "unreviewed", reason: "user-auto-approval-disabled" };
  }
  return { status: "approved", safetyStatus: "passed", reason: "auto-approval-threshold-met" };
}
