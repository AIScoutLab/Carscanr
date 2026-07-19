import PostHog from "posthog-react-native";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as
  | {
      posthogProjectKey?: string;
      posthogProjectToken?: string;
      posthogHost?: string;
      posthogEnabled?: string;
      publicEnv?: {
        posthogProjectKey?: string;
        posthogHost?: string;
        posthogEnabled?: string;
      };
    }
  | undefined;

const projectKey = extra?.publicEnv?.posthogProjectKey || extra?.posthogProjectKey || extra?.posthogProjectToken || "";
const host = extra?.publicEnv?.posthogHost || extra?.posthogHost || "https://us.i.posthog.com";
const enabledValue = (extra?.publicEnv?.posthogEnabled || extra?.posthogEnabled || "true").toLowerCase();
const isEnabled = enabledValue !== "0" && enabledValue !== "false";
const isConfigured = Boolean(projectKey && projectKey.length > 0 && isEnabled);

if (__DEV__ && !isConfigured) {
  console.warn("[posthog] project key not configured or analytics disabled");
}

export const posthog = new PostHog(projectKey || "placeholder_key", {
  host,
  disabled: !isConfigured,
  captureAppLifecycleEvents: false,
  flushAt: 20,
  flushInterval: 10000,
});

if (__DEV__) {
  posthog.debug();
}

export const posthogAnalyticsEnabled = isConfigured;
