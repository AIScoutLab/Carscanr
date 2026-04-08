import type { ExpoConfig } from "expo/config";

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
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: "./assets/app-icon-square.png",
  runtimeVersion: {
    policy: "appVersion",
  },
  updates: {
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
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
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
