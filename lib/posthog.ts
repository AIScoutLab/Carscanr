import PostHog from "posthog-react-native";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as
  | { posthogProjectToken?: string; posthogHost?: string }
  | undefined;

const projectToken = extra?.posthogProjectToken;
const host = extra?.posthogHost || "https://us.i.posthog.com";
const isConfigured = Boolean(projectToken && projectToken.length > 0);

if (__DEV__ && !isConfigured) {
  console.warn("[posthog] project token not configured — analytics disabled");
}

export const posthog = new PostHog(projectToken || "placeholder_key", {
  host,
  disabled: !isConfigured,
  captureAppLifecycleEvents: true,
  flushAt: 20,
  flushInterval: 10000,
});

if (__DEV__) {
  posthog.debug();
}
