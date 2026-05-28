import crypto from "node:crypto";
import { AppError } from "../errors/appError.js";
import { buildCanonicalKey } from "../lib/providerCache.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { logger } from "../lib/logger.js";
import {
  CanonicalVehicleImageRecord,
  MatchedVehicleCandidate,
  VehiclePhotoClusterRecord,
  VisionResult,
} from "../types/domain.js";
import {
  classifyPhotoHashMatch,
  getPhotoHashSimilarity,
  hasVehicleIdentityConflict,
  hammingDistance,
  isStrongPhotoClusterMatch,
  normalizeVisualHash,
  normalizeVehicleIdentity,
} from "../lib/photoClusterHash.js";
import { computeVehicleImageQualityScore, shouldAutoApproveVehicleImage } from "../lib/vehicleImageSafety.js";

type RecordScanPhotoClusterInput = {
  scanId: string;
  userId?: string | null;
  imageKey?: string | null;
  imageUrl?: string | null;
  visualHash?: string | null;
  width?: number | null;
  height?: number | null;
  normalizedResult: VisionResult;
  selectedVehicle?: MatchedVehicleCandidate | null;
};

type PhotoClusterHint = {
  clusterId: string;
  canonicalKey: string;
  canonicalVehicleId?: string | null;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  confidence: number;
};

function hashPrefix(hash: string) {
  return hash.slice(0, 12);
}

function buildIdentityFromNormalizedResult(normalizedResult: VisionResult) {
  const normalized = normalizeVehicleIdentity({
    make: normalizedResult.likely_make,
    model: normalizedResult.likely_model,
    trim: normalizedResult.likely_trim,
  });
  return {
    year: normalizedResult.likely_year,
    make: normalizedResult.likely_make,
    model: normalizedResult.likely_model,
    trim: normalizedResult.likely_trim ?? null,
    badge: normalizedResult.likely_trim ?? normalizedResult.visible_badge_text ?? null,
    normalizedMake: normalized.make,
    normalizedModel: normalized.model,
    normalizedTrim: normalized.badge,
  };
}

function buildCanonicalIdentityFromCandidate(candidate: MatchedVehicleCandidate) {
  const normalized = normalizeVehicleIdentity({
    make: candidate.make,
    model: candidate.model,
    trim: candidate.trim,
  });
  return {
    canonicalVehicleId: candidate.vehicleId,
    canonicalKey: buildCanonicalKey({
      year: candidate.year,
      make: candidate.make,
      model: candidate.model,
      trim: candidate.trim,
    }),
    year: candidate.year,
    make: candidate.make,
    model: candidate.model,
    trim: candidate.trim ?? null,
    badge: candidate.trim ?? null,
    normalizedMake: normalized.make,
    normalizedModel: normalized.model,
    normalizedTrim: normalized.badge,
  };
}

function shouldSaveCanonicalImageCandidate(input: {
  imageUrl?: string | null;
  selectedVehicle?: MatchedVehicleCandidate | null;
  normalizedResult: VisionResult;
}) {
  const hasUrl = typeof input.imageUrl === "string" && input.imageUrl.trim().length > 0;
  return hasUrl && (Boolean(input.selectedVehicle?.vehicleId) || input.normalizedResult.confidence >= 0.85);
}

function shouldAdoptPossibleSimilar(distance: number, cluster: VehiclePhotoClusterRecord, normalizedResult: VisionResult) {
  if (distance > 10) return false;
  const normalized = normalizeVehicleIdentity({
    make: normalizedResult.likely_make,
    model: normalizedResult.likely_model,
  });
  const resultMake = normalized.make;
  const resultModel = normalized.model;
  return Boolean(
    cluster.normalizedMake &&
      cluster.normalizedModel &&
      cluster.normalizedMake === resultMake &&
      cluster.normalizedModel === resultModel,
  );
}

function getMatchStrengthLabel(matchStrength: "exact" | "strong" | "possible" | "none") {
  return matchStrength === "none" ? "rejected" : matchStrength;
}

function isMissingPhotoClusterRelationError(error: unknown) {
  if (!(error instanceof AppError) || error.code !== "SUPABASE_QUERY_FAILED") {
    return false;
  }
  const details = error.details as { code?: string; message?: string } | undefined;
  return (
    details?.code === "PGRST205" &&
    typeof details.message === "string" &&
    (details.message.includes("public.vehicle_photo_clusters") ||
      details.message.includes("public.vehicle_photo_cluster_members"))
  );
}

