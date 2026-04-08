import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { AppContainer } from "@/components/AppContainer";
import { PaywallCard } from "@/components/PaywallCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SamplePhotoPickerSheet } from "@/components/SamplePhotoPickerSheet";
import { ScanUsageMeter } from "@/components/ScanUsageMeter";
import { SectionHeader } from "@/components/SectionHeader";
import { UpgradePromptCard } from "@/components/UpgradePromptCard";
import { VehicleCard } from "@/components/VehicleCard";
import { Colors, Motion, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";
import { capturePhoto, getSampleScanPhotos, pickPhotoFromLibrary, pickSamplePhoto } from "@/features/scan/useScanActions";
import { useSubscription } from "@/hooks/useSubscription";
import { scanService } from "@/services/scanService";
import { ScanResult } from "@/types";
import { LinearGradient } from "expo-linear-gradient";

export default function ScanScreen() {
  const [recentScans, setRecentScans] = useState<ScanResult[]>([]);
  const [samplePickerOpen, setSamplePickerOpen] = useState(false);
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null);
  const { status: usage, freeUnlocksUsed, freeUnlocksRemaining, freeUnlocksLimit, refreshStatus } = useSubscription();
  const samplePhotos = getSampleScanPhotos();

  useEffect(() => {
    scanService.getRecentScans().then(setRecentScans);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshStatus().catch(() => undefined);
    }, [refreshStatus]),
  );

  const routeToProcessing = (imageUri: string) => {
    if (typeof imageUri !== "string" || imageUri.length === 0) {
      return;
    }
    router.push({ pathname: "/scan/processing", params: { imageUri } });
  };

  const scansUsed = usage?.scansUsed ?? usage?.scansUsedToday ?? 0;
  const scanLimit = usage?.limit ?? usage?.dailyScanLimit ?? 5;
  const blocked = usage?.plan === "free" && scansUsed >= scanLimit;
  const showUpgradeCard = usage?.plan !== "pro" && (scansUsed >= 2 || blocked);
  const showSoftUpsell = usage?.plan === "free" && scansUsed >= 3 && !blocked;

  const beginScan = async (source: "camera" | "library") => {
    if (source === "library") {
      setSamplePickerOpen(true);
      return;
    }

    try {
      const imageUri = await capturePhoto();
      if (!imageUri) return;
      if (blocked) {
        Alert.alert("Free scan limit reached", "You’ve used all 5 free scans. Start unlimited access to keep scanning.");
        router.push("/paywall");
        return;
      }
      routeToProcessing(imageUri);
    } catch (error) {
      Alert.alert("Camera unavailable", error instanceof Error ? error.message : "We couldn’t open the camera.");
    }
  };

  const beginLibraryScan = async () => {
    try {
      const imageUri = await pickPhotoFromLibrary();
      setSamplePickerOpen(false);
      if (!imageUri) return;
      if (blocked) {
        Alert.alert("Free scan limit reached", "You’ve used all 5 free scans. Start unlimited access to keep scanning.");
        router.push("/paywall");
        return;
      }
      routeToProcessing(imageUri);
    } catch (error) {
      setSamplePickerOpen(false);
      Alert.alert("Photos unavailable", error instanceof Error ? error.message : "We couldn’t open your photo library.");
    }
  };

  const beginSampleScan = async (sampleId: string) => {
    try {
      setLoadingSampleId(sampleId);
      const imageUri = await pickSamplePhoto(sampleId);
      setSamplePickerOpen(false);
      if (blocked) {
        Alert.alert("Free scan limit reached", "You’ve used all 5 free scans. Start unlimited access to keep scanning.");
        router.push("/paywall");
        return;
      }
      routeToProcessing(imageUri);
    } catch (error) {
      Alert.alert("Sample unavailable", error instanceof Error ? error.message : "We couldn’t prepare that sample vehicle photo.");
    } finally {
      setLoadingSampleId(null);
    }
  };

  return (
    <AppContainer>
      <Text style={styles.title}>Scan a vehicle</Text>
      <Text style={styles.subtitle}>Snap a photo and get instant specs, value, and market insights.</Text>
      {usage ? (
        <ScanUsageMeter
          status={usage}
          mode="unlocks"
          unlocksUsed={freeUnlocksUsed}
          unlocksRemaining={freeUnlocksRemaining}
          unlocksLimit={freeUnlocksLimit}
          supportingText="Upgrade for unlimited scans, pricing insights, and listings."
          ctaLabel="Go Pro"
          onCtaPress={() => router.push("/paywall")}
        />
      ) : null}
      <View style={styles.scanCard}>
        <Pressable style={({ pressed }) => [styles.cameraButton, pressed && styles.cameraPressed]} onPress={() => beginScan("camera")}>
          <LinearGradient colors={["#0F172A", "#1E293B"]} style={styles.cameraGradient}>
            <Text style={styles.cameraButtonLabel}>Scan Vehicle</Text>
          </LinearGradient>
        </Pressable>
        <PrimaryButton label="Choose From Photos" secondary onPress={() => beginScan("library")} />
        <Text style={styles.helper}>In the simulator, you can use sample vehicle photos if you do not have camera access.</Text>
      </View>
      {showSoftUpsell ? (
        <UpgradePromptCard
          title="Want deeper insights on every vehicle?"
          description="Upgrade for pricing trends, live listings, and premium decision guidance."
          ctaLabel="Explore Pro"
          onPress={() => router.push("/paywall")}
        />
      ) : null}
      {showUpgradeCard ? <PaywallCard status={usage} onPress={() => router.push("/paywall")} /> : null}
      <SectionHeader title="Recent scans" subtitle="Jump back into the vehicles you’ve already scanned." />
      {recentScans.map((scan) => (
        <VehicleCard
          key={scan.id}
          vehicle={{
            id: scan.identifiedVehicle.id,
            year: scan.identifiedVehicle.year,
            make: scan.identifiedVehicle.make,
            model: scan.identifiedVehicle.model,
            trim: scan.identifiedVehicle.trim ?? "Likely trim",
            bodyStyle: "Detected",
            heroImage: scan.imageUri,
            overview: `Confidence ${Math.round(scan.confidenceScore * 100)}%. ${scan.limitedPreview ? "Free preview active." : "Full detail available."}`,
            specs: {
              engine: "",
              horsepower: 0,
              torque: "",
              transmission: "",
              drivetrain: "",
              mpgOrRange: "",
              exteriorColors: [],
              msrp: 0,
            },
            valuation: { tradeIn: "", privateParty: "", dealerRetail: "", confidenceLabel: "" },
            listings: [],
          }}
          subtitle="Tap to open your full scan result"
          onPress={() => {
            if (typeof scan.id === "string" && scan.id.length > 0) {
              router.push({ pathname: "/scan/result", params: { scanId: scan.id } });
            }
          }}
        />
      ))}
      <SamplePhotoPickerSheet
        visible={samplePickerOpen}
        samples={samplePhotos}
        loadingSampleId={loadingSampleId}
        onClose={() => {
          if (!loadingSampleId) {
            setSamplePickerOpen(false);
          }
        }}
        onOpenLibrary={() => {
          beginLibraryScan().catch(() => undefined);
        }}
        onSelectSample={(sampleId) => {
          beginSampleScan(sampleId).catch(() => undefined);
        }}
      />
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  title: { ...Typography.largeTitle, color: Colors.textStrong, marginTop: 12 },
  subtitle: { ...Typography.body, color: Colors.textMuted, marginBottom: 4 },
  scanCard: { ...cardStyles.primary, gap: 14 },
  cameraButton: {
    borderRadius: Radius.xl,
    minHeight: 180,
    overflow: "hidden",
    shadowColor: Colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  cameraPressed: {
    transform: [{ scale: Motion.pressInScale }],
  },
  cameraGradient: {
    flex: 1,
    borderRadius: Radius.xl,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 24,
  },
  cameraButtonLabel: { ...Typography.title, color: "#FFFFFF" },
  helper: { ...Typography.caption, color: Colors.textMuted },
});
