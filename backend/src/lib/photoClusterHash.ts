const HASH_HEX_RE = /^[0-9a-f]+$/i;
const SPECIFIC_BADGE_RE = /[a-z0-9]/i;

export type NormalizedVehicleIdentity = {
  make: string;
  model: string;
  badge: string;
};

export type PhotoHashMatchStrength = "exact" | "strong" | "possible" | "none";

export function normalizeVehicleText(value?: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVehicleModel(value?: string | null): string {
  return normalizeVehicleText(value)
    .replace(/\bhybrid\b/g, "")
    .replace(/\bseries\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeVehicleIdentity(input: {
  make?: string | null;
  model?: string | null;
  badge?: string | null;
  trim?: string | null;
}): NormalizedVehicleIdentity {
  return {
    make: normalizeVehicleText(input.make),
    model: normalizeVehicleModel(input.model),
    badge: normalizeVehicleText(input.badge ?? input.trim),
  };
}

export function normalizeVisualHash(hash: string): string {
  return (hash ?? "").trim().toLowerCase();
}

export function hammingDistance(a: string, b: string): number {
  const left = normalizeVisualHash(a);
  const right = normalizeVisualHash(b);
  if (!left || !right || left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }
  if (!HASH_HEX_RE.test(left) || !HASH_HEX_RE.test(right)) {
    return Number.POSITIVE_INFINITY;
  }

  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const xor = Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16);
    distance += xor.toString(2).split("1").length - 1;
  }
  return distance;
}

export function getPhotoHashSimilarity(a: string, b: string): number {
  const normalizedA = normalizeVisualHash(a);
  const normalizedB = normalizeVisualHash(b);
  const distance = hammingDistance(normalizedA, normalizedB);
  if (!Number.isFinite(distance)) return 0;
  const maxDistance = Math.max(normalizedA.length, normalizedB.length) * 4;
  if (!maxDistance) return 0;
  return Math.max(0, 1 - distance / maxDistance);
}

export function hasVehicleIdentityConflict(
  left: {
    make?: string | null;
    model?: string | null;
    badge?: string | null;
    trim?: string | null;
  },
  right: {
    make?: string | null;
    model?: string | null;
    badge?: string | null;
    trim?: string | null;
  },
): boolean {
  const normalizedLeft = normalizeVehicleIdentity(left);
  const normalizedRight = normalizeVehicleIdentity(right);

  if (normalizedLeft.make && normalizedRight.make && normalizedLeft.make !== normalizedRight.make) return true;
  if (normalizedLeft.model && normalizedRight.model && normalizedLeft.model !== normalizedRight.model) return true;

  const leftBadge = normalizedLeft.badge;
  const rightBadge = normalizedRight.badge;
  if (!leftBadge || !rightBadge) return false;
  if (!SPECIFIC_BADGE_RE.test(leftBadge) || !SPECIFIC_BADGE_RE.test(rightBadge)) return false;
  return leftBadge !== rightBadge;
}

export function classifyPhotoHashMatch(input: {
  sourceHash: string;
  targetHash: string;
  sourceIdentity?: {
    make?: string | null;
    model?: string | null;
    badge?: string | null;
    trim?: string | null;
  } | null;
  targetIdentity?: {
    make?: string | null;
    model?: string | null;
    badge?: string | null;
    trim?: string | null;
  } | null;
}): PhotoHashMatchStrength {
  const distance = hammingDistance(input.sourceHash, input.targetHash);
  if (!Number.isFinite(distance)) return "none";
  if (distance === 0) return "exact";
  if (distance <= 6) return "strong";
  if (distance <= 10) {
    const left = normalizeVehicleIdentity(input.sourceIdentity ?? {});
    const right = normalizeVehicleIdentity(input.targetIdentity ?? {});
    if (left.make && right.make && left.model && right.model && left.make === right.make && left.model === right.model) {
      return "possible";
    }
  }
  return "none";
}

export function isStrongPhotoClusterMatch(a: string, b: string): boolean {
  const strength = classifyPhotoHashMatch({ sourceHash: a, targetHash: b });
  return strength === "exact" || strength === "strong";
}

export function hammingDistanceHex(a: string, b: string): number {
  return hammingDistance(a, b);
}

export function visualHashSimilarity(a: string, b: string): number {
  return getPhotoHashSimilarity(a, b);
}

export function isSimilarVehiclePhotoHash(a: string, b: string): boolean {
  return isStrongPhotoClusterMatch(a, b);
}
