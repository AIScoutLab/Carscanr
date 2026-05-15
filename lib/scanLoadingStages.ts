export const SCAN_LOADING_STAGES = [
  "Analyzing vehicle…",
  "Checking visual details",
  "Matching year range",
  "Loading trusted specs",
] as const;

export type ScanLoadingStageLabel = (typeof SCAN_LOADING_STAGES)[number];

export function getScanLoadingStageIndex(status: string) {
  if (
    status === "Capture complete" ||
    status === "Photo selected" ||
    status === "File copy" ||
    status === "File info" ||
    status === "Optimizing image" ||
    status === "Opening photo library"
  ) {
    return 0;
  }
  if (status === "Preparing upload" || status === "Uploading image") {
    return 1;
  }
  if (status === "Waiting for identification" || status === "Waking backend, please wait...") {
    return 2;
  }
  if (status === "Identifying vehicle...") {
    return 2;
  }
  if (status === "Identify succeeded" || status === "Opening result" || status === "Navigation to result") {
    return 3;
  }
  return 0;
}

export function getScanLoadingStageState(status: string) {
  const stageIndex = getScanLoadingStageIndex(status);
  return {
    stageIndex,
    stageLabel: SCAN_LOADING_STAGES[stageIndex] ?? SCAN_LOADING_STAGES[0],
    stageCount: SCAN_LOADING_STAGES.length,
    progressRatio: (stageIndex + 1) / SCAN_LOADING_STAGES.length,
  };
}
