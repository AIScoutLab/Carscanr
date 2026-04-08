import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SubscriptionProvider } from "@/features/subscription/SubscriptionProvider";

export default function RootLayout() {
  return (
    <SubscriptionProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F5F6F8" } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="scan/processing" />
        <Stack.Screen name="scan/result" />
        <Stack.Screen name="vehicle/[id]" />
        <Stack.Screen name="paywall" options={{ presentation: "modal" }} />
      </Stack>
    </SubscriptionProvider>
  );
}
