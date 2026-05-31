import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BrandMark } from "@/components/BrandMark";
import { BRAND_MARK_LAYOUT } from "@/constants/branding";
import { APP_BRAND, ONBOARDING_STEPS, OnboardingVisualKind } from "@/lib/onboardingFlow";
import { getOnboardingLayoutMetrics } from "@/lib/onboardingLayout";
import { Radius, Typography } from "@/constants/theme";
import { startupPreferences } from "@/services/startupPreferences";
import { sampleScanPhotos } from "@/features/scan/samplePhotos";
import { mobileBuildInfo } from "@/lib/env";

function CameraVisual() {
  const sample = sampleScanPhotos[1] ?? sampleScanPhotos[0];

  return (
    <View style={styles.visualShellPhoto}>
      <Image source={{ uri: sample.previewUrl }} style={styles.visualPhoto} resizeMode="cover" />
      <LinearGradient colors={["rgba(0,0,0,0.05)", "rgba(0,0,0,0.18)", "rgba(0,0,0,0.92)"]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.scanTargetBox}>
        <View style={styles.scanTargetLine} />
        <View style={styles.scanTargetDot} />
        <View style={styles.scanCornerTL} />
        <View style={styles.scanCornerTR} />
        <View style={styles.scanCornerBL} />
        <View style={styles.scanCornerBR} />
      </View>
      <View style={styles.visualBadgeRow}>
        <View style={styles.aiBadge}>
          <View style={styles.aiBadgeDot} />
          <Text style={styles.aiBadgeText}>AI Identifying</Text>
        </View>
        <View style={styles.matchBadge}>
          <Text style={styles.matchBadgeText}>98% match</Text>
        </View>
      </View>
    </View>
  );
}

function InsightsVisual() {
  const sample = sampleScanPhotos[1] ?? sampleScanPhotos[0];
  return (
    <View style={styles.visualShellPhoto}>
      <Image source={{ uri: sample.previewUrl }} style={styles.visualPhoto} resizeMode="cover" />
      <LinearGradient colors={["rgba(0,0,0,0.62)", "rgba(0,0,0,0.74)"]} style={StyleSheet.absoluteFill} />
      <View style={styles.insightPanel}>
        <Text style={styles.panelEyebrow}>Instant report</Text>
        <Text style={styles.panelTitle}>Vehicle identified</Text>
        <View style={styles.statRow}>
          <View style={styles.statBlock}>
            <Text style={styles.statValue}>265 hp</Text>
            <Text style={styles.statLabel}>Power</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBlock}>
            <Text style={styles.statValue}>$38.4k</Text>
            <Text style={styles.statLabel}>Value</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBlock}>
            <Text style={styles.statValue}>8</Text>
            <Text style={styles.statLabel}>Nearby</Text>
          </View>
        </View>
      </View>
      <View style={styles.identityStrip}>
        <View style={styles.identityCell}>
          <Text style={styles.identityLabel}>Make</Text>
          <Text style={styles.identityValue}>BMW</Text>
        </View>
        <View style={styles.identityCell}>
          <Text style={styles.identityLabel}>Model</Text>
          <Text style={styles.identityValue}>M3</Text>
        </View>
        <View style={styles.identityCell}>
          <Text style={styles.identityLabel}>Year</Text>
          <Text style={styles.identityValue}>2023</Text>
        </View>
        <View style={styles.identityCell}>
          <Text style={styles.identityLabel}>Trim</Text>
          <Text style={styles.identityValue}>Competition</Text>
        </View>
      </View>
    </View>
  );
}

