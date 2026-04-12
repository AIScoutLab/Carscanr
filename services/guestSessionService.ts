import AsyncStorage from "@react-native-async-storage/async-storage";

const GUEST_ID_STORAGE_KEY = "carscanr.guest-id.v1";

function generateGuestId() {
  return `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

let cachedGuestId: string | null = null;

export const guestSessionService = {
  async getGuestId(): Promise<string> {
    if (cachedGuestId) {
      return cachedGuestId;
    }

    try {
      const stored = await AsyncStorage.getItem(GUEST_ID_STORAGE_KEY);
      if (stored && stored.trim()) {
        cachedGuestId = stored.trim();
        return cachedGuestId;
      }

      const created = generateGuestId();
      await AsyncStorage.setItem(GUEST_ID_STORAGE_KEY, created);
      cachedGuestId = created;
      return created;
    } catch {
      const fallback = generateGuestId();
      cachedGuestId = fallback;
      return fallback;
    }
  },
};