function hasHintConflict(normalizedResult: VisionResult, hint: PhotoClusterHint) {
  return hasVehicleIdentityConflict(
    {
      make: normalizedResult.visible_make_text ?? normalizedResult.likely_make,
      model: normalizedResult.visible_model_text ?? normalizedResult.likely_model,
      badge: normalizedResult.visible_badge_text ?? normalizedResult.visible_trim_text ?? normalizedResult.likely_trim,
    },
    {
      make: hint.make,
      model: hint.model,
      badge: hint.trim,
    },
  );
}

function hasBadgeConflict(
  normalizedResult: VisionResult,
  identity: {
    make?: string | null;
    model?: string | null;
    trim?: string | null;
    badge?: string | null;
  },
) {
  return hasVehicleIdentityConflict(
    {
      make: normalizedResult.visible_make_text ?? normalizedResult.likely_make,
      model: normalizedResult.visible_model_text ?? normalizedResult.likely_model,
      badge: normalizedResult.visible_badge_text ?? normalizedResult.visible_trim_text ?? normalizedResult.likely_trim,
    },
    {
      make: identity.make,
      model: identity.model,
      badge: identity.badge ?? identity.trim,
    },
  );
}

export class PhotoClusterService {
  // TODO(v2): move candidate narrowing into SQL-side Hamming/prefix filtering once volume grows.
  // TODO(v2): evaluate prefix hashing / LSH-style indexes before adding pgvector embeddings.
  // TODO(v2): support multi-angle matching, cluster split/merge workflows, and debug inspection tools.
  async findCanonicalIdentityHint(input: {
    scanId: string;
    visualHash?: string | null;
    normalizedResult: VisionResult;
  }): Promise<PhotoClusterHint | null> {
    const normalizedHash = normalizeVisualHash(input.visualHash ?? "");
    if (!normalizedHash) {
      logger.info({ label: "PHOTO_CLUSTER_SKIPPED", scanId: input.scanId, reason: "missing_visual_hash", phase: "hint_lookup" }, "PHOTO_CLUSTER_SKIPPED");
      return null;
    }

    const identity = buildIdentityFromNormalizedResult(input.normalizedResult);
    let candidates: VehiclePhotoClusterRecord[] = [];
    try {
      candidates = await repositories.vehiclePhotoClusters.findRecentCandidates({
        normalizedMake: identity.normalizedMake || null,
        normalizedModel: identity.normalizedModel || null,
        normalizedTrim: identity.normalizedTrim || null,
        limit: 20,
      });
    } catch (error) {
      if (isMissingPhotoClusterRelationError(error)) {
        logger.warn(
          {
            label: "PHOTO_CLUSTER_FEATURE_DISABLED_MISSING_TABLE",
            scanId: input.scanId,
            phase: "hint_lookup",
            reason: "missing-supabase-photo-cluster-table",
          },
          "PHOTO_CLUSTER_FEATURE_DISABLED_MISSING_TABLE",
        );
        return null;
      }
      throw error;
    }
    logger.info(
      {
        label: "PHOTO_CLUSTER_LOOKUP_START",
        scanId: input.scanId,
        phase: "hint_lookup",
        hashPrefix: hashPrefix(normalizedHash),
        candidateCount: candidates.length,
        year: identity.year,
        make: identity.make,
        model: identity.model,
        trim: identity.trim,
      },
      "PHOTO_CLUSTER_LOOKUP_START",
    );

    for (const cluster of candidates) {
      const distance = hammingDistance(normalizedHash, cluster.representativeVisualHash);
      const similarity = getPhotoHashSimilarity(normalizedHash, cluster.representativeVisualHash);
      const matchStrength = classifyPhotoHashMatch({
        sourceHash: normalizedHash,
        targetHash: cluster.representativeVisualHash,
        sourceIdentity: identity,
        targetIdentity: cluster,
      });
      logger.info(
        {
          label: "PHOTO_CLUSTER_CANDIDATE_FOUND",
          scanId: input.scanId,
          hashPrefix: hashPrefix(normalizedHash),
          clusterId: cluster.id,
          clusterKey: cluster.clusterKey,
          canonicalKey: cluster.canonicalKey ?? null,
          distance,
          similarity,
          matchStrength: getMatchStrengthLabel(matchStrength),
        },
        "PHOTO_CLUSTER_CANDIDATE_FOUND",
      );
      if (!cluster.canonicalKey || cluster.year == null || !cluster.make || !cluster.model) continue;
      if (!isStrongPhotoClusterMatch(normalizedHash, cluster.representativeVisualHash)) continue;
      const hint: PhotoClusterHint = {
        clusterId: cluster.id,
        canonicalKey: cluster.canonicalKey,
        canonicalVehicleId: cluster.canonicalVehicleId ?? null,
        year: cluster.year,
        make: cluster.make,
        model: cluster.model,
        trim: cluster.trim ?? null,
        confidence: Math.max(cluster.confidence, similarity),
      };
      if (hasHintConflict(input.normalizedResult, hint)) {
        logger.info(
          {
            label: "PHOTO_CLUSTER_HINT_REJECTED_BADGE_CONFLICT",
            scanId: input.scanId,
            clusterId: cluster.id,
            canonicalKey: cluster.canonicalKey,
            normalizedSourceIdentity: normalizeVehicleIdentity({
              make: input.normalizedResult.visible_make_text ?? input.normalizedResult.likely_make,
              model: input.normalizedResult.visible_model_text ?? input.normalizedResult.likely_model,
              badge: input.normalizedResult.visible_badge_text ?? input.normalizedResult.visible_trim_text ?? input.normalizedResult.likely_trim,
            }),
            normalizedHintIdentity: normalizeVehicleIdentity({
              make: hint.make,
              model: hint.model,
              badge: hint.trim,
            }),
          },
          "PHOTO_CLUSTER_HINT_REJECTED_BADGE_CONFLICT",
        );
        return null;
      }
      logger.info(
        {
          label: "PHOTO_CLUSTER_IDENTITY_HINT_USED",
          scanId: input.scanId,
          clusterId: cluster.id,
          canonicalKey: cluster.canonicalKey,
          year: cluster.year,
          make: cluster.make,
          model: cluster.model,
          trim: cluster.trim ?? null,
          similarity,
          matchStrength,
        },
        "PHOTO_CLUSTER_IDENTITY_HINT_USED",
      );
      return hint;
    }

    return null;
  }

