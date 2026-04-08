import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { sampleScanPhotos } from "@/features/scan/samplePhotos";

async function ensureCameraPermission() {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;
  const request = await ImagePicker.requestCameraPermissionsAsync();
  return request.granted;
}

async function ensureLibraryPermission() {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted || current.accessPrivileges === "limited") return true;
  const request = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return request.granted || request.accessPrivileges === "limited";
}

async function cacheImage(uri: string) {
  const destination = `${FileSystem.cacheDirectory}scan-${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}

async function downloadSampleImage(uri: string) {
  const destination = `${FileSystem.cacheDirectory}sample-scan-${Date.now()}.jpg`;
  await FileSystem.downloadAsync(uri, destination);
  return destination;
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

export async function pickPhotoFromLibrary() {
  const allowed = await ensureLibraryPermission();
  if (!allowed) {
    throw new Error("Photo library access is disabled. Enable it in Settings to continue.");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
  });
  if (result.canceled) return null;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // Haptics are best-effort only.
  }
  return cacheImage(result.assets[0].uri);
}

export async function capturePhoto() {
  const allowed = await ensureCameraPermission();
  if (!allowed) {
    throw new Error("Camera access is disabled. Enable it in Settings to continue.");
  }
  const result = await ImagePicker.launchCameraAsync({
    cameraType: ImagePicker.CameraType.back,
    quality: 0.9,
  });
  if (result.canceled) return null;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // Haptics are best-effort only.
  }
  return cacheImage(result.assets[0].uri);
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
