import { Camera } from "expo-camera";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { sampleScanPhotos } from "@/features/scan/samplePhotos";

export type PickerPermissionState = {
  granted: boolean;
  canAskAgain: boolean;
  accessPrivileges?: string;
};

export type SelectedScanPhoto = {
  canceled: boolean;
  assetExists: boolean;
  originalUri: string | null;
  cachedUri: string | null;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
};

const OPTIMIZED_LONG_SIDE = 1800;
const OPTIMIZED_JPEG_QUALITY = 0.72;
type StageLogger = (stage: string, payload?: unknown) => void;

async function cacheImage(uri: string) {
  const destination = `${FileSystem.cacheDirectory}scan-${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}

async function getAssetMetadata(asset: ImagePicker.ImagePickerAsset | undefined): Promise<SelectedScanPhoto> {
  if (!asset?.uri) {
    return {
      canceled: false,
      assetExists: false,
      originalUri: null,
      cachedUri: null,
      mimeType: asset?.mimeType ?? null,
      fileName: asset?.fileName ?? null,
      fileSize: typeof asset?.fileSize === "number" ? asset.fileSize : null,
      width: typeof asset?.width === "number" ? asset.width : null,
      height: typeof asset?.height === "number" ? asset.height : null,
    };
  }

  const cachedUri = await cacheImage(asset.uri);
  const info = await FileSystem.getInfoAsync(cachedUri, { size: true });

  return {
    canceled: false,
    assetExists: true,
    originalUri: asset.uri,
    cachedUri,
    mimeType: asset.mimeType ?? null,
    fileName: asset.fileName ?? cachedUri.split("/").pop() ?? null,
    fileSize:
      typeof asset.fileSize === "number"
        ? asset.fileSize
        : info.exists && typeof info.size === "number"
          ? info.size
          : null,
    width: typeof asset.width === "number" ? asset.width : null,
    height: typeof asset.height === "number" ? asset.height : null,
  };
}

function wasPickerCanceled(result: ImagePicker.ImagePickerResult) {
  return "canceled" in result ? result.canceled : Boolean((result as { cancelled?: boolean }).cancelled);
}

export async function getCameraPermissionState(): Promise<PickerPermissionState> {
  const current = await Camera.getCameraPermissionsAsync();
  return {
    granted: current.granted,
    canAskAgain: current.canAskAgain,
    accessPrivileges: undefined,
  };
}

export async function getLibraryPermissionState(): Promise<PickerPermissionState> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  return {
    granted: current.granted || current.accessPrivileges === "limited",
    canAskAgain: current.canAskAgain,
    accessPrivileges: current.accessPrivileges,
  };
}

export async function requestCameraPermission(): Promise<PickerPermissionState> {
  const request = await Camera.requestCameraPermissionsAsync();
  return {
    granted: request.granted,
    canAskAgain: request.canAskAgain,
    accessPrivileges: undefined,
  };
}

export async function requestLibraryPermission(): Promise<PickerPermissionState> {
  const request = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return {
    granted: request.granted || request.accessPrivileges === "limited",
    canAskAgain: request.canAskAgain,
    accessPrivileges: request.accessPrivileges,
  };
}

export async function buildSelectedScanPhotoFromUri(input: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  onStage?: StageLogger;
}): Promise<SelectedScanPhoto> {
  if (!input.uri) {
    throw new Error("Image URI is missing.");
  }

  input.onStage?.("file copy start", { uri: input.uri });
  const cachedUri = await cacheImage(input.uri);
  input.onStage?.("file copy end", { cachedUri });
  input.onStage?.("file info start", { cachedUri });
  const info = await FileSystem.getInfoAsync(cachedUri, { size: true });
  input.onStage?.("file info end", {
    cachedUri,
    exists: info.exists,
    size: info.exists && typeof info.size === "number" ? info.size : null,
  });

  return {
    canceled: false,
    assetExists: true,
    originalUri: input.uri,
    cachedUri,
    mimeType: input.mimeType ?? "image/jpeg",
    fileName: input.fileName ?? cachedUri.split("/").pop() ?? null,
    fileSize:
      typeof input.fileSize === "number"
        ? input.fileSize
        : info.exists && typeof info.size === "number"
          ? info.size
          : null,
    width: typeof input.width === "number" ? input.width : null,
    height: typeof input.height === "number" ? input.height : null,
  };
}

export async function getFileInfoForScan(uri: string) {
  return FileSystem.getInfoAsync(uri, { size: true });
}

export async function launchLibraryForScan(): Promise<SelectedScanPhoto> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
  });

  if (wasPickerCanceled(result)) {
    return {
      canceled: true,
      assetExists: false,
      originalUri: null,
      cachedUri: null,
      mimeType: null,
      fileName: null,
      fileSize: null,
      width: null,
      height: null,
    };
  }

  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // Haptics are best-effort only.
  }

  return getAssetMetadata(result.assets?.[0]);
}

export async function optimizeScanImage(selection: SelectedScanPhoto): Promise<SelectedScanPhoto> {
  if (!selection.cachedUri) {
    throw new Error("Image URI is missing for optimization.");
  }

  const width = selection.width ?? null;
  const height = selection.height ?? null;
  const longSide = width && height ? Math.max(width, height) : null;
  const shouldResize = typeof longSide === "number" && longSide > OPTIMIZED_LONG_SIDE;
  const resizeAction =
    shouldResize && width && height
      ? width >= height
        ? [{ resize: { width: OPTIMIZED_LONG_SIDE } }]
        : [{ resize: { height: OPTIMIZED_LONG_SIDE } }]
      : [];

  const result = await manipulateAsync(selection.cachedUri, resizeAction, {
    compress: OPTIMIZED_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });
  const info = await FileSystem.getInfoAsync(result.uri, { size: true });

  return {
    ...selection,
    cachedUri: result.uri,
    mimeType: "image/jpeg",
    fileName: result.uri.split("/").pop() ?? selection.fileName ?? `scan-${Date.now()}.jpg`,
    fileSize: info.exists && typeof info.size === "number" ? info.size : selection.fileSize,
    width: result.width,
    height: result.height,
  };
}

export type SampleScanPhoto = {
  id: string;
  title: string;
  subtitle: string;
  previewUrl: string;
};

export function getSampleScanPhotos(): SampleScanPhoto[] {
  return [...sampleScanPhotos];
}

export async function pickSamplePhoto(sampleId: string) {
  const sample = sampleScanPhotos.find((entry) => entry.id === sampleId);
  if (!sample) {
    throw new Error("Sample photo not found.");
  }
  const destination = `${FileSystem.cacheDirectory}${sample.id}.jpg`;
  await FileSystem.downloadAsync(sample.previewUrl, destination);
  return destination;
}
