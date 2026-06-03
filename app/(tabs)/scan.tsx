import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { ErrorStateCard } from "@/components/ErrorStateCard";
import { SamplePhotoPickerSheet } from "@/components/SamplePhotoPickerSheet";
import { Colors, Motion, Radius, Typography } from "@/constants/theme";
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
import { buildVehicleDetailRouteFromScanResult } from "@/lib/scanResultNavigation";
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

const SCAN_PROGRESS_STAGE_DWELL_MS = 520;

function formatRecentScanDate(scannedAt?: string | null) {
  if (!scannedAt) return "Recent";
  const date = new Date(scannedAt);
  if (Number.isNaN(date.getTime())) return "Recent";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatRecentScanTitle(scan: ScanResult) {
  return [scan.identifiedVehicle.year || null, scan.identifiedVehicle.make, scan.identifiedVehicle.model]
    .filter(Boolean)
    .join(" ") || "Vehicle identified";
}

function formatRecentScanReference(scan: ScanResult) {
  return typeof scan.id === "string" && scan.id.length > 0 ? `SCAN · ${scan.id.slice(0, 8).toUpperCase()}` : "RECENT SCAN";
}

export default function ScanScreen() {
  const IDENTIFY_TIMEOUT_MS = 60000;
  const [recentScans, setRecentScans] = useState<ScanResult[]>([]);
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
  const loadingStageAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetLoadingStageIndexRef = useRef(0);
  const activeFlowIdRef = useRef(0);
  const stagedProgress = useRef(new Animated.Value(0)).current;
  const factOpacity = useRef(new Animated.Value(1)).current;
  const { status: usage, freeUnlocksUsed, freeUnlocksRemaining, freeUnlocksLimit, unlockCredits, refreshStatus } = useSubscription();
  const samplePhotos = getSampleScanPhotos();
  const [loadingStageIndex, setLoadingStageIndex] = useState(0);
  const [activeFactIndex, setActiveFactIndex] = useState(0);

  const syncRecentScansState = useCallback((scans: ScanResult[]) => {
    setRecentScans(scans);
  }, []);

  const resetTransientScanState = useCallback(() => {
    activeFlowIdRef.current += 1;
    if (pendingIdentifyStatusTimerRef.current) {
      clearTimeout(pendingIdentifyStatusTimerRef.current);
      pendingIdentifyStatusTimerRef.current = null;
    }
    if (loadingStageAdvanceTimerRef.current) {
      clearTimeout(loadingStageAdvanceTimerRef.current);
      loadingStageAdvanceTimerRef.current = null;
    }
    targetLoadingStageIndexRef.current = 0;
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
    if (loadingStageAdvanceTimerRef.current) {
      clearTimeout(loadingStageAdvanceTimerRef.current);
      loadingStageAdvanceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isBusy || !retryImageUri) {
      if (loadingStageAdvanceTimerRef.current) {
        clearTimeout(loadingStageAdvanceTimerRef.current);
        loadingStageAdvanceTimerRef.current = null;
      }
      targetLoadingStageIndexRef.current = 0;
      setLoadingStageIndex(0);
      stagedProgress.stopAnimation();
      stagedProgress.setValue(0);
      return;
    }
    const derived = getScanLoadingStageState(debugStatus);
    targetLoadingStageIndexRef.current = Math.max(targetLoadingStageIndexRef.current, derived.stageIndex);
    if (loadingStageIndex < targetLoadingStageIndexRef.current && !loadingStageAdvanceTimerRef.current) {
      loadingStageAdvanceTimerRef.current = setTimeout(() => {
        loadingStageAdvanceTimerRef.current = null;
        setLoadingStageIndex((current) => Math.min(current + 1, targetLoadingStageIndexRef.current));
      }, SCAN_PROGRESS_STAGE_DWELL_MS);
    }
  }, [debugStatus, isBusy, loadingStageIndex, retryImageUri, stagedProgress]);

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
      console.log("[scan] navigating to vehicle detail", {
        scanId: result.id,
        imageUri: result.imageUri,
        candidateCount: result.candidates.length,
      });
      setDebugStatus("Navigation to result");
      router.push(buildVehicleDetailRouteFromScanResult(result, result.source === "sample_vehicle" ? "sample_vehicle" : "fresh_api"));
    } catch (error) {
      failScan(error instanceof Error ? error.message : "Result navigation failed.");
    }
  };

  const isPro = isProPlan(usage?.plan);
  const remainingUnlocks = Math.max(0, freeUnlocksRemaining);
  const purchasedUnlockCredits = Math.max(0, unlockCredits);
  const totalUnlocksAvailable = remainingUnlocks + purchasedUnlockCredits;
  const unlockSummaryLabel = isPro
    ? "PRO ACCESS ACTIVE"
    : purchasedUnlockCredits > 0
      ? `${remainingUnlocks} FREE • ${purchasedUnlockCredits} PURCHASED`
    : `${remainingUnlocks} FREE UNLOCK${remainingUnlocks === 1 ? "" : "S"}`;
  const unlockDotCount = Math.max(1, Math.min(freeUnlocksLimit, 5));

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
    if (loadingStageAdvanceTimerRef.current) {
      clearTimeout(loadingStageAdvanceTimerRef.current);
      loadingStageAdvanceTimerRef.current = null;
    }
    scanStartedAtRef.current = now;
    lastStageAtRef.current = now;
    targetLoadingStageIndexRef.current = 0;
    stagedProgress.stopAnimation();
    stagedProgress.setValue(0);
    setLoadingStageIndex(0);
    setIsBusy(true);
    setScanError(null);
    setLoadingSampleId(null);
    setRetryImageUri(null);
    setRetrySource(null);
    setDebugDetails([`flow source: ${source}`]);
    return flowId;
  }, [clearPendingIdentifyTimer, stagedProgress]);

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

  const openRecentScan = (scan: ScanResult) => {
    if (typeof scan.id === "string" && scan.id.length > 0) {
      console.log("[tap] recent-scan-open", { scanId: scan.id });
      console.log("[RESULT_NAVIGATION]", { resultSource: "persisted", scanId: scan.id });
      router.push(buildVehicleDetailRouteFromScanResult(scan, "persisted"));
    }
  };

  if (isBusy && retryImageUri && !scanError) {
    const stageState = getScanLoadingStageState(debugStatus);
    const displayedStageIndex = Math.min(loadingStageIndex, SCAN_LOADING_STAGES.length - 1);
    const displayedStageLabel = SCAN_LOADING_STAGES[displayedStageIndex] ?? stageState.stageLabel;
    const loadingProgressWidth = stagedProgress.interpolate({
      inputRange: [0, 1],
      outputRange: ["16%", "100%"],
    });
    const progressPercent = Math.round(((displayedStageIndex + 1) / SCAN_LOADING_STAGES.length) * 100);
    const shimmerTranslate = stagedProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [-160, 290],
    });

    return (
      <SafeAreaView style={styles.loadingScreen} edges={["top", "right", "bottom", "left"]}>
        <LinearGradient colors={["#020202", "#070605", "#050505"]} style={styles.loadingShell}>
          <Image source={{ uri: retryImageUri }} style={styles.loadingHeroImage} resizeMode="cover" />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(2,2,2,0.08)", "rgba(2,2,2,0.42)", "rgba(2,2,2,0.94)"]}
            locations={[0, 0.45, 1]}
            style={styles.loadingImageFade}
          />
          <View style={styles.loadingCardAnchor}>
            <View style={styles.loadingCopyCard}>
              <Text style={styles.loadingTitle}>Scanning your vehicle</Text>
              <Text style={styles.loadingBody}>{displayedStageLabel}</Text>
              <View style={styles.loadingProgressTrack}>
                <Animated.View style={[styles.loadingProgressGlow, { width: loadingProgressWidth }]} />
                <Animated.View style={[styles.loadingProgressFillWrap, { width: loadingProgressWidth }]}>
                  <LinearGradient
                    colors={["#D8A36B", "#F1C891", "#C58B4F"]}
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
                  Step {displayedStageIndex + 1} of {SCAN_LOADING_STAGES.length}
                </Text>
                <Text style={styles.loadingStageLabel}>{progressPercent}%</Text>
              </View>
              <Text style={styles.loadingSupport}>Matching design cues, year range, and model generation</Text>
              <Animated.Text style={[styles.loadingFact, { opacity: factOpacity }]}>
                {SCAN_LOADING_FACTS[activeFactIndex]}
              </Animated.Text>
            </View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
      <LinearGradient colors={["#040506", "#080708", "#030405"]} style={styles.screen}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroSection}>
            <LinearGradient colors={["rgba(214,158,93,0.14)", "rgba(214,158,93,0.03)", "rgba(0,0,0,0)"]} style={styles.cameraOrb}>
              <Ionicons name="camera-outline" size={32} color={scanColors.goldLight} />
            </LinearGradient>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>Identify any vehicle instantly</Text>
              <Text style={styles.heroBody}>
                Point your camera at any car to unlock AI-powered insights, specs, and real-time market value
              </Text>
            </View>
          </View>

          <View style={styles.actionStack}>
            <Pressable
              style={({ pressed }) => [styles.primaryActionShell, pressed && styles.actionPressed, isBusy && styles.actionDisabled]}
              onPress={() => beginScan("camera")}
              disabled={isBusy}
              accessibilityRole="button"
            >
              <LinearGradient colors={["#E7B47D", "#D39A5D"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryAction}>
                <Text style={styles.primaryActionText}>{isBusy ? "Analyzing..." : "Scan Vehicle"}</Text>
              </LinearGradient>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondaryAction, pressed && styles.actionPressed, isBusy && styles.actionDisabled]}
              onPress={() => beginScan("library")}
              disabled={isBusy}
              accessibilityRole="button"
            >
              <Ionicons name="image-outline" size={18} color={scanColors.goldLight} />
              <Text style={styles.secondaryActionText}>{isBusy ? "Analyzing..." : "Choose from Photos"}</Text>
            </Pressable>
          </View>

          <View style={styles.unlockRow}>
            <View style={styles.unlockMeta}>
              <View style={styles.unlockDots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {Array.from({ length: unlockDotCount }).map((_, index) => (
                  <View key={index} style={[styles.unlockDot, index < totalUnlocksAvailable && styles.unlockDotAvailable]} />
                ))}
              </View>
              <Text style={styles.unlockLabel}>{unlockSummaryLabel}</Text>
            </View>
            {!isPro ? (
              <TouchableOpacity
                activeOpacity={0.82}
                accessibilityRole="button"
                style={styles.goProButton}
                onPress={() => {
                  console.log("[tap] usage-meter-go-pro");
                  router.push("/paywall");
                }}
              >
                <Text style={styles.goProText}>Go Pro</Text>
                <Ionicons name="chevron-forward" size={15} color={scanColors.goldLight} />
              </TouchableOpacity>
            ) : null}
          </View>

          {scanError ? (
            <ErrorStateCard
              title="Scan failed"
              description={scanError}
              actionLabel="Retry Last Photo"
              onAction={() => retryScan().catch(() => undefined)}
            />
          ) : null}

          {recentScans.length > 0 ? (
            <View style={styles.recentSection}>
              <Text style={styles.sectionLabel}>RECENT</Text>
              {recentScans.slice(0, 3).map((scan) => (
                <Pressable
                  key={scan.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.recentCard, pressed && styles.recentPressed]}
                  onPress={() => openRecentScan(scan)}
                >
                  {scan.imageUri ? <Image source={{ uri: scan.imageUri }} style={styles.recentImage} resizeMode="cover" /> : null}
                  <LinearGradient colors={["rgba(3,4,5,0.06)", "rgba(3,4,5,0.36)", "rgba(3,4,5,0.96)"]} style={styles.recentOverlay} />
                  {!scan.imageUri ? (
                    <View style={styles.recentFallback}>
                      <Ionicons name="car-sport-outline" size={52} color="rgba(214,158,93,0.55)" />
                    </View>
                  ) : null}
                  <View style={styles.recentDatePill}>
                    <Text style={styles.recentDateText}>{formatRecentScanDate(scan.scannedAt)}</Text>
                  </View>
                  <View style={styles.recentCopy}>
                    <Text style={styles.recentReference}>{formatRecentScanReference(scan)}</Text>
                    <Text style={styles.recentTitle}>{formatRecentScanTitle(scan)}</Text>
                    <View style={styles.recentFooter}>
                      <Text style={styles.recentSubtitle} numberOfLines={1}>
                        {scan.limitedPreview ? "Preview saved" : "Saved scan result"}
                      </Text>
                      <View style={styles.recentArrow}>
                        <Ionicons name="chevron-forward" size={21} color={scanColors.goldLight} />
                      </View>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
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
      </LinearGradient>
    </SafeAreaView>
  );
}

const scanColors = {
  background: "#030405",
  panel: "#0A0A0B",
  panelSoft: "#11100F",
  line: "rgba(255,255,255,0.08)",
  lineGold: "rgba(214,158,93,0.22)",
  text: "#F5F3EF",
  textSoft: "#A5A6AF",
  textMuted: "#777C8A",
  gold: "#D69E5D",
  goldLight: "#E9B878",
  goldDark: "#8F5F2E",
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: scanColors.background,
  },
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 21,
    paddingTop: 34,
    paddingBottom: 44,
    gap: 0,
  },
  heroSection: {
    minHeight: 314,
    justifyContent: "space-between",
    marginBottom: 26,
  },
  cameraOrb: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.08)",
    shadowColor: scanColors.gold,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
  },
  heroCopy: {
    gap: 16,
    maxWidth: 345,
  },
  heroTitle: {
    fontFamily: Typography.hero.fontFamily,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "900",
    letterSpacing: 0,
    color: scanColors.text,
    maxWidth: 330,
  },
  heroBody: {
    ...Typography.body,
    color: scanColors.textSoft,
    fontWeight: "500",
    letterSpacing: 0,
    lineHeight: 22,
    maxWidth: 345,
  },
  actionStack: {
    gap: 14,
    marginBottom: 62,
  },
  primaryActionShell: {
    borderRadius: 14,
    minHeight: 86,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.34,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
    elevation: 5,
  },
  primaryAction: {
    flex: 1,
    minHeight: 86,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryActionText: {
    ...Typography.bodyStrong,
    color: "#080605",
    fontWeight: "900",
    letterSpacing: 0,
  },
  secondaryAction: {
    minHeight: 56,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  secondaryActionText: {
    ...Typography.bodyStrong,
    color: scanColors.text,
    fontWeight: "800",
    letterSpacing: 0,
  },
  actionPressed: {
    transform: [{ scale: Motion.pressInScale }],
  },
  actionDisabled: {
    opacity: 0.62,
  },
  unlockRow: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 43,
  },
  unlockMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  unlockDots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  unlockDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  unlockDotAvailable: {
    backgroundColor: scanColors.goldLight,
    shadowColor: scanColors.goldLight,
    shadowOpacity: 0.48,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  unlockLabel: {
    ...Typography.caption,
    color: scanColors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1,
  },
  goProButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 28,
    paddingLeft: 10,
  },
  goProText: {
    ...Typography.caption,
    color: scanColors.goldLight,
    fontWeight: "900",
    letterSpacing: 0,
  },
  recentSection: {
    gap: 18,
  },
  sectionLabel: {
    ...Typography.caption,
    color: scanColors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 2,
  },
  recentCard: {
    height: 255,
    borderRadius: 0,
    overflow: "hidden",
    backgroundColor: scanColors.panelSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(214,158,93,0.12)",
    shadowColor: "#000000",
    shadowOpacity: 0.34,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
    elevation: 5,
  },
  recentPressed: {
    transform: [{ scale: 0.992 }],
  },
  recentImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  recentOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  recentFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A0A0B",
  },
  recentDatePill: {
    position: "absolute",
    top: 20,
    right: 18,
    minHeight: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(6,6,6,0.68)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.18)",
  },
  recentDateText: {
    ...Typography.caption,
    color: scanColors.goldLight,
    fontWeight: "900",
    letterSpacing: 0,
  },
  recentCopy: {
    position: "absolute",
    left: 16,
    right: 14,
    bottom: 17,
    gap: 4,
  },
  recentReference: {
    ...Typography.caption,
    color: scanColors.goldLight,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 2,
  },
  recentTitle: {
    fontFamily: Typography.title.fontFamily,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "900",
    letterSpacing: 0,
    color: scanColors.text,
  },
  recentFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  recentSubtitle: {
    ...Typography.body,
    flex: 1,
    minWidth: 0,
    color: scanColors.text,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "700",
    letterSpacing: 0,
  },
  recentArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  loadingScreen: { flex: 1, backgroundColor: "#020202" },
  loadingShell: {
    flex: 1,
    justifyContent: "flex-end",
  },
  loadingHeroImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  loadingImageFade: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingCardAnchor: {
    width: "100%",
    paddingHorizontal: 22,
    paddingBottom: 82,
  },
  loadingCopyCard: {
    width: "100%",
    maxWidth: 370,
    alignSelf: "center",
    padding: 24,
    gap: 12,
    alignItems: "flex-start",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.22)",
    backgroundColor: "rgba(17, 17, 18, 0.92)",
    shadowColor: "#000000",
    shadowOpacity: 0.38,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
  },
  loadingTitle: { ...Typography.heading, color: Colors.textStrong, letterSpacing: 0 },
  loadingBody: { ...Typography.bodyStrong, color: "#E2B178" },
  loadingStageMetaRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8,
  },
  loadingStageStep: { ...Typography.caption, color: "#8B93A0", textTransform: "uppercase", letterSpacing: 1.8, fontWeight: "700" },
  loadingStageLabel: { ...Typography.caption, color: "#B8B1A8", flexShrink: 1, textAlign: "right", letterSpacing: 0.8 },
  loadingProgressTrack: {
    width: "100%",
    height: 5,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(255,255,255,0.16)",
    overflow: "hidden",
    position: "relative",
    marginTop: 18,
  },
  loadingProgressGlow: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(216, 163, 107, 0.18)",
    shadowColor: "#D8A36B",
    shadowOpacity: 0.3,
    shadowRadius: 10,
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
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: Radius.pill,
  },
  loadingSupport: {
    ...Typography.caption,
    color: "#B6B8C0",
    lineHeight: 18,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    paddingTop: 18,
    marginTop: 6,
  },
  loadingFact: {
    ...Typography.caption,
    color: "#B6B8C0",
    lineHeight: 18,
    minHeight: 36,
  },
});