  async recordScanPhotoCluster(input: RecordScanPhotoClusterInput): Promise<void> {
    const normalizedHash = normalizeVisualHash(input.visualHash ?? "");
    if (!normalizedHash) {
      logger.info({ label: "PHOTO_CLUSTER_SKIPPED", scanId: input.scanId, reason: "missing_visual_hash", phase: "record" }, "PHOTO_CLUSTER_SKIPPED");
      return;
    }

    const identity = buildIdentityFromNormalizedResult(input.normalizedResult);
    let candidates: VehiclePhotoClusterRecord[] = [];
    try {
      candidates = await repositories.vehiclePhotoClusters.findRecentCandidates({
        normalizedMake: identity.normalizedMake || null,
        normalizedModel: identity.normalizedModel || null,
        normalizedTrim: identity.normalizedTrim || null,
        limit: 25,
      });
    } catch (error) {
      if (isMissingPhotoClusterRelationError(error)) {
        logger.warn(
          {
            label: "PHOTO_CLUSTER_FEATURE_DISABLED_MISSING_TABLE",
            scanId: input.scanId,
            phase: "record",
            reason: "missing-supabase-photo-cluster-table",
          },
          "PHOTO_CLUSTER_FEATURE_DISABLED_MISSING_TABLE",
        );
        return;
      }
      throw error;
    }
    logger.info(
      {
        label: "PHOTO_CLUSTER_LOOKUP_START",
        scanId: input.scanId,
        phase: "record",
        hashPrefix: hashPrefix(normalizedHash),
        candidateCount: candidates.length,
        year: identity.year,
        make: identity.make,
        model: identity.model,
        trim: identity.trim,
      },
      "PHOTO_CLUSTER_LOOKUP_START",
    );

    let targetCluster: VehiclePhotoClusterRecord | null = null;
    let targetMatchStrength: "exact" | "strong" | "possible" = "exact";
    let targetDistance = 0;

    for (const cluster of candidates) {
      const distance = hammingDistance(normalizedHash, cluster.representativeVisualHash);
      const similarity = getPhotoHashSimilarity(normalizedHash, cluster.representativeVisualHash);
      const matchStrength = classifyPhotoHashMatch({
        sourceHash: normalizedHash,
        targetHash: cluster.representativeVisualHash,
        sourceIdentity: identity,
        targetIdentity: cluster,
      });
      logger.info(
        {
          label: "PHOTO_CLUSTER_CANDIDATE_FOUND",
          scanId: input.scanId,
          hashPrefix: hashPrefix(normalizedHash),
          clusterId: cluster.id,
          clusterKey: cluster.clusterKey,
          distance,
          similarity,
          matchStrength: getMatchStrengthLabel(matchStrength),
        },
        "PHOTO_CLUSTER_CANDIDATE_FOUND",
      );
      if (matchStrength === "exact" || matchStrength === "strong") {
        targetCluster = cluster;
        targetMatchStrength = matchStrength;
        targetDistance = distance;
        logger.info(
          {
            label: "PHOTO_CLUSTER_MATCH_CONFIRMED",
            scanId: input.scanId,
            clusterId: cluster.id,
            clusterKey: cluster.clusterKey,
            matchStrength,
            distance,
            similarity,
          },
          "PHOTO_CLUSTER_MATCH_CONFIRMED",
        );
        break;
      }
      if (matchStrength === "possible" && shouldAdoptPossibleSimilar(distance, cluster, input.normalizedResult)) {
        targetCluster = cluster;
        targetMatchStrength = "possible";
        targetDistance = distance;
        logger.info(
          {
            label: "PHOTO_CLUSTER_MATCH_CONFIRMED",
            scanId: input.scanId,
            clusterId: cluster.id,
            clusterKey: cluster.clusterKey,
            matchStrength: "possible",
            distance,
            similarity,
          },
          "PHOTO_CLUSTER_MATCH_CONFIRMED",
        );
        break;
      }
      logger.info(
        {
          label: "PHOTO_CLUSTER_MATCH_REJECTED",
          scanId: input.scanId,
          clusterId: cluster.id,
          clusterKey: cluster.clusterKey,
          reason: matchStrength === "none" ? "threshold_or_identity_mismatch" : "possible_without_identity_agreement",
          distance,
          similarity,
          normalizedSourceIdentity: normalizeVehicleIdentity(identity),
          normalizedCandidateIdentity: normalizeVehicleIdentity(cluster),
        },
        "PHOTO_CLUSTER_MATCH_REJECTED",
      );
    }

    const now = new Date().toISOString();
    if (!targetCluster) {
      targetCluster = await repositories.vehiclePhotoClusters.createCluster({
        id: crypto.randomUUID(),
        clusterKey: `phc_${crypto.randomUUID()}`,
        representativeVisualHash: normalizedHash,
        canonicalVehicleId: null,
        canonicalKey: null,
        year: identity.year,
        make: identity.make,
        model: identity.model,
        trim: identity.trim,
        normalizedMake: identity.normalizedMake || null,
        normalizedModel: identity.normalizedModel || null,
        normalizedTrim: identity.normalizedTrim || null,
        canonicalScanId: input.scanId,
        canonicalPhotoHash: normalizedHash,
        canonicalMake: identity.make,
        canonicalModel: identity.model,
        canonicalBadge: identity.badge,
        canonicalYear: identity.year,
        canonicalMatchStrength: "exact",
        canonicalHammingDistance: 0,
        memberCount: 0,
        scanCount: 0,
        uniqueUserCount: 0,
        confidence: input.normalizedResult.confidence,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
      logger.info(
        {
          label: "PHOTO_CLUSTER_CREATED",
          scanId: input.scanId,
          clusterId: targetCluster.id,
          clusterKey: targetCluster.clusterKey,
          matchStrength: "exact",
        },
        "PHOTO_CLUSTER_CREATED",
      );
    }

    const existingMembership = await repositories.vehiclePhotoClusters.findMemberByClusterAndScan({
      clusterId: targetCluster.id,
      scanId: input.scanId,
    });
    const priorContribution = input.userId
      ? await repositories.vehiclePhotoClusters.findUserContribution({
          clusterId: targetCluster.id,
          userId: input.userId,
        })
      : null;

    await repositories.vehiclePhotoClusters.addMember({
      id: crypto.randomUUID(),
      clusterId: targetCluster.id,
      scanId: input.scanId,
      userId: input.userId ?? null,
      visualHash: normalizedHash,
      imageKey: input.imageKey ?? null,
      imageWidth: input.width ?? null,
      imageHeight: input.height ?? null,
      year: identity.year,
      make: identity.make,
      model: identity.model,
      badge: identity.badge,
      trim: identity.trim,
      hammingDistance: targetDistance,
      matchStrength: targetMatchStrength,
      confidence: input.normalizedResult.confidence,
      createdAt: now,
    });

    if (!existingMembership) {
      targetCluster =
        (await repositories.vehiclePhotoClusters.incrementClusterStats({
          clusterId: targetCluster.id,
          memberCountDelta: 1,
          scanCountDelta: 1,
          uniqueUserCountDelta: input.userId && !priorContribution ? 1 : 0,
          lastSeenAt: now,
        })) ?? targetCluster;
    }
    logger.info(
      {
        label: "PHOTO_CLUSTER_MEMBER_ADDED",
        scanId: input.scanId,
        clusterId: targetCluster.id,
        userId: input.userId ?? null,
        matchStrength: targetMatchStrength,
      },
      "PHOTO_CLUSTER_MEMBER_ADDED",
    );

    await this.captureCanonicalImageCandidate({
      input,
      targetCluster,
      identity,
      now,
    });

    const shouldUpdateCanonicalIdentity =
      Boolean(input.selectedVehicle?.vehicleId) || input.normalizedResult.confidence >= 0.85;
    if (!shouldUpdateCanonicalIdentity) return;

    const canonicalIdentity = input.selectedVehicle
      ? buildCanonicalIdentityFromCandidate(input.selectedVehicle)
      : {
          canonicalVehicleId: null,
          canonicalKey: buildCanonicalKey({
            year: identity.year,
            make: identity.make,
            model: identity.model,
            trim: identity.trim ?? undefined,
          }),
          year: identity.year,
          make: identity.make,
          model: identity.model,
          trim: identity.trim,
          badge: identity.badge,
          normalizedMake: identity.normalizedMake || null,
          normalizedModel: identity.normalizedModel || null,
          normalizedTrim: identity.normalizedTrim || null,
        };

    await repositories.vehiclePhotoClusters.updateCanonicalIdentity({
      clusterId: targetCluster.id,
      canonicalVehicleId: canonicalIdentity.canonicalVehicleId ?? null,
      canonicalKey: canonicalIdentity.canonicalKey,
      canonicalScanId: input.scanId,
      canonicalPhotoHash: normalizedHash,
      canonicalMake: canonicalIdentity.make,
      canonicalModel: canonicalIdentity.model,
      canonicalBadge: canonicalIdentity.badge ?? canonicalIdentity.trim ?? null,
      canonicalYear: canonicalIdentity.year,
      year: canonicalIdentity.year,
      make: canonicalIdentity.make,
      model: canonicalIdentity.model,
      trim: canonicalIdentity.trim,
      normalizedMake: canonicalIdentity.normalizedMake,
      normalizedModel: canonicalIdentity.normalizedModel,
      normalizedTrim: canonicalIdentity.normalizedTrim,
      matchStrength: targetMatchStrength,
      hammingDistance: targetDistance,
      confidence: Math.max(targetCluster.confidence, input.normalizedResult.confidence),
      representativeVisualHash: normalizedHash,
      lastSeenAt: now,
    });
    logger.info(
      {
        label: "PHOTO_CLUSTER_CANONICAL_UPDATED",
        scanId: input.scanId,
        clusterId: targetCluster.id,
        canonicalKey: canonicalIdentity.canonicalKey,
      },
      "PHOTO_CLUSTER_CANONICAL_UPDATED",
    );
  }

  private async captureCanonicalImageCandidate(context: {
    input: RecordScanPhotoClusterInput;
    targetCluster: VehiclePhotoClusterRecord;
    identity: ReturnType<typeof buildIdentityFromNormalizedResult>;
    now: string;
  }) {
    const { input, targetCluster, identity, now } = context;
    if (!shouldSaveCanonicalImageCandidate({ imageUrl: input.imageUrl, selectedVehicle: input.selectedVehicle, normalizedResult: input.normalizedResult })) {
      return;
    }

    const canonicalIdentity = input.selectedVehicle
      ? buildCanonicalIdentityFromCandidate(input.selectedVehicle)
      : {
          canonicalVehicleId: null,
          canonicalKey: buildCanonicalKey({
            year: identity.year,
            make: identity.make,
            model: identity.model,
            trim: identity.trim ?? undefined,
          }),
          year: identity.year,
          make: identity.make,
          model: identity.model,
          trim: identity.trim,
          badge: identity.badge,
          normalizedMake: identity.normalizedMake || null,
          normalizedModel: identity.normalizedModel || null,
          normalizedTrim: identity.normalizedTrim || null,
        };

    const badgeConflict = hasBadgeConflict(input.normalizedResult, {
      // This remains scan-local evidence only; pending user images are never shared cross-user without approval.
      make: canonicalIdentity.make,
      model: canonicalIdentity.model,
      badge: canonicalIdentity.badge,
      trim: canonicalIdentity.trim,
    });

    const qualityScore = computeVehicleImageQualityScore({
      source: "user_scan",
      confidence: input.normalizedResult.confidence,
      badgeConflict,
      width: input.width ?? null,
      height: input.height ?? null,
      clusterScanCount: targetCluster.scanCount,
      clusterUniqueUserCount: targetCluster.uniqueUserCount,
      hasScannedImageSource: true,
      badgeTextMatched: !badgeConflict && Boolean(input.normalizedResult.visible_badge_text || input.normalizedResult.visible_model_text || input.normalizedResult.visible_make_text),
      blurryOrZoomWarning: false,
    });

    const safetyDecision = shouldAutoApproveVehicleImage({
      source: "user_scan",
      confidence: input.normalizedResult.confidence,
      badgeConflict,
      width: input.width ?? null,
      height: input.height ?? null,
      clusterScanCount: targetCluster.scanCount,
      clusterUniqueUserCount: targetCluster.uniqueUserCount,
    });

    const candidateRecord: CanonicalVehicleImageRecord = {
      id: crypto.randomUUID(),
      canonicalKey: canonicalIdentity.canonicalKey,
      canonicalVehicleId: canonicalIdentity.canonicalVehicleId ?? null,
      year: canonicalIdentity.year,
      make: canonicalIdentity.make,
      model: canonicalIdentity.model,
      trim: canonicalIdentity.trim,
      normalizedMake: canonicalIdentity.normalizedMake,
      normalizedModel: canonicalIdentity.normalizedModel,
      normalizedTrim: canonicalIdentity.normalizedTrim,
      imageUrl: input.imageUrl!.trim(),
      imageKey: input.imageKey ?? null,
      source: "user_scan",
      status: safetyDecision.status,
      safetyStatus: safetyDecision.safetyStatus,
      qualityScore,
      isPrimary: false,
      scanCount: targetCluster.scanCount,
      uniqueUserCount: targetCluster.uniqueUserCount,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const savedCandidate = await repositories.canonicalVehicleImages.upsertCandidateImage(candidateRecord);
    logger.info(
      {
        label: "CANONICAL_IMAGE_CANDIDATE_SAVED",
        scanId: input.scanId,
        imageId: savedCandidate.id,
        canonicalKey: savedCandidate.canonicalKey,
        qualityScore,
      },
      "CANONICAL_IMAGE_CANDIDATE_SAVED",
    );

    if (safetyDecision.status === "approved" && safetyDecision.safetyStatus === "passed") {
      const existingPrimary = await repositories.canonicalVehicleImages.findApprovedPrimaryByCanonicalKey(savedCandidate.canonicalKey);
      if (!existingPrimary || savedCandidate.qualityScore > existingPrimary.qualityScore) {
        await repositories.canonicalVehicleImages.markApprovedPrimary({
          canonicalKey: savedCandidate.canonicalKey,
          imageId: savedCandidate.id,
        });
      }
      logger.info(
        {
          label: "CANONICAL_IMAGE_AUTO_APPROVED",
          scanId: input.scanId,
          imageId: savedCandidate.id,
          canonicalKey: savedCandidate.canonicalKey,
          reason: safetyDecision.reason,
        },
        "CANONICAL_IMAGE_AUTO_APPROVED",
      );
      return;
    }

    if (safetyDecision.status === "quarantined") {
      await repositories.canonicalVehicleImages.rejectOrQuarantine({
        imageId: savedCandidate.id,
        status: "quarantined",
        safetyStatus:
          safetyDecision.safetyStatus === "failed" ? "failed" : "manual_review",
      });
      logger.info(
        {
          label: "CANONICAL_IMAGE_QUARANTINED",
          scanId: input.scanId,
          imageId: savedCandidate.id,
          canonicalKey: savedCandidate.canonicalKey,
          reason: safetyDecision.reason,
        },
        "CANONICAL_IMAGE_QUARANTINED",
      );
      return;
    }

    logger.info(
      {
        label: "CANONICAL_IMAGE_PENDING_REVIEW",
        scanId: input.scanId,
        imageId: savedCandidate.id,
        canonicalKey: savedCandidate.canonicalKey,
        reason: safetyDecision.reason,
      },
      "CANONICAL_IMAGE_PENDING_REVIEW",
    );
  }
}

export const photoClusterService = new PhotoClusterService();
