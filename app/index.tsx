import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { authService } from "@/services/authService";

export default function Index() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      const [hasSeenOnboarding, token] = await Promise.all([
        AsyncStorage.getItem("hasSeenOnboarding"),
        authService.getAccessToken(),
      ]);
      if (!active) return;
      if (token) {
        setTarget("/(tabs)/scan");
        return;
      }
      setTarget(hasSeenOnboarding ? "/(auth)" : "/(onboarding)");
    };
    hydrate().catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!target) return null;
  return <Redirect href={target as never} />;
}
