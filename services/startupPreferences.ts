import AsyncStorage from "@react-native-async-storage/async-storage";

const HAS_SEEN_ONBOARDING_KEY = "hasSeenOnboarding";

export const startupPreferences = {
  async hasSeenOnboarding() {
    const value = await AsyncStorage.getItem(HAS_SEEN_ONBOARDING_KEY);
    return value === "true";
  },

  async setHasSeenOnboarding() {
    await AsyncStorage.setItem(HAS_SEEN_ONBOARDING_KEY, "true");
  },
};
