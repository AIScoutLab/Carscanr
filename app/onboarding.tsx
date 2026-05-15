import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { APP_BRAND, ONBOARDING_STEPS, OnboardingVisualKind } from "@/lib/onboardingFlow";
import { getOnboardingLayoutMetrics } from "@/lib/onboardingLayout";
import { Radius, Typography } from "@/constants/theme";
import { startupPreferences } from "@/services/startupPreferences";

function CameraVisual() {
  const pulse = useRef(new Animated.Value(0.85)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const haloOpacity = useRef(new Animated.Value(0.16)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.85, duration: 1200, useNativeDriver: true }),
      ]),
    );
    const sweepLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(sweep, { toValue: 1, duration: 2600, useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(haloOpacity, { toValue: 0.22, duration: 1300, useNativeDriver: true }),
            Animated.timing(haloOpacity, { toValue: 0.16, duration: 1300, useNativeDriver: true }),
          ]),
        ]),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    sweepLoop.start();
    return () => {
      loop.stop();
      sweepLoop.stop();
    };
  }, [haloOpacity, pulse, sweep]);

  const sweepTranslateY = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-78, 78],
  });

  return (
    <View style={styles.visualShell}>
      <Animated.View style={[styles.scanHalo, { opacity: haloOpacity }]} />
      <View style={styles.scanFrame}>
        <View style={styles.scanCornerTL} />
        <View style={styles.scanCornerTR} />
        <View style={styles.scanCornerBL} />
        <View style={styles.scanCornerBR} />
        <Animated.View style={[styles.scanSweep, { transform: [{ translateY: sweepTranslateY }] }]} />
        <Animated.View style={[styles.scanPulse, { transform: [{ scale: pulse }] }]} />
      </View>
    </View>
  );
}

function InsightsVisual() {
  return (
    <View style={styles.visualShell}>
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
    </View>
  );
}

