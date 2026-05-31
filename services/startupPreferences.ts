import AsyncStorage from "@react-native-async-storage/async-storage";

const HAS_SEEN_ONBOARDING_KEY = "hasSeenOnboarding";
const PENDING_AUTH_RETURN_TARGET_KEY = "pendingAuthReturnTarget";

function isSafeReturnTarget(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("://");
}

export const startupPreferences = {
  async hasSeenOnboarding() {
    const value = await AsyncStorage.getItem(HAS_SEEN_ONBOARDING_KEY);
    return value === "true";
  },

  async hasCompletedOnboarding() {
    return this.hasSeenOnboarding();
  },

  async setHasSeenOnboarding() {
    await AsyncStorage.setItem(HAS_SEEN_ONBOARDING_KEY, "true");
  },

  async markOnboardingComplete() {
    await this.setHasSeenOnboarding();
  },

  async setPendingAuthReturnTarget(target: string) {
    if (!isSafeReturnTarget(target)) {
      return;
    }
    await AsyncStorage.setItem(PENDING_AUTH_RETURN_TARGET_KEY, target);
  },

  async consumePendingAuthReturnTarget(fallback = "/(tabs)/scan") {
    const value = await AsyncStorage.getItem(PENDING_AUTH_RETURN_TARGET_KEY);
    await AsyncStorage.removeItem(PENDING_AUTH_RETURN_TARGET_KEY);
    return value && isSafeReturnTarget(value) ? value : fallback;
  },
};
