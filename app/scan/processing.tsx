import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { Colors, Radius, Typography } from "@/constants/theme";
import { ApiRequestError } from "@/services/apiClient";
import { scanService } from "@/services/scanService";

export default function ProcessingScreen() {
  const params = useLocalSearchParams<{ imageUri?: string }>();
  const imageUri = typeof params.imageUri === "string" ? params.imageUri : "";
  const didComplete = useRef(false);

  useEffect(() => {
    console.log("[scan-processing] params", params);
    if (!imageUri) {
      Alert.alert("Scan unavailable", "We couldn’t find that photo. Please try scanning again.");
      router.replace("/(tabs)/scan");
      return;
    }
    const timeoutId = setTimeout(() => {
      if (didComplete.current) return;
      didComplete.current = true;
      Alert.alert(
        "Scan taking too long",
        "We’re having trouble reaching the scan service. Check that your phone is on the same Wi‑Fi as the backend and try again.",
      );
      router.replace("/(tabs)/scan");
    }, 25000);
    scanService
      .identifyVehicle(imageUri)
      .then((result) => {
        if (didComplete.current) return;
        didComplete.current = true;
        clearTimeout(timeoutId);
        router.replace({ pathname: "/scan/result", params: { scanId: result.id, imageUri: result.imageUri } });
      })
      .catch((error) => {
        if (didComplete.current) return;
        didComplete.current = true;
        clearTimeout(timeoutId);
        if (error instanceof ApiRequestError && error.code === "SCAN_LIMIT_REACHED") {
          Alert.alert("Free scan limit reached", "You’ve used all 5 free scans. Start unlimited access to keep scanning.");
          router.replace("/paywall");
          return;
        }
        Alert.alert("Scan unavailable", error instanceof Error ? error.message : "We couldn’t identify that vehicle right now.");
        router.replace("/(tabs)/scan");
      });
    return () => clearTimeout(timeoutId);
  }, [imageUri]);

  return (
    <AppContainer scroll={false} contentContainerStyle={styles.container}>
      {imageUri ? <Image source={{ uri: imageUri }} style={styles.image} /> : null}
      <View style={styles.card}>
        <Text style={styles.title}>Identifying your vehicle</Text>
        <Text style={styles.subtitle}>Comparing shape, lights, stance, and trim cues against our vehicle reference set.</Text>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", gap: 24 },
  image: { width: "100%", height: 280, borderRadius: Radius.xl },
  card: { backgroundColor: Colors.card, padding: 24, borderRadius: Radius.xl, gap: 12 },
  title: { ...Typography.title, color: Colors.text, textAlign: "center" },
  subtitle: { ...Typography.body, color: Colors.textMuted, textAlign: "center" },
});
