export type RawBuildInfo = {
  gitCommit?: unknown;
  buildTimestamp?: unknown;
  version?: unknown;
  iosBuildNumber?: unknown;
};

export type NormalizedBuildInfo = {
  gitCommit: string;
  buildTimestamp: string;
  version: string;
  iosBuildNumber: string;
};

export type MobileBuildInfoInput = {
  activeBuildInfo?: RawBuildInfo | null;
  embeddedBuildInfo?: RawBuildInfo | null;
  nativeAppVersion?: unknown;
  nativeBuildNumber?: unknown;
  expoConfigVersion?: unknown;
  runtimeVersion?: unknown;
  expoConfigRuntimeVersion?: unknown;
  updateId?: unknown;
  channel?: unknown;
  createdAt?: Date | string | null;
  isEmbeddedLaunch?: boolean | null;
  isEmergencyLaunch?: boolean | null;
  emergencyLaunchReason?: unknown;
};

export function normalizeBuildInfoString(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : "";
}

function normalizeBoolean(value: boolean | null | undefined) {
  return typeof value === "boolean" ? value : null;
}

function normalizeDateLike(value: Date | string | null | undefined) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  return normalizeBuildInfoString(value);
}

export function normalizeBuildInfo(source?: RawBuildInfo | null): NormalizedBuildInfo {
  return {
    gitCommit: normalizeBuildInfoString(source?.gitCommit),
    buildTimestamp: normalizeBuildInfoString(source?.buildTimestamp),
    version: normalizeBuildInfoString(source?.version),
    iosBuildNumber: normalizeBuildInfoString(source?.iosBuildNumber),
  };
}

export function resolveMobileBuildInfo(input: MobileBuildInfoInput) {
  const activeBuildInfo = normalizeBuildInfo(input.activeBuildInfo);
  const embeddedBuildInfo = normalizeBuildInfo(input.embeddedBuildInfo);
  const nativeAppVersion = normalizeBuildInfoString(input.nativeAppVersion);
  const nativeBuildNumber = normalizeBuildInfoString(input.nativeBuildNumber);
  const isEmbeddedLaunch = normalizeBoolean(input.isEmbeddedLaunch);
  const isEmergencyLaunch = normalizeBoolean(input.isEmergencyLaunch);
  const rawUpdateId = normalizeBuildInfoString(input.updateId);
  const activeOtaUpdateId = isEmbeddedLaunch === true ? "" : rawUpdateId;
  const activeOtaGitCommit = isEmbeddedLaunch === true ? "" : activeBuildInfo.gitCommit;

  return {
    gitCommit: activeOtaGitCommit || embeddedBuildInfo.gitCommit,
    buildTimestamp: activeBuildInfo.buildTimestamp || embeddedBuildInfo.buildTimestamp,
    version:
      nativeAppVersion ||
      activeBuildInfo.version ||
      embeddedBuildInfo.version ||
      normalizeBuildInfoString(input.expoConfigVersion),
    nativeAppVersion,
    nativeBuildNumber,
    iosBuildNumber: nativeBuildNumber || embeddedBuildInfo.iosBuildNumber,
    runtimeVersion: normalizeBuildInfoString(input.runtimeVersion) || normalizeBuildInfoString(input.expoConfigRuntimeVersion),
    updateId: rawUpdateId,
    activeOtaUpdateId,
    activeOtaGitCommit,
    activeOtaBuildInfo: activeBuildInfo,
    activeOtaCreatedAt: normalizeDateLike(input.createdAt),
    channel: normalizeBuildInfoString(input.channel),
    isEmbeddedLaunch,
    isEmergencyLaunch,
    emergencyLaunchReason: normalizeBuildInfoString(input.emergencyLaunchReason),
    embeddedGitCommit: embeddedBuildInfo.gitCommit,
    embeddedBuildInfo,
  };
}
