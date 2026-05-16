import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AppContainer } from "@/components/AppContainer";
import { BrandMark } from "@/components/BrandMark";
import { BRAND_MARK_LAYOUT } from "@/constants/branding";
import { EmptyState } from "@/components/EmptyState";
import { ErrorStateCard } from "@/components/ErrorStateCard";
import { FeatureRow } from "@/components/FeatureRow";
import { PaywallCard } from "@/components/PaywallCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { PremiumCard } from "@/components/PremiumCard";
import { RecentScanCard } from "@/components/RecentScanCard";
import { SamplePhotoPickerSheet } from "@/components/SamplePhotoPickerSheet";
import { ScanUsageMeter } from "@/components/ScanUsageMeter";
import { SectionHeader } from "@/components/SectionHeader";
import { Colors, Motion, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";
import { APP_BRAND } from "@/lib/onboardingFlow";
import { mobileBuildInfo, mobileEnv } from "@/lib/env";
import {
  getCameraPermissionState,
  getLibraryPermissionState,
  getSampleScanPhotos,
  launchLibraryForScan,
  optimizeScanImage,
  requestLibraryPermission,
  SelectedScanPhoto,
} from "@/features/scan/useScanActions";
import { useSubscription } from "@/hooks/useSubscription";
import { getNextScanLoadingFactIndex, getRandomScanLoadingFactIndex, SCAN_LOADING_FACTS } from "@/lib/scanLoadingFacts";
import { isProPlan } from "@/lib/subscription";
import { SCAN_LOADING_STAGES, getScanLoadingStageState } from "@/lib/scanLoadingStages";
import { supabase } from "@/lib/supabase";
import { ApiRequestError } from "@/services/apiClient";
import { authService } from "@/services/authService";
import { scanService } from "@/services/scanService";
import { ScanResult } from "@/types";

type DebugStatus =
  | "Idle"
  | "Requesting camera permission"
  | "Opening camera"
  | "Requesting photo library permission"
  | "Opening photo library"
  | "Photo selected"
  | "Optimizing image"
  | "Preparing upload"
  | "Uploading image"
  | "Identifying vehicle..."
  | "Waiting for identification"
  | "Waking backend, please wait..."
  | "Identify succeeded"
  | "Opening result"
  | "Navigation to result"
  | `Scan failed: ${string}`;

export default function ScanScreen() {
  const IDENTIFY_TIMEOUT_MS = 60000;
  const [recentScans, setRecentScans] = useState<ScanResult[]>([]);
  const [recentScansDiagnostics, setRecentScansDiagnostics] = useState(() => scanService.getRecentScansDiagnostics());
  const [samplePickerOpen, setSamplePickerOpen] = useState(false);
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null);
  const [cameraPermissionReady, setCameraPermissionReady] = useState<boolean | null>(null);
  const [libraryPermissionReady, setLibraryPermissionReady] = useState<boolean | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [debugStatus, setDebugStatus] = useState<DebugStatus>("Idle");
  const [debugDetails, setDebugDetails] = useState<string[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [retryImageUri, setRetryImageUri] = useState<string | null>(null);
  const [retrySource, setRetrySource] = useState<"camera" | "library" | "sample" | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [sessionDetected, setSessionDetected] = useState(false);
  const [tokenPresent, setTokenPresent] = useState(false);
  const lastFocusRefreshAtRef = useRef(0);
  const scanStartedAtRef = useRef<number | null>(null);
  const lastStageAtRef = useRef<number | null>(null);
  const pendingIdentifyStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFlowIdRef = useRef(0);
  const stagedProgress = useRef(new Animated.Value(0)).current;
  const factOpacity = useRef(new Animated.Value(1)).current;
  const { status: usage, freeUnlocksUsed, freeUnlocksRemaining, freeUnlocksLimit, refreshStatus } = useSubscription();
  const samplePhotos = getSampleScanPhotos();
  const [loadingStageIndex, setLoadingStageIndex] = useState(0);
  const [activeFactIndex, setActiveFactIndex] = useState(0);
  const shouldShowRecentScansDiagnostics =
    __DEV__ ||
    (mobileEnv.appEnv !== "production" &&
      ["1", "true", "yes", "on"].includes(mobileEnv.showQaDebug.trim().toLowerCase()));
  const visibleBuildStamp = `Build ${mobileBuildInfo.version || "unknown"} • ${mobileBuildInfo.gitCommit ? mobileBuildInfo.gitCommit.slice(0, 7) : "unknown"}`;

  const syncRecentScansState = useCallback((scans: ScanResult[]) => {
    setRecentScans(scans);
    setRecentScansDiagnostics(scanService.getRecentScansDiagnostics());
  }, []);

  const resetTransientScanState = useCallback(() => {
    activeFlowIdRef.current += 1;
    if (pendingIdentifyStatusTimerRef.current) {
      clearTimeout(pendingIdentifyStatusTimerRef.current);
      pendingIdentifyStatusTimerRef.current = null;
    }
    setIsBusy(false);
    setLoadingSampleId(null);
    setSamplePickerOpen(false);
    setScanError(null);
    setRetryImageUri(null);
    setRetrySource(null);
    setDebugStatus("Idle");
    setDebugDetails([]);
  }, []);

  useEffect(() => {
    scanService.getRecentScans({ forceRefresh: true }).then(syncRecentScansState);
    const unsubscribe = scanService.subscribeRecentScans(syncRecentScansState);
    return unsubscribe;
  }, [syncRecentScansState]);

  useEffect(() => () => {
    if (pendingIdentifyStatusTimerRef.current) {
      clearTimeout(pendingIdentifyStatusTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isBusy || !retryImageUri) {
      setLoadingStageIndex(0);
      stagedProgress.stopAnimation();
      stagedProgress.setValue(0);
      return;
    }
    const derived = getScanLoadingStageState(debugStatus);
    setLoadingStageIndex((current) => Math.max(current, derived.stageIndex));
  }, [debugStatus, isBusy, retryImageUri, stagedProgress]);

  useEffect(() => {
    if (!isBusy || !retryImageUri) {
      return;
    }
    const progressRatio = (loadingStageIndex + 1) / SCAN_LOADING_STAGES.length;
    console.log("[scan-loading-ui] progressStage", {
      componentName: "ScanScreenLoadingState",
      route: "/(tabs)/scan",
      stageIndex: loadingStageIndex,
      stageLabel: SCAN_LOADING_STAGES[loadingStageIndex],
    });
    Animated.timing(stagedProgress, {
      toValue: progressRatio,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [isBusy, loadingStageIndex, retryImageUri, stagedProgress]);

  useEffect(() => {
    if (!isBusy || !retryImageUri) {
      factOpacity.stopAnimation();
      factOpacity.setValue(1);
      setActiveFactIndex(0);
      return;
    }

    console.log("[scan-loading-ui] scannerAnimationMounted", {
      componentName: "ScanScreenLoadingState",
      route: "/(tabs)/scan",
    });
    setActiveFactIndex((current) => (current === 0 ? getRandomScanLoadingFactIndex() : current));

    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(factOpacity, {
          toValue: 0,
          duration: 240,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(factOpacity, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
      setActiveFactIndex((current) => getNextScanLoadingFactIndex(current));
    }, 4200);

    return () => {
      clearInterval(interval);
      factOpacity.stopAnimation();
      factOpacity.setValue(1);
    };
  }, [factOpacity, isBusy, retryImageUri]);

  useEffect(() => {
    if (!isBusy || !retryImageUri || scanError) {
      return;
    }
    console.log("[scan-loading-ui] ACTIVE_SCAN_LOADING_SCREEN", {
      componentName: "ScanScreenLoadingState",
      route: "/(tabs)/scan",
      stagedProgress: true,
    });
  }, [isBusy, retryImageUri, scanError]);

  useEffect(() => {
    const preloadPermissions = async () => {
      try {
        const [camera, library] = await Promise.all([getCameraPermissionState(), getLibraryPermissionState()]);
        setCameraPermissionReady(camera.granted);
        setLibraryPermissionReady(library.granted);
        console.log("[scan] preloaded permissions", {
          cameraGranted: camera.granted,
          libraryGranted: library.granted,
          libraryAccessPrivileges: library.accessPrivileges,
        });
      } catch (error) {
        console.error("[scan] failed to preload permissions", error);
      }
    };

    preloadPermissions().catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      resetTransientScanState();
      Promise.all([supabase.auth.getSession(), authService.getCurrentUser()])
        .then(([{ data }, currentUser]) => {
          const session = data.session;
          setSignedIn(Boolean(currentUser));
          setSessionDetected(Boolean(session));
          setTokenPresent(Boolean(session?.access_token));
        })
        .catch(() => {
          setSignedIn(false);
          setSessionDetected(false);
          setTokenPresent(false);
        });
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current > 15000) {
        lastFocusRefreshAtRef.current = now;
        refreshStatus().catch(() => undefined);
      }
      scanService.getRecentScans({ forceRefresh: true }).then(syncRecentScansState).catch(() => undefined);
      return () => {
        resetTransientScanState();
      };
    }, [refreshStatus, resetTransientScanState, syncRecentScansState]),
  );

  const routeToResult = (result: ScanResult) => {
    try {
      console.log("[RESULT_NAVIGATION]", { resultSource: "fresh_api", scanId: result.id });
      setDebugStatus("Opening result");
      recordStage("navigation start", { scanId: result.id, imageUri: result.imageUri });
      appendDebugDetail("result params", { scanId: result.id, imageUri: result.imageUri });
      console.log("[scan] navigating to result", {
        scanId: result.id,
        imageUri: result.imageUri,
        candidateCount: result.candidates.length,
      });
      setDebugStatus("Navigation to result");
      router.push({ pathname: "/scan/result", params: { scanId: result.id, imageUri: result.imageUri, resultSource: "fresh_api" } });
    } catch (error) {
      failScan(error instanceof Error ? error.message : "Result navigation failed.");
    }
  };

  const scansUsed = usage?.scansUsed ?? usage?.scansUsedToday ?? 0;
  const showUpgradeCard = !isProPlan(usage?.plan) && freeUnlocksRemaining <= 1;
  const showSoftUpsell = usage?.plan === "free" && freeUnlocksRemaining <= 2;

  const appendDebugDetail = useCallback((label: string, value: unknown) => {
    const formatted = typeof value === "string" ? value : JSON.stringify(value);
    setDebugDetails((current) => [...current.slice(-6), `${label}: ${formatted}`]);
  }, []);

  const isFlowActive = useCallback((flowId: number) => activeFlowIdRef.current === flowId, []);

  const recordStage = useCallback(
    (label: string, payload?: unknown, flowId?: number) => {
      if (typeof flowId === "number" && activeFlowIdRef.current !== flowId) {
        return;
      }
      const now = Date.now();
      const startedAt = scanStartedAtRef.current ?? now;
      const lastStageAt = lastStageAtRef.current ?? startedAt;
      const totalMs = now - startedAt;
      const deltaMs = now - lastStageAt;
      lastStageAtRef.current = now;
      const detail = payload === undefined ? `${label} (+${totalMs}ms, Δ${deltaMs}ms)` : `${label} (+${totalMs}ms, Δ${deltaMs}ms): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`;
      console.log("[scan-stage]", detail);
      setDebugDetails((current) => [...current.slice(-7), detail]);
    },
    [],
  );

  const clearPendingIdentifyTimer = useCallback(() => {
    if (pendingIdentifyStatusTimerRef.current) {
      clearTimeout(pendingIdentifyStatusTimerRef.current);
      pendingIdentifyStatusTimerRef.current = null;
    }
  }, []);

  const startFlow = useCallback((source: string) => {
    activeFlowIdRef.current += 1;
    const flowId = activeFlowIdRef.current;
    const now = Date.now();
    clearPendingIdentifyTimer();
    scanStartedAtRef.current = now;
    lastStageAtRef.current = now;
    setIsBusy(true);
    setScanError(null);
    setLoadingSampleId(null);
    setDebugDetails([`flow source: ${source}`]);
    return flowId;
  }, [clearPendingIdentifyTimer]);

  const beginIdentifyPendingStatus = useCallback((flowId: number) => {
    clearPendingIdentifyTimer();
    pendingIdentifyStatusTimerRef.current = setTimeout(() => {
      if (!isFlowActive(flowId)) {
        return;
      }
      setDebugStatus("Waiting for identification");
      recordStage("waiting for identification", undefined, flowId);
    }, 1200);
  }, [clearPendingIdentifyTimer, isFlowActive, recordStage]);

  const failScan = useCallback((message: string, flowId?: number) => {
    if (typeof flowId === "number" && activeFlowIdRef.current !== flowId) {
      return;
    }
    console.log("[scan] flow failed", message);
    clearPendingIdentifyTimer();
    setIsBusy(false);
    setScanError(message);
    setDebugStatus(`Scan failed: ${message}`);
    recordStage("scan failed", message, flowId);
    if (typeof flowId === "number" && activeFlowIdRef.current === flowId) {
      activeFlowIdRef.current += 1;
    }
  }, [clearPendingIdentifyTimer, recordStage]);

  const runIdentifyFlow = useCallback(
    async (selection: SelectedScanPhoto, source: "camera" | "library" | "sample", flowId: number) => {
      if (!isFlowActive(flowId)) {
        return;
      }
      appendDebugDetail("picker response", selection);
      if (selection.canceled) {
        if (!isFlowActive(flowId)) {
          return;
        }
        setIsBusy(false);
        setDebugStatus("Scan failed: Photo selection was canceled.");
        recordStage("picker canceled", source, flowId);
        appendDebugDetail("picker canceled", source);
        activeFlowIdRef.current += 1;
        return;
      }

      if (!selection.assetExists || !selection.cachedUri) {
        failScan("No photo was returned from the picker.", flowId);
        return;
      }

      recordStage("photo selected", {
        source,
        uri: selection.cachedUri,
        mimeType: selection.mimeType,
        fileSize: selection.fileSize,
      }, flowId);
      setRetryImageUri(selection.cachedUri);
      setRetrySource(source);
      setScanError(null);
      setDebugStatus("Photo selected");
      appendDebugDetail("asset uri", selection.cachedUri);
      appendDebugDetail("mime type", selection.mimeType ?? "missing");
      appendDebugDetail("file size", selection.fileSize ?? "unknown");

      try {
        setDebugStatus("Optimizing image");
        recordStage("optimization start", {
          width: selection.width,
          height: selection.height,
          fileSize: selection.fileSize,
        }, flowId);
        const optimizedSelection = source === "sample" ? selection : await optimizeScanImage(selection);
        if (!isFlowActive(flowId)) {
          return;
        }
        recordStage("optimization end", {
          cachedUri: optimizedSelection.cachedUri,
          fileSize: optimizedSelection.fileSize,
          width: optimizedSelection.width,
          height: optimizedSelection.height,
        }, flowId);
        setRetryImageUri(optimizedSelection.cachedUri);
        setDebugStatus("Preparing upload");
        recordStage("preparing upload", { source }, flowId);
        setDebugStatus("Uploading image");
        beginIdentifyPendingStatus(flowId);
        const result = await scanService.identifyVehicle(optimizedSelection.cachedUri!, {
          timeoutMs: IDENTIFY_TIMEOUT_MS,
          forceFreshRequest: true,
          onStage: (stage, payload) => {
            if (!isFlowActive(flowId)) {
              return;
            }
            if (stage === "health wake-up start") {
              setDebugStatus("Waking backend, please wait...");
            }
            if (stage === "form-data creation start") {
              setDebugStatus("Preparing upload");
            }
            if (stage === "identify request start") {
              setDebugStatus("Identifying vehicle...");
            }
            if (stage === "identify request success") {
              clearPendingIdentifyTimer();
            }
            recordStage(stage, payload, flowId);
          },
        });
        if (!isFlowActive(flowId)) {
          return;
        }
        clearPendingIdentifyTimer();
        setDebugStatus("Identify succeeded");
        recordStage("identify succeeded", { scanId: result.id, candidateCount: result.candidates.length }, flowId);
        setRecentScans((current) => [result, ...current.filter((entry) => entry.id !== result.id)].slice(0, 6));
        setIsBusy(false);
        routeToResult(result);
      } catch (error) {
        const message =
          error instanceof ApiRequestError && error.code === "AUTH_REQUIRED"
            ? "Guest scanning should be available, but this request still asked for sign-in. Please try again."
            : error instanceof ApiRequestError && error.code === "SCAN_LIMIT_REACHED"
              ? "Basic scans should remain available. Please try again."
            : error instanceof ApiRequestError && error.code === "BACKEND_WAKE_TIMEOUT"
              ? "Waking backend, please wait, then try again."
            : error instanceof ApiRequestError && error.code === "REQUEST_TIMEOUT"
              ? "Identification timed out. Please try again."
            : error instanceof ApiRequestError
              ? error.message
              : error instanceof Error
                ? error.message
                : "We couldn’t identify that vehicle right now.";
        console.log("[scan] SCAN_BLOCKED_REASON", {
          source,
          code: error instanceof ApiRequestError ? error.code : undefined,
          message,
        });
        failScan(message, flowId);
      }
    },
    [appendDebugDetail, beginIdentifyPendingStatus, clearPendingIdentifyTimer, failScan, isFlowActive, recordStage],
  );

  const beginLibraryScan = async () => {
    console.log("[SCAN_ENTRY]", { file: "app/(tabs)/scan.tsx", action: "library_pick", imageUri: null, forceFreshRequest: true });
    console.log("[tap] scan-library");
    scanService.beginNewScanFlow({ source: "library", route: "/(tabs)/scan" });
    console.log("[scan] LIBRARY_SCAN_GATE_CHECK", {
      allowed: true,
      reason: "basic-scan-always-allowed",
      freeUnlocksRemaining,
      freeUnlocksUsed,
    });
    const flowId = startFlow("library");
    console.log("[scan] PHOTO_PICK_START", { flowId, source: "library" });
    recordStage("tap received", "library", flowId);
    setDebugStatus("Requesting photo library permission");

    try {
      recordStage("permission request start", undefined, flowId);
      const currentPermission = await getLibraryPermissionState();
      if (!isFlowActive(flowId)) {
        return;
      }
      appendDebugDetail("library permission before", currentPermission);
      const permission = currentPermission.granted ? currentPermission : await requestLibraryPermission();
      if (!isFlowActive(flowId)) {
        return;
      }
      recordStage("permission request end", permission, flowId);
      appendDebugDetail("library permission after", permission);
      setLibraryPermissionReady(permission.granted);

      if (!permission.granted) {
        failScan("Photo library access is disabled. Enable it in Settings to continue.", flowId);
        return;
      }

      setDebugStatus("Opening photo library");
      recordStage("launchImageLibraryAsync start", undefined, flowId);
      const selection = await launchLibraryForScan();
      if (!isFlowActive(flowId)) {
        return;
      }
      console.log("[scan] PHOTO_PICK_SUCCESS", {
        flowId,
        canceled: selection.canceled,
        assetExists: selection.assetExists,
        cachedUri: selection.cachedUri,
      });
      recordStage("launchImageLibraryAsync resolved", {
        canceled: selection.canceled,
        assetExists: selection.assetExists,
      }, flowId);
      recordStage("asset extraction end", {
        cachedUri: selection.cachedUri,
        fileSize: selection.fileSize,
        width: selection.width,
        height: selection.height,
      }, flowId);
      setSamplePickerOpen(false);
      await runIdentifyFlow(selection, "library", flowId);
    } catch (error) {
      setSamplePickerOpen(false);
      failScan(error instanceof Error ? error.message : "We couldn’t open your photo library.", flowId);
    }
  };

  const beginScan = async (source: "camera" | "library") => {
    console.log("[SCAN_ENTRY]", { file: "app/(tabs)/scan.tsx", action: source, imageUri: null, forceFreshRequest: true });
    console.log("[tap] begin-scan", { source, freeUnlocksRemaining });
    if (source === "library") {
      scanService.beginNewScanFlow({ source: "library", route: "/(tabs)/scan" });
      setScanError(null);
      setDebugStatus("Idle");
      setDebugDetails([]);
      setSamplePickerOpen(true);
      return;
    }

    console.log("[tap] scan-camera");
    scanService.beginNewScanFlow({ source: "camera", route: "/(tabs)/scan" });
    router.push("/scan/camera");
  };

  const beginSampleScan = async (sampleId: string) => {
    let flowId = 0;
    try {
      console.log("[SCAN_ENTRY]", { file: "app/(tabs)/scan.tsx", action: "sample", imageUri: sampleId, forceFreshRequest: true });
      console.log("[tap] begin-sample-scan", { sampleId, freeUnlocksRemaining });
      scanService.beginNewScanFlow({ source: "sample", route: "/(tabs)/scan" });
      flowId = startFlow(`sample:${sampleId}`);
      setLoadingSampleId(sampleId);
      recordStage("tap received", `sample:${sampleId}`, flowId);
      setDebugStatus("Photo selected");
      if (!isFlowActive(flowId)) {
        return;
      }
      recordStage("sample metadata ready", sampleId, flowId);
      setSamplePickerOpen(false);
      setDebugStatus("Identify succeeded");
      recordStage("sample bypass start", { sampleId }, flowId);
      const result = await scanService.createSampleResult(sampleId);
      if (!isFlowActive(flowId)) {
        return;
      }
      recordStage("sample bypass complete", { scanId: result.id, vehicleId: result.identifiedVehicle.id || null }, flowId);
      routeToResult(result);
    } catch (error) {
      failScan(error instanceof Error ? error.message : "We couldn’t prepare that sample vehicle photo.", flowId || undefined);
    } finally {
      setLoadingSampleId(null);
    }
  };

  const retryScan = async () => {
    if (!retryImageUri || !retrySource) {
      return;
    }

    const flowId = startFlow(`retry:${retrySource}`);
    recordStage("retry requested", retrySource, flowId);
    await runIdentifyFlow(
      {
        canceled: false,
        assetExists: true,
        originalUri: retryImageUri,
        cachedUri: retryImageUri,
        mimeType: "image/jpeg",
        fileName: retryImageUri.split("/").pop() ?? `retry-${Date.now()}.jpg`,
        fileSize: null,
        width: null,
        height: null,
      },
      retrySource,
      flowId,
    );
  };

  if (isBusy && retryImageUri && !scanError) {
    const stageState = getScanLoadingStageState(debugStatus);
    const loadingProgressWidth = stagedProgress.interpolate({
      inputRange: [0, 1],
      outputRange: ["16%", "100%"],
    });
    const shimmerTranslate = stagedProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [-160, 290],
    });

    return (
      <AppContainer scroll={false} contentContainerStyle={styles.loadingScreen}>
        <PremiumCard variant="glass" contentStyle={styles.loadingHeroFrame}>
          <Image source={{ uri: retryImageUri }} style={styles.loadingHeroImage} resizeMode="contain" />
        </PremiumCard>
        <PremiumCard variant="glass" contentStyle={styles.loadingCopyCard}>
          <Text style={styles.loadingTitle}>Scanning your vehicle</Text>
          <Text style={styles.loadingBody}>{stageState.stageLabel}</Text>
          <View style={styles.loadingProgressTrack}>
            <Animated.View style={[styles.loadingProgressGlow, { width: loadingProgressWidth }]} />
            <Animated.View style={[styles.loadingProgressFillWrap, { width: loadingProgressWidth }]}>
              <LinearGradient
                colors={["#1B63F3", "#49D9FF", "#F7FDFF"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.loadingProgressFill}
              >
                <Animated.View style={[styles.loadingProgressShimmer, { transform: [{ translateX: shimmerTranslate }] }]} />
              </LinearGradient>
            </Animated.View>
          </View>
          <View style={styles.loadingStageMetaRow}>
            <Text style={styles.loadingStageStep}>
              Step {Math.min(loadingStageIndex + 1, SCAN_LOADING_STAGES.length)} of {SCAN_LOADING_STAGES.length}
            </Text>
            <Text style={styles.loadingStageLabel}>{stageState.stageLabel}</Text>
          </View>
          <Animated.Text style={[styles.loadingFact, { opacity: factOpacity }]}>
            {SCAN_LOADING_FACTS[activeFactIndex]}
          </Animated.Text>
        </PremiumCard>
      </AppContainer>
    );
  }

  return (
    <AppContainer>
      <PremiumCard variant="hero" glow contentStyle={styles.brandHero}>
        <View style={styles.brandHeroRow}>
          <BrandMark
            size={BRAND_MARK_LAYOUT.scanHero.size}
            contentScale={BRAND_MARK_LAYOUT.scanHero.contentScale}
            style={styles.brandIconWrap}
            resizeMode="contain"
          />
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>{APP_BRAND.name}</Text>
            <Text style={styles.brandTagline}>{APP_BRAND.tagline}</Text>
          </View>
        </View>
        <Text style={styles.brandSupport}>Use manual search or scan a vehicle when you want details instantly.</Text>
        <FeatureRow
          items={[
            { icon: "scan-outline", label: "Instant AI identification" },
            { icon: "car-sport-outline", label: "Recent scans saved" },
            { icon: "analytics-outline", label: "Value and listings on demand" },
          ]}
        />
      </PremiumCard>
      {usage ? (
        <ScanUsageMeter
          status={usage}
          mode="unlocks"
          unlocksUsed={freeUnlocksUsed}
          unlocksRemaining={freeUnlocksRemaining}
          unlocksLimit={freeUnlocksLimit}
          supportingText="Unlimited basic scans stay free. Unlock full details only when you want them."
          ctaLabel="Go Pro"
          onCtaPress={() => {
            console.log("[tap] usage-meter-go-pro");
            router.push("/paywall");
          }}
        />
      ) : null}
      {scanError ? (
        <ErrorStateCard
          title="Scan failed"
          description={scanError}
          actionLabel="Retry Last Photo"
          onAction={() => retryScan().catch(() => undefined)}
        />
      ) : null}
      <PremiumCard variant="default" glow contentStyle={styles.scanCard}>
        <Pressable style={({ pressed }) => [styles.cameraButton, pressed && styles.cameraPressed]} onPress={() => beginScan("camera")} disabled={isBusy}>
          <LinearGradient colors={["#0A72E8", "#1D8CFF", "#5EE7FF"]} style={styles.cameraGradient}>
            <Text style={styles.cameraButtonLabel}>{isBusy ? "Analyzing..." : "Scan Vehicle"}</Text>
          </LinearGradient>
        </Pressable>
        <PrimaryButton label={isBusy ? "Analyzing..." : "Choose From Photos"} secondary onPress={() => beginScan("library")} disabled={isBusy} />
      </PremiumCard>
      {showSoftUpsell || showUpgradeCard ? (
        <PaywallCard
          status={usage}
          unlocksUsed={freeUnlocksUsed}
          unlocksRemaining={freeUnlocksRemaining}
          unlocksLimit={freeUnlocksLimit}
          title="Unlock deeper vehicle insights"
          description="Scans stay free. Pro unlocks full specs, value, listings, and pricing guidance when you want more detail."
          ctaLabel="Explore Pro"
          onCtaPress={() => {
            console.log("[tap] scan-upgrade-prompt");
            router.push("/paywall");
          }}
          showCreditBadge={false}
          usageLabelOverride={
            freeUnlocksRemaining > 0
              ? `${freeUnlocksRemaining} free unlock${freeUnlocksRemaining === 1 ? "" : "s"} remaining`
              : "No free unlocks remaining"
          }
        />
      ) : null}
      <SectionHeader title="Recent scans" subtitle="Jump back into the vehicles you’ve already scanned." />
      {recentScans.length === 0 ? (
        <EmptyState
          title="No recent scans yet"
          description="Scan a VIN or vehicle photo to see your vehicle history here."
        />
      ) : (
        recentScans.map((scan) => (
          <RecentScanCard
            key={scan.id}
            scan={scan}
            onPress={() => {
              if (typeof scan.id === "string" && scan.id.length > 0) {
                console.log("[tap] recent-scan-open", { scanId: scan.id });
                console.log("[RESULT_NAVIGATION]", { resultSource: "persisted", scanId: scan.id });
                router.push({ pathname: "/scan/result", params: { scanId: scan.id, resultSource: "persisted" } });
              }
            }}
          />
        ))
      )}
      {shouldShowRecentScansDiagnostics ? (
        <PremiumCard style={styles.recentDiagnosticsCard}>
          <Text style={styles.recentDiagnosticsEyebrow}>Recent Scans Diagnostics</Text>
          <Text style={styles.recentDiagnosticsLine}>Storage key: {recentScansDiagnostics.currentStorageKey ?? "unresolved"}</Text>
          <Text style={styles.recentDiagnosticsLine}>Mirror key: {recentScansDiagnostics.mirrorStorageKey}</Text>
          <Text style={styles.recentDiagnosticsLine}>Loaded count: {recentScansDiagnostics.lastLoadedCount}</Text>
          <Text style={styles.recentDiagnosticsLine}>Saved count: {recentScansDiagnostics.lastSavedCount}</Text>
          <Text style={styles.recentDiagnosticsLine}>Last vehicle: {recentScansDiagnostics.lastSavedLabel ?? "none"}</Text>
          <Text style={styles.recentDiagnosticsLine}>Last save error: {recentScansDiagnostics.lastSaveError ?? "none"}</Text>
        </PremiumCard>
      ) : null}
      <SamplePhotoPickerSheet
        visible={samplePickerOpen}
        samples={samplePhotos}
        loadingSampleId={loadingSampleId}
        onClose={() => {
          if (!loadingSampleId) {
            setSamplePickerOpen(false);
            if (!isBusy) {
              setDebugStatus("Idle");
            }
          }
        }}
        onOpenLibrary={() => {
          beginLibraryScan().catch(() => undefined);
        }}
        onSelectSample={(sampleId) => {
          beginSampleScan(sampleId).catch(() => undefined);
        }}
      />
      <View style={styles.buildStampRow}>
        <Text style={styles.buildStampText}>{visibleBuildStamp}</Text>
      </View>
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  brandHero: {
    padding: 18,
    gap: 14,
  },
  brandHeroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandIconWrap: {
    backgroundColor: "rgba(17, 42, 70, 0.24)",
  },
  brandCopy: {
    flex: 1,
    gap: 2,
  },
  brandName: {
    ...Typography.heading,
    color: Colors.textStrong,
    fontWeight: "800",
  },
  brandTagline: {
    ...Typography.body,
    color: Colors.textStrong,
    fontWeight: "700",
  },
  brandSupport: {
    ...Typography.body,
    color: Colors.textSoft,
  },
  scanCard: { gap: 14, padding: 18 },
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
  buildStampRow: {
    alignItems: "center",
    paddingTop: 6,
    paddingBottom: 2,
  },
  buildStampText: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  loadingScreen: { flex: 1, gap: 16 },
  recentDiagnosticsCard: {
    gap: 6,
    padding: 16,
  },
  recentDiagnosticsEyebrow: {
    ...Typography.caption,
    color: Colors.accent,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  recentDiagnosticsLine: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  loadingHeroFrame: {
    width: "100%",
    height: 360,
    padding: 0,
  },
  loadingHeroImage: {
    width: "100%",
    height: "100%",
  },
  loadingCopyCard: {
    padding: 18,
    gap: 14,
    alignItems: "flex-start",
  },
  loadingTitle: { ...Typography.heading, color: Colors.textStrong },
  loadingBody: { ...Typography.body, color: Colors.textSoft },
  loadingStageMetaRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  loadingStageStep: { ...Typography.caption, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.8 },
  loadingStageLabel: { ...Typography.bodyStrong, color: Colors.textSoft, flexShrink: 1, textAlign: "right" },
  loadingProgressTrack: {
    width: "100%",
    height: 18,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(255,255,255,0.07)",
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(83, 222, 255, 0.16)",
  },
  loadingProgressGlow: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(83, 222, 255, 0.22)",
    shadowColor: "#61E8FF",
    shadowOpacity: 0.34,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  loadingProgressFillWrap: {
    height: "100%",
    borderRadius: Radius.pill,
    overflow: "hidden",
  },
  loadingProgressFill: {
    flex: 1,
    borderRadius: Radius.pill,
    justifyContent: "center",
    overflow: "hidden",
  },
  loadingProgressShimmer: {
    width: 72,
    height: "200%",
    backgroundColor: "rgba(255,255,255,0.38)",
    borderRadius: Radius.pill,
  },
  loadingFact: {
    ...Typography.caption,
    color: Colors.textMuted,
    lineHeight: 18,
    minHeight: 36,
  },
});