function GarageVisual() {
  return (
    <View style={styles.visualShell}>
      <View style={styles.garagePanel}>
        <View style={styles.garageAtmosphereTop} />
        <View style={styles.garageAtmosphereBottom} />
        <View style={styles.garageGlow} />
        <View style={styles.garageStack}>
          <View style={[styles.garageSupportCard, styles.garageSupportBack]}>
            <Text style={[styles.timelineYear, styles.timelineYearGhost]}>2021</Text>
            <Text style={[styles.timelineModel, styles.timelineModelGhost]}>Ford Explorer</Text>
            <Text style={styles.garageSupportMeta}>SUV • Saved</Text>
          </View>
          <View style={[styles.garageSupportCard, styles.garageSupportLeft]}>
            <Text style={[styles.timelineYear, styles.timelineYearGhost]}>2023</Text>
            <Text style={[styles.timelineModel, styles.timelineModelGhost]}>Toyota Highlander</Text>
            <Text style={styles.garageSupportMeta}>SUV • Nearby</Text>
          </View>
          <View style={[styles.garageSupportCard, styles.garageSupportRight]}>
            <Text style={[styles.timelineYear, styles.timelineYearGhost]}>2018</Text>
            <Text style={[styles.timelineModel, styles.timelineModelGhost]}>Honda Accord</Text>
            <Text style={styles.garageSupportMeta}>Sedan • Value</Text>
          </View>
          <View style={styles.garagePrimaryCard}>
            <View style={styles.garagePrimaryTopRow}>
              <Text style={styles.timelineYear}>2015</Text>
              <View style={styles.garageSavedChip}>
                <Ionicons name="bookmark" size={11} color="#7CE8FF" />
                <Text style={styles.garageSavedChipText}>Saved scan</Text>
              </View>
            </View>
            <Text style={styles.timelineModel}>Honda CR-V</Text>
            <Text style={styles.garagePrimaryStat}>SUV • 185 hp</Text>
          </View>
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
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    console.log("[onboarding] ONBOARDING_STARTED", { stepCount: ONBOARDING_STEPS.length });
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
      });
      await startupPreferences.markOnboardingComplete();
      router.replace(target as never);
    } catch (error) {
      console.error("[onboarding] failed to persist onboarding state", error);
    } finally {
      setSaving(false);
    }
  };

  const goToSlide = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * metrics.slideWidth, animated: true });
    setActiveIndex(index);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ x: activeIndex * metrics.slideWidth, animated: false });
  }, [activeIndex, metrics.slideWidth]);

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / metrics.slideWidth);
    setActiveIndex(nextIndex);
  };

  const nextAction = () => {
    if (activeIndex >= ONBOARDING_STEPS.length - 1) {
      void finishOnboarding("completed", "/(tabs)/scan");
      return;
    }
    goToSlide(activeIndex + 1);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <LinearGradient colors={["#06111C", "#071625", "#030711"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
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
            <View style={styles.brandIcon}>
              <Image source={require("../Icon.png")} style={styles.brandIconImage} />
            </View>
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
            ref={scrollRef}
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
            <LinearGradient colors={["#1C61E8", "#2C86FF", "#60DDFF"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[styles.primaryButtonGradient, { minHeight: metrics.ctaMinHeight }]}>
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
    backgroundColor: "#04101A",
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
    backgroundColor: "rgba(26, 128, 246, 0.16)",
  },
  ambientOrbBottom: {
    position: "absolute",
    bottom: 120,
    left: -34,
    width: 180,
    height: 180,
    borderRadius: 180,
    backgroundColor: "rgba(80, 224, 255, 0.08)",
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
    width: 42,
    height: 42,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12, 27, 44, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(103, 226, 255, 0.12)",
    shadowColor: "#39CFFF",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  brandIconImage: {
    width: "100%",
    height: "100%",
    borderRadius: 14,
  },
  brandName: {
    ...Typography.heading,
    color: "#F6FBFF",
    fontWeight: "800",
  },
  brandTagline: {
    ...Typography.caption,
    color: "rgba(224, 236, 250, 0.62)",
  },
  skipLabel: {
    ...Typography.body,
    color: "rgba(229, 238, 251, 0.78)",
    fontWeight: "600",
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
  visualShell: {
    flex: 1,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: "rgba(113, 154, 220, 0.14)",
    backgroundColor: "rgba(8, 17, 28, 0.78)",
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
    backgroundColor: "rgba(29, 93, 193, 0.16)",
  },
  scanFrame: {
    alignSelf: "center",
    width: "78%",
    aspectRatio: 1,
    maxWidth: 240,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(119, 232, 255, 0.2)",
    backgroundColor: "rgba(5, 12, 22, 0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  scanSweep: {
    position: "absolute",
    width: "74%",
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(115, 232, 255, 0.12)",
    shadowColor: "#75E7FF",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  scanPulse: {
    width: 92,
    height: 92,
    borderRadius: 92,
    backgroundColor: "rgba(96, 220, 255, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(124, 234, 255, 0.34)",
  },
  scanCornerTL: {
    position: "absolute",
    top: 18,
    left: 18,
    width: 28,
    height: 28,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: "#79E6FF",
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
    borderColor: "#79E6FF",
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
    borderColor: "#79E6FF",
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
    borderColor: "#79E6FF",
    borderBottomRightRadius: 10,
  },
  insightPanel: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(98, 147, 248, 0.14)",
    backgroundColor: "rgba(9, 20, 35, 0.94)",
    padding: 24,
    gap: 18,
  },
  panelEyebrow: {
    ...Typography.caption,
    color: "#80B8FF",
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  panelTitle: {
    ...Typography.heading,
    color: "#F4FAFF",
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
    color: "#66DEFF",
    fontWeight: "800",
  },
  statLabel: {
    ...Typography.caption,
    color: "rgba(225, 236, 250, 0.62)",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  statDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: "rgba(110, 144, 199, 0.16)",
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
    backgroundColor: "rgba(56, 163, 255, 0.08)",
  },
  garageAtmosphereBottom: {
    position: "absolute",
    bottom: 18,
    left: 18,
    width: 170,
    height: 170,
    borderRadius: 170,
    backgroundColor: "rgba(88, 224, 255, 0.07)",
  },
  garageGlow: {
    position: "absolute",
    width: 248,
    height: 248,
    borderRadius: 248,
    backgroundColor: "rgba(52, 127, 243, 0.08)",
    shadowColor: "#2D77EE",
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
    borderColor: "rgba(120, 182, 255, 0.16)",
    backgroundColor: "rgba(12, 24, 40, 0.9)",
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
    backgroundColor: "rgba(10, 20, 34, 0.96)",
    borderColor: "rgba(131, 191, 255, 0.16)",
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
    color: "#83BAFF",
  },
  timelineYearGhost: {
    color: "rgba(131, 186, 255, 0.78)",
  },
  timelineModel: {
    ...Typography.heading,
    color: "#F5FAFF",
    fontWeight: "700",
  },
  timelineModelGhost: {
    color: "rgba(245, 250, 255, 0.72)",
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
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(23, 53, 83, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(124, 212, 255, 0.14)",
  },
  garageSavedChipText: {
    ...Typography.caption,
    color: "#D8F6FF",
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
    color: "#F7FBFF",
    fontWeight: "800",
    textAlign: "left",
  },
  body: {
    ...Typography.body,
    color: "rgba(225, 236, 249, 0.78)",
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
    backgroundColor: "#69DEFF",
  },
  primaryButton: {
    borderRadius: 999,
    overflow: "hidden",
  },
  primaryButtonGradient: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(182, 244, 255, 0.18)",
  },
  primaryButtonLabel: {
    ...Typography.heading,
    color: "#FFFFFF",
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
    color: "rgba(227, 238, 252, 0.62)",
    fontWeight: "600",
  },
  authDivider: {
    ...Typography.body,
    color: "rgba(227, 238, 252, 0.3)",
  },
});
