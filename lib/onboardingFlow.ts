export type StartupRouteTarget = "/onboarding" | "/(tabs)/scan";

export type StartupRouteInput = {
  hasCompletedOnboarding: boolean;
  hasAccessToken: boolean;
};

export type OnboardingVisualKind = "camera" | "insights" | "garage";

export type OnboardingStep = {
  key: string;
  headline: string;
  body: string;
  visualKind: OnboardingVisualKind;
};

export const APP_BRAND = {
  name: "CarScanr",
  tagline: "Identify any car instantly.",
} as const;

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: "identify",
    headline: "Identify any car instantly",
    body: "Point your camera at any vehicle to instantly identify it with AI.",
    visualKind: "camera",
  },
  {
    key: "insights",
    headline: "Get specs, value, and nearby listings",
    body: "See trims, horsepower, market value, and nearby vehicles in seconds.",
    visualKind: "insights",
  },
  {
    key: "garage",
    headline: "Build your garage automatically",
    body: "Your scans and saved vehicles stay ready whenever you need them.",
    visualKind: "garage",
  },
];

export function resolveStartupRoute(input: StartupRouteInput): StartupRouteTarget {
  // First-launch onboarding is intentionally tied to local app state, not auth.
  // A user with a restored session should still see onboarding again after a
  // reinstall/reset because the local onboarding flag is gone.
  if (!input.hasCompletedOnboarding) {
    return "/onboarding";
  }

  return input.hasAccessToken ? "/(tabs)/scan" : "/(tabs)/scan";
}
