import type { ExpoConfig } from "expo/config";

const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || "6e7cd5a8-7f65-44ce-88a8-3d1a3f589cc6";
const appEnv = process.env.EXPO_PUBLIC_APP_ENV === "preview" || process.env.EXPO_PUBLIC_APP_ENV === "production"
  ? process.env.EXPO_PUBLIC_APP_ENV
  : "local";
const isPreview = appEnv === "preview";
const isLocal = appEnv === "local";
const appName = process.env.EXPO_PUBLIC_APP_NAME || (isPreview ? "CarScanr Preview" : "CarScanr");
const bundleIdentifier =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_ID || (isPreview ? "com.mattbrillman.carscanr.preview" : "com.mattbrillman.carscanr");

const config: ExpoConfig = {
  name: appName,
  slug: "carscanr",
  scheme: "carscanr",
  version: "1.0.2",
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: "./icon-1024.png",
  runtimeVersion: "1.0.2",
  updates: {
    url: `https://u.expo.dev/${easProjectId}`,
    fallbackToCacheTimeout: 0,
  },
  plugins: [
    "expo-router",
    [
      "expo-image-picker",
      {
        photosPermission: "Allow CarScanr to access your photos to identify vehicles and save scans.",
        cameraPermission: "Allow CarScanr to use your camera to identify vehicles.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appEnv,
    publicEnv: {
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || "",
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || "",
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "",
      planOverride: process.env.EXPO_PUBLIC_PLAN_OVERRIDE || "",
    },
    eas: {
      projectId: easProjectId,
    },
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier,
    buildNumber: process.env.EXPO_PUBLIC_IOS_BUILD_NUMBER || "1",
    infoPlist: {
      NSCameraUsageDescription: "Allow CarScanr to use your camera to identify vehicles.",
      NSPhotoLibraryUsageDescription: "Allow CarScanr to access your photos to identify vehicles and save scans.",
      NSPhotoLibraryAddUsageDescription: "Allow CarScanr to save scan photos to your library.",
      ...(isLocal
        ? {
            NSLocalNetworkUsageDescription: "Allow CarScanr to connect to your local backend during development.",
          }
        : {}),
    },
  },
};

export default config;
