export const CANONICAL_BRAND_MARK_ASSET_PATH = "../icon-1024.png";
export const CANONICAL_BRAND_MARK_SOURCE = require("../icon-1024.png");

export const BRAND_MARK_SIZES = {
  onboardingHeader: 44,
  scanHero: 48,
  authHero: 76,
} as const;

// Keep all app-facing brand mark usage flowing through one canonical asset.
// Older logo files drifted back into production when screens imported them directly.
export const DEPRECATED_BRAND_ASSET_REFERENCES = [
  "@/carscanr_app_icon_1024.png",
  "../Icon.png",
  "../../Icon.png",
  "../assets/icon.png",
  "../../assets/icon.png",
] as const;