function GarageVisual() {
  const primary = sampleScanPhotos[0];
  const secondary = sampleScanPhotos[1];
  return (
    <View style={styles.garageShowcase}>
      <View style={[styles.garageImageCard, styles.garageImageCardBack]}>
        <Image source={{ uri: secondary.previewUrl }} style={styles.visualPhoto} resizeMode="cover" />
        <LinearGradient colors={["rgba(0,0,0,0.18)", "rgba(0,0,0,0.84)"]} style={StyleSheet.absoluteFill} />
        <Text style={styles.garageGhostTitle}>2021 BMW M5 Competition</Text>
      </View>
      <View style={styles.garageImageCard}>
        <Image source={{ uri: primary.previewUrl }} style={styles.visualPhoto} resizeMode="cover" />
        <LinearGradient colors={["rgba(0,0,0,0.05)", "rgba(0,0,0,0.2)", "rgba(0,0,0,0.9)"]} locations={[0, 0.52, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.garageCardCopy}>
          <Text style={styles.timelineYear}>2022</Text>
          <Text style={styles.timelineModel}>Tesla Model 3</Text>
        </View>
        <View style={styles.garageSavedChip}>
          <Text style={styles.garageSavedChipText}>Saved</Text>
        </View>
      </View>
    </View>
  );
}

function SlideVisual({ kind }: { kind: OnboardingVisualKind }) {
  if (kind === "camera") {
    return <CameraVisual />;
  }
  if (kind === "insights") {
    return <InsightsVisual />;
  }
  return <GarageVisual />;
}

function OnboardingSlide({
  step,
  index,
  width,
  horizontalPadding,
  visualHeight,
  headlineFontSize,
  headlineLineHeight,
  headlineMaxWidth,
  scrollX,
}: {
  step: (typeof ONBOARDING_STEPS)[number];
  index: number;
  width: number;
  horizontalPadding: number;
  visualHeight: number;
  headlineFontSize: number;
  headlineLineHeight: number;
  headlineMaxWidth: number;
  scrollX: Animated.Value;
}) {
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
  const visualTranslateY = scrollX.interpolate({
    inputRange,
    outputRange: [16, 0, 16],
    extrapolate: "clamp",
  });
  const visualScale = scrollX.interpolate({
    inputRange,
    outputRange: [0.97, 1, 0.97],
    extrapolate: "clamp",
  });
  const copyOpacity = scrollX.interpolate({
    inputRange,
    outputRange: [0.55, 1, 0.55],
    extrapolate: "clamp",
  });

  return (
    <View style={[styles.slide, { width, paddingHorizontal: horizontalPadding }]}>
      <Animated.View style={[styles.visualStage, { height: visualHeight, transform: [{ translateY: visualTranslateY }, { scale: visualScale }] }]}>
        <SlideVisual kind={step.visualKind} />
      </Animated.View>

      <Animated.View style={[styles.copyStack, { opacity: copyOpacity }]}>
        <Text
          style={[
            styles.headline,
            {
              fontSize: headlineFontSize,
              lineHeight: headlineLineHeight,
              maxWidth: headlineMaxWidth,
            },
          ]}
        >
          {step.headline}
        </Text>
        <Text style={styles.body}>{step.body}</Text>
      </Animated.View>
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const metrics = useMemo(() => getOnboardingLayoutMetrics(width), [width]);
  const scrollRef = useRef<(ScrollView & { getNode?: () => ScrollView | null }) | null>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    console.log("[onboarding] ONBOARDING_RENDERED_BLACK_GOLD_V3", {
      stepCount: ONBOARDING_STEPS.length,
      gitCommit: mobileBuildInfo.gitCommit || "unknown",
      runtimeVersion: mobileBuildInfo.version || "unknown",
    });
  }, []);

  const finishOnboarding = async (event: "completed" | "skipped", target: string) => {
    if (saving) {
      return;
    }
    try {
      setSaving(true);
      console.log(`[onboarding] ${event === "completed" ? "ONBOARDING_COMPLETED" : "ONBOARDING_SKIPPED"}`, {
        activeIndex,
        target,
        gitCommit: mobileBuildInfo.gitCommit || "unknown",
      });
      await startupPreferences.markOnboardingComplete();
      router.replace(target as never);
    } catch (error) {
      console.error("[onboarding] failed to persist onboarding state", error);
    } finally {
      setSaving(false);
    }
  };

  const scrollToSlide = (index: number, animated: boolean) => {
    const node = scrollRef.current;
    const target = typeof node?.scrollTo === "function" ? node : typeof node?.getNode === "function" ? node.getNode() : null;
    if (!target || typeof target.scrollTo !== "function") {
      console.warn("[onboarding] SCROLL_REF_UNAVAILABLE", {
        index,
        animated,
        activeIndex,
      });
      return false;
    }

    target.scrollTo({ x: index * metrics.slideWidth, animated });
    return true;
  };

  const goToSlide = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, ONBOARDING_STEPS.length - 1));
    console.log("[onboarding] GO_TO_SLIDE", {
      from: activeIndex,
      to: nextIndex,
      slideWidth: metrics.slideWidth,
    });
    setActiveIndex(nextIndex);
    requestAnimationFrame(() => {
      const scrolled = scrollToSlide(nextIndex, true);
      if (!scrolled) {
        scrollX.setValue(nextIndex * metrics.slideWidth);
      }
    });
  };

  useEffect(() => {
    requestAnimationFrame(() => {
      const scrolled = scrollToSlide(activeIndex, false);
      if (!scrolled) {
        scrollX.setValue(activeIndex * metrics.slideWidth);
      }
    });
  }, [activeIndex, metrics.slideWidth]);

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, Math.round(event.nativeEvent.contentOffset.x / metrics.slideWidth)));
    console.log("[onboarding] SCROLL_END", {
      from: activeIndex,
      to: nextIndex,
      offsetX: event.nativeEvent.contentOffset.x,
    });
    setActiveIndex(nextIndex);
  };

  const nextAction = () => {
    console.log("[onboarding] CONTINUE_PRESSED", {
      activeIndex,
      stepCount: ONBOARDING_STEPS.length,
      saving,
    });
    if (activeIndex >= ONBOARDING_STEPS.length - 1) {
      void finishOnboarding("completed", "/(tabs)/scan");
      return;
    }
    goToSlide(activeIndex + 1);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <LinearGradient colors={["#030303", "#0A0908", "#050505"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.ambientOrbTop} />
      <View style={styles.ambientOrbBottom} />

      <View
        style={[
          styles.page,
          {
            paddingTop: Math.max(insets.top + 4, metrics.topHeaderSpacing),
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        <View style={[styles.header, { paddingHorizontal: metrics.horizontalPadding }]}>
          <View style={styles.brandWrap}>
            <BrandMark
              size={BRAND_MARK_LAYOUT.onboardingHeader.size}
              contentScale={BRAND_MARK_LAYOUT.onboardingHeader.contentScale}
              style={styles.brandIcon}
              resizeMode="contain"
            />
            <View>
              <Text style={styles.brandName}>{APP_BRAND.name}</Text>
              <Text style={styles.brandTagline}>{APP_BRAND.tagline}</Text>
            </View>
          </View>
          <Pressable hitSlop={12} onPress={() => void finishOnboarding("skipped", "/(tabs)/scan")}>
            <Text style={styles.skipLabel}>Skip</Text>
          </Pressable>
        </View>

        <View style={styles.carouselViewport}>
          <Animated.ScrollView
            ref={(node) => {
              scrollRef.current = node as unknown as (ScrollView & { getNode?: () => ScrollView | null }) | null;
            }}
            horizontal
            pagingEnabled
            decelerationRate="fast"
            snapToInterval={metrics.slideWidth}
            snapToAlignment="start"
            showsHorizontalScrollIndicator={false}
            bounces={false}
            style={styles.carousel}
            contentContainerStyle={styles.carouselContent}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
              useNativeDriver: true,
            })}
            scrollEventThrottle={16}
            onMomentumScrollEnd={handleScrollEnd}
          >
            {ONBOARDING_STEPS.map((step, index) => (
              <OnboardingSlide
                key={step.key}
                step={step}
                index={index}
                width={metrics.slideWidth}
                horizontalPadding={metrics.horizontalPadding}
                visualHeight={metrics.visualHeight}
                headlineFontSize={metrics.headlineFontSize}
                headlineLineHeight={metrics.headlineLineHeight}
                headlineMaxWidth={metrics.headlineMaxWidth}
                scrollX={scrollX}
              />
            ))}
          </Animated.ScrollView>
        </View>

        <View style={[styles.footer, { paddingHorizontal: metrics.horizontalPadding }]}>
          <View style={[styles.paginationRow, { gap: metrics.paginationGap }]}>
            {ONBOARDING_STEPS.map((step, index) => (
              <View key={step.key} style={[styles.paginationDot, index === activeIndex && styles.paginationDotActive]} />
            ))}
          </View>

          <Pressable style={styles.primaryButton} onPress={nextAction} disabled={saving}>
            <LinearGradient colors={["#D8A36B", "#C8945B", "#B9854F"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[styles.primaryButtonGradient, { minHeight: metrics.ctaMinHeight }]}>
              <Text style={styles.primaryButtonLabel}>{activeIndex === ONBOARDING_STEPS.length - 1 ? "Start Scanning" : "Continue"}</Text>
            </LinearGradient>
          </Pressable>

          <View style={styles.authRow}>
            <Pressable hitSlop={10} onPress={() => void finishOnboarding("completed", "/auth?mode=sign-up")}>
              <Text style={styles.authLink}>Create account</Text>
            </Pressable>
            <Text style={styles.authDivider}>•</Text>
            <Pressable hitSlop={10} onPress={() => void finishOnboarding("completed", "/auth?mode=sign-in")}>
              <Text style={styles.authLink}>Sign in</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#030303",
  },
  page: {
    flex: 1,
  },
  ambientOrbTop: {
    position: "absolute",
    top: -70,
    right: -36,
    width: 210,
    height: 210,
    borderRadius: 210,
    backgroundColor: "rgba(216, 163, 107, 0.13)",
  },
  ambientOrbBottom: {
    position: "absolute",
    bottom: 120,
    left: -34,
    width: 180,
    height: 180,
    borderRadius: 180,
    backgroundColor: "rgba(126, 93, 59, 0.16)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  brandWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandIcon: {
    backgroundColor: "rgba(26, 22, 18, 0.32)",
    shadowColor: "#D8A36B",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  brandName: {
    ...Typography.heading,
    color: "#F5F3EE",
    fontWeight: "800",
  },
  brandTagline: {
    ...Typography.caption,
    color: "rgba(214, 205, 194, 0.68)",
  },
  skipLabel: {
    ...Typography.body,
    color: "rgba(214, 205, 194, 0.86)",
    fontWeight: "600",
    overflow: "hidden",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.065)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  carouselViewport: {
    flex: 1,
    overflow: "hidden",
  },
  carousel: {
    flex: 1,
  },
  carouselContent: {
    alignItems: "stretch",
  },
  slide: {
    flex: 1,
    justifyContent: "space-between",
    gap: 26,
    overflow: "hidden",
  },
  visualStage: {
    justifyContent: "center",
  },
  visualShellPhoto: {
    flex: 1,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.14)",
    backgroundColor: "rgba(12, 12, 12, 0.86)",
    overflow: "hidden",
    justifyContent: "flex-end",
    shadowColor: "#000000",
    shadowOpacity: 0.32,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
  },
  visualPhoto: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  visualShell: {
    flex: 1,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.16)",
    backgroundColor: "rgba(12, 12, 12, 0.78)",
    overflow: "hidden",
    justifyContent: "center",
    padding: 24,
  },
  scanHalo: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 220,
    alignSelf: "center",
    backgroundColor: "rgba(216, 163, 107, 0.12)",
  },
  scanFrame: {
    alignSelf: "center",
    width: "78%",
    aspectRatio: 1,
    maxWidth: 240,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.22)",
    backgroundColor: "rgba(5, 5, 5, 0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  scanTargetBox: {
    position: "absolute",
    left: "25%",
    right: "25%",
    top: "31%",
    height: "43%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(241, 200, 145, 0.34)",
  },
  scanTargetLine: {
    position: "absolute",
    left: -58,
    right: -58,
    top: "45%",
    height: 1,
    backgroundColor: "rgba(241, 200, 145, 0.36)",
  },
  scanTargetDot: {
    position: "absolute",
    left: "50%",
    top: "45%",
    width: 7,
    height: 7,
    marginLeft: -3.5,
    marginTop: -3.5,
    borderRadius: 7,
    backgroundColor: "#D8A36B",
    shadowColor: "#D8A36B",
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  scanSweep: {
    position: "absolute",
    width: "74%",
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(241, 200, 145, 0.12)",
    shadowColor: "#D8A36B",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  scanPulse: {
    width: 92,
    height: 92,
    borderRadius: 92,
    backgroundColor: "rgba(216, 163, 107, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(241, 200, 145, 0.32)",
  },
  scanCornerTL: {
    position: "absolute",
    top: 18,
    left: 18,
    width: 28,
    height: 28,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: "#E7B97F",
    borderTopLeftRadius: 10,
  },
  scanCornerTR: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 28,
    height: 28,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: "#E7B97F",
    borderTopRightRadius: 10,
  },
  scanCornerBL: {
    position: "absolute",
    bottom: 18,
    left: 18,
    width: 28,
    height: 28,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: "#E7B97F",
    borderBottomLeftRadius: 10,
  },
  scanCornerBR: {
    position: "absolute",
    bottom: 18,
    right: 18,
    width: 28,
    height: 28,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: "#E7B97F",
    borderBottomRightRadius: 10,
  },
  insightPanel: {
    marginHorizontal: 18,
    marginTop: 26,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.16)",
    backgroundColor: "rgba(15, 15, 15, 0.94)",
    padding: 24,
    gap: 18,
    shadowColor: "#000000",
    shadowOpacity: 0.32,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
  },
  panelEyebrow: {
    ...Typography.caption,
    color: "#E7B97F",
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  panelTitle: {
    ...Typography.heading,
    color: "#F5F3EE",
    fontWeight: "800",
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statBlock: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    ...Typography.heading,
    color: "#E7B97F",
    fontWeight: "800",
  },
  statLabel: {
    ...Typography.caption,
    color: "rgba(214, 205, 194, 0.66)",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  statDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: "rgba(216, 163, 107, 0.12)",
  },
  visualBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 18,
    gap: 12,
  },
  aiBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(18, 15, 12, 0.84)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.34)",
  },
  aiBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 6,
    backgroundColor: "#D8A36B",
  },
  aiBadgeText: {
    ...Typography.caption,
    color: "#E7B97F",
    textTransform: "uppercase",
    letterSpacing: 1.8,
    fontWeight: "800",
  },
  matchBadge: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(9, 9, 9, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  matchBadgeText: {
    ...Typography.caption,
    color: "#F5F3EE",
    fontWeight: "800",
  },
  identityStrip: {
    flexDirection: "row",
    marginHorizontal: 18,
    marginTop: 18,
    padding: 14,
    borderRadius: 17,
    backgroundColor: "rgba(13, 13, 14, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.09)",
  },
  identityCell: {
    flex: 1,
    gap: 5,
    alignItems: "center",
  },
  identityLabel: {
    ...Typography.caption,
    color: "#8F96A3",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    fontWeight: "800",
  },
  identityValue: {
    ...Typography.caption,
    color: "#F5F3EE",
    fontWeight: "800",
  },
  garageShowcase: {
    flex: 1,
    justifyContent: "center",
  },
  garageImageCard: {
    height: "68%",
    minHeight: 178,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    backgroundColor: "rgba(12, 12, 12, 0.92)",
    shadowColor: "#000000",
    shadowOpacity: 0.34,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
  },
  garageImageCardBack: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 26,
    height: "55%",
    opacity: 0.46,
    transform: [{ translateY: 32 }, { scale: 0.96 }],
  },
  garageGhostTitle: {
    position: "absolute",
    left: 18,
    bottom: 20,
    ...Typography.caption,
    color: "rgba(245, 243, 238, 0.6)",
    fontWeight: "800",
  },
  garageCardCopy: {
    position: "absolute",
    left: 18,
    bottom: 18,
    gap: 3,
  },
  garagePanel: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  garageAtmosphereTop: {
    position: "absolute",
    top: 12,
    right: 24,
    width: 150,
    height: 150,
    borderRadius: 150,
    backgroundColor: "rgba(216, 163, 107, 0.08)",
  },
  garageAtmosphereBottom: {
    position: "absolute",
    bottom: 18,
    left: 18,
    width: 170,
    height: 170,
    borderRadius: 170,
    backgroundColor: "rgba(126, 93, 59, 0.1)",
  },
  garageGlow: {
    position: "absolute",
    width: 248,
    height: 248,
    borderRadius: 248,
    backgroundColor: "rgba(216, 163, 107, 0.08)",
    shadowColor: "#D8A36B",
    shadowOpacity: 0.12,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 0 },
  },
  garageStack: {
    width: "100%",
    maxWidth: 312,
    minHeight: 212,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  garageSupportCard: {
    position: "absolute",
    width: 194,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.16)",
    backgroundColor: "rgba(18, 17, 16, 0.9)",
    padding: 16,
    gap: 6,
    shadowColor: "#06111A",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },
  garageSupportBack: {
    top: 12,
    left: 70,
    opacity: 0.58,
    transform: [{ rotate: "-14deg" }, { scale: 0.98 }],
  },
  garageSupportLeft: {
    top: 42,
    left: -18,
    opacity: 0.72,
    transform: [{ rotate: "-10deg" }, { scale: 0.98 }],
  },
  garageSupportRight: {
    top: 26,
    right: -18,
    opacity: 0.72,
    transform: [{ rotate: "11deg" }, { scale: 0.98 }],
  },
  garagePrimaryCard: {
    width: "66%",
    maxWidth: 208,
    borderRadius: 22,
    borderWidth: 1,
    backgroundColor: "rgba(18, 17, 16, 0.96)",
    borderColor: "rgba(216, 163, 107, 0.18)",
    padding: 18,
    gap: 8,
    alignSelf: "center",
    zIndex: 4,
    shadowOpacity: 0.3,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 16 },
    transform: [{ translateY: 8 }, { scale: 1.01 }],
  },
  timelineYear: {
    ...Typography.caption,
    color: "#E7B97F",
  },
  timelineYearGhost: {
    color: "rgba(231, 185, 127, 0.78)",
  },
  timelineModel: {
    ...Typography.heading,
    color: "#F5F3EE",
    fontWeight: "700",
  },
  timelineModelGhost: {
    color: "rgba(245, 243, 238, 0.72)",
  },
  garageSupportMeta: {
    ...Typography.caption,
    color: "rgba(216, 233, 249, 0.74)",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  garagePrimaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  garageSavedChip: {
    position: "absolute",
    right: 18,
    bottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(34, 25, 18, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.18)",
  },
  garageSavedChipText: {
    ...Typography.caption,
    color: "#F0D3AE",
    fontWeight: "700",
  },
  garagePrimaryStat: {
    ...Typography.caption,
    color: "rgba(216, 233, 249, 0.74)",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  copyStack: {
    gap: 14,
    paddingTop: 6,
  },
  headline: {
    ...Typography.hero,
    color: "#F5F3EE",
    fontWeight: "800",
    textAlign: "left",
  },
  body: {
    ...Typography.body,
    color: "rgba(214, 205, 194, 0.78)",
    fontSize: 18,
    lineHeight: 27,
    maxWidth: 340,
  },
  footer: {
    marginTop: "auto",
    gap: 18,
    paddingTop: 10,
  },
  paginationRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
    marginBottom: 4,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(177, 196, 224, 0.26)",
  },
  paginationDotActive: {
    width: 28,
    backgroundColor: "#D8A36B",
  },
  primaryButton: {
    borderRadius: 999,
    overflow: "hidden",
  },
  primaryButtonGradient: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 230, 198, 0.18)",
  },
  primaryButtonLabel: {
    ...Typography.heading,
    color: "#080807",
    fontWeight: "800",
  },
  authRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingTop: 2,
    paddingBottom: 6,
  },
  authLink: {
    ...Typography.body,
    color: "rgba(231, 185, 127, 0.78)",
    fontWeight: "600",
  },
  authDivider: {
    ...Typography.body,
    color: "rgba(231, 185, 127, 0.34)",
  },
});
