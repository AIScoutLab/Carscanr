import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
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
import {
  getCameraPermissionState,
  getLibraryPermissionState,
  getSampleScanPhotos,
  launchLibraryForScan,
  optimizeScanImage,
  pickSamplePhoto,
  requestLibraryPermission,
  SelectedScanPhoto,
} from "@/features/scan/useScanActions";
import { useSubscription } from "@/hooks/useSubscription";
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
  const scanBarProgress = useRef(new Animated.Value(0)).current;
  const { status: usage, freeUnlocksUsed, freeUnlocksRemaining, freeUnlocksLimit, refreshStatus } = useSubscription();
  const samplePhotos = getSampleScanPhotos();

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
    scanService.getRecentScans().then(setRecentScans);
  }, []);

  useEffect(() => () => {
    if (pendingIdentifyStatusTimerRef.current) {
      clearTimeout(pendingIdentifyStatusTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isBusy || !retryImageUri) {
      scanBarProgress.stopAnimation();
      scanBarProgress.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanBarProgress, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scanBarProgress, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => {
      animation.stop();
      scanBarProgress.stopAnimation();
      scanBarProgress.setValue(0);
    };
  }, [isBusy, retryImageUri, scanBarProgress]);

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
      return () => {
        resetTransientScanState();
      };
    }, [refreshStatus, resetTransientScanState]),
  );

  const routeToResult = (result: ScanResult) => {
    try {
      setDebugStatus("Opening result");
      recordStage("navigation start", { scanId: result.id, imageUri: result.imageUri });
      appendDebugDetail("result params", { scanId: result.id, imageUri: result.imageUri });
      console.log("[scan] navigating to result", {
        scanId: result.id,
        imageUri: result.imageUri,
        candidateCount: result.candidates.length,
      });
      setDebugStatus("Navigation to result");
      router.push({ pathname: "/scan/result", params: { scanId: result.id, imageUri: result.imageUri } });
    } catch (error) {
      failScan(error instanceof Error ? error.message : "Result navigation failed.");
    }
  };

  const scansUsed = usage?.scansUsed ?? usage?.scansUsedToday ?? 0;
  const showUpgradeCard = usage?.plan !== "pro" && freeUnlocksRemaining <= 1;
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
    console.error("[scan] flow failed", message);
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
    console.log("[tap] scan-library");
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
    console.log("[tap] begin-scan", { source, freeUnlocksRemaining });
    if (source === "library") {
      setScanError(null);
      setDebugStatus("Idle");
      setDebugDetails([]);
      setSamplePickerOpen(true);
      return;
    }

    console.log("[tap] scan-camera");
    router.push("/scan/camera");
  };

  const beginSampleScan = async (sampleId: string) => {
    let flowId = 0;
    try {
      console.log("[tap] begin-sample-scan", { sampleId, freeUnlocksRemaining });
      flowId = startFlow(`sample:${sampleId}`);
      setLoadingSampleId(sampleId);
      recordStage("tap received", `sample:${sampleId}`, flowId);
      setDebugStatus("Photo selected");
      const imageUri = await pickSamplePhoto(sampleId);
      if (!isFlowActive(flowId)) {
        return;
      }
      recordStage("sample ready", imageUri, flowId);
      setSamplePickerOpen(false);
      await runIdentifyFlow(
        {
          canceled: false,
          assetExists: true,
          originalUri: imageUri,
          cachedUri: imageUri,
          mimeType: "image/jpeg",
          fileName: imageUri.split("/").pop() ?? `${sampleId}.jpg`,
          fileSize: null,
          width: null,
          height: null,
        },
        "sample",
        flowId,
      );
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

  const statusTone = useMemo(() => {
    if (debugStatus.startsWith("Scan failed:")) {
      return styles.statusError;
    }
    if (debugStatus === "Idle") {
      return styles.statusIdle;
    }
    return styles.statusActive;
  }, [debugStatus]);

  const visibleStatusLabel = useMemo(() => {
    if (debugStatus.startsWith("Scan failed:")) {
      return "Scan failed";
    }
    if (debugStatus === "Requesting photo library permission" || debugStatus === "Opening photo library") {
      return "Opening your photos...";
    }
    if (debugStatus === "Photo selected" || debugStatus === "Optimizing image") {
      return "Preparing your photo...";
    }
    if (debugStatus === "Preparing upload" || debugStatus === "Uploading image") {
      return "Reading visible text...";
    }
    if (debugStatus === "Identifying vehicle..." || debugStatus === "Waiting for identification" || debugStatus === "Waking backend, please wait...") {
      return "Analyzing vehicle...";
    }
    return debugStatus;
  }, [debugStatus]);

  const analysisStepLabel = useMemo(() => {
    if (debugStatus === "Opening photo library" || debugStatus === "Photo selected" || debugStatus === "Optimizing image") {
      return "Preparing your photo...";
    }
    if (debugStatus === "Preparing upload" || debugStatus === "Uploading image") {
      return "Reading visible text...";
    }
    if (debugStatus === "Identifying vehicle..." || debugStatus === "Waiting for identification" || debugStatus === "Waking backend, please wait...") {
      return "Matching year, make, and model...";
    }
    return "Analyzing vehicle...";
  }, [debugStatus]);

  if (isBusy && retryImageUri && !scanError) {
    const scanBarTranslate = scanBarProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 332],
    });

    return (
      <AppContainer scroll={false} contentContainerStyle={styles.loadingScreen}>
        <View style={styles.loadingHeroFrame}>
          <Image source={{ uri: retryImageUri }} style={styles.loadingHeroImage} resizeMode="contain" />
          <View style={styles.loadingOverlay} pointerEvents="none">
            <Animated.View style={[styles.scanLineGlow, { transform: [{ translateY: scanBarTranslate }] }]} />
            <Animated.View style={[styles.scanLineCore, { transform: [{ translateY: scanBarTranslate }] }]} />
          </View>
        </View>
        <View style={styles.loadingCopyCard}>
          <Text style={styles.loadingTitle}>Analyzing vehicle...</Text>
          <Text style={styles.loadingBody}>{analysisStepLabel}</Text>
          <ActivityIndicator size="small" color={Colors.accent} />
        </View>
      </AppContainer>
    );
  }

  return (
    <AppContainer>
      <LinearGradient colors={["rgba(29,140,255,0.22)", "rgba(94,231,255,0.06)", "rgba(4,8,18,0.2)"]} style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.heroCopy}>
            <Text style={styles.title}>Scan a vehicle</Text>
            <Text style={styles.subtitle}>Take a photo or choose one from your library to identify the vehicle and open the strongest match we can support.</Text>
          </View>
        </View>
      </LinearGradient>
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
      {(scanError || __DEV__) ? (
        <View style={[styles.statusCard, statusTone]}>
          <Text style={styles.statusLabel}>{__DEV__ ? debugStatus : visibleStatusLabel}</Text>
          {__DEV__ ? (
            <Text style={styles.statusSubtle}>
              Camera permission: {cameraPermissionReady === null ? "checking" : cameraPermissionReady ? "ready" : "not granted"} | Library permission:{" "}
              {libraryPermissionReady === null ? "checking" : libraryPermissionReady ? "ready" : "not granted"}
            </Text>
          ) : null}
          {__DEV__ ? <Text style={styles.statusSubtle}>Signed in: {signedIn ? "yes" : "no"} | Session detected: {sessionDetected ? "yes" : "no"} | Auth token present: {tokenPresent ? "yes" : "no"}</Text> : null}
          {__DEV__ ? <Text style={styles.statusSubtle}>Identify timeout: {IDENTIFY_TIMEOUT_MS}ms</Text> : null}
          {__DEV__
            ? debugDetails.map((detail) => (
                <Text key={detail} style={styles.statusDetail}>
                  {detail}
                </Text>
              ))
            : null}
          {scanError ? <ActivityIndicator size="small" color={Colors.accent} /> : null}
        </View>
      ) : null}
      {scanError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Scan failed</Text>
          <Text style={styles.errorBody}>{scanError}</Text>
          <PrimaryButton label="Retry Last Photo" onPress={() => retryScan().catch(() => undefined)} disabled={!retryImageUri || isBusy} />
        </View>
      ) : null}
      <View style={styles.scanCard}>
        <Pressable style={({ pressed }) => [styles.cameraButton, pressed && styles.cameraPressed]} onPress={() => beginScan("camera")} disabled={isBusy}>
          <LinearGradient colors={["#0A72E8", "#1D8CFF", "#5EE7FF"]} style={styles.cameraGradient}>
            <Text style={styles.cameraButtonLabel}>{isBusy ? "Analyzing..." : "Scan Vehicle"}</Text>
          </LinearGradient>
        </Pressable>
        <PrimaryButton label={isBusy ? "Analyzing..." : "Choose From Photos"} secondary onPress={() => beginScan("library")} disabled={isBusy} />
        <Text style={styles.helper}>In the simulator, you can use sample vehicle photos if you do not have camera access.</Text>
      </View>
      {showSoftUpsell ? (
        <UpgradePromptCard
          title="Want deeper insights on every vehicle?"
          description="Upgrade for pricing trends, live listings, and premium decision guidance."
          ctaLabel="Explore Pro"
          onPress={() => {
            console.log("[tap] scan-upgrade-prompt");
            router.push("/paywall");
          }}
        />
      ) : null}
      {showUpgradeCard ? (
        <PaywallCard
          status={usage}
          unlocksRemaining={freeUnlocksRemaining}
          unlocksLimit={freeUnlocksLimit}
        />
      ) : null}
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
              horsepower: null,
              torque: "",
              transmission: "",
              drivetrain: "",
              mpgOrRange: "",
              exteriorColors: [],
              msrp: 0,
            },
            valuation: {
              tradeIn: "",
              tradeInRange: "",
              privateParty: "",
              privatePartyRange: "",
              dealerRetail: "",
              dealerRetailRange: "",
              confidenceLabel: "",
              sourceLabel: "",
              modelType: "modeled",
            },
            listings: [],
          }}
          subtitle="Tap to open your full scan result"
          onPress={() => {
            if (typeof scan.id === "string" && scan.id.length > 0) {
              console.log("[tap] recent-scan-open", { scanId: scan.id });
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
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  title: { ...Typography.largeTitle, color: Colors.textStrong, marginTop: 4 },
  subtitle: { ...Typography.body, color: Colors.textSoft, marginBottom: 4 },
  heroCard: {
    borderRadius: Radius.xl,
    padding: 20,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroHeader: { flexDirection: "row", gap: 16, alignItems: "center" },
  heroCopy: { flex: 1, gap: 6 },
  statusCard: {
    borderRadius: Radius.lg,
    padding: 16,
    gap: 6,
    borderWidth: 1,
  },
  statusIdle: {
    backgroundColor: Colors.cardSoft,
    borderColor: Colors.border,
  },
  statusActive: {
    backgroundColor: Colors.cardTint,
    borderColor: Colors.accent,
  },
  statusError: {
    backgroundColor: Colors.dangerSoft,
    borderColor: "#F87171",
  },
  statusLabel: {
    ...Typography.bodyStrong,
    color: Colors.textStrong,
  },
  statusSubtle: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  statusDetail: {
    ...Typography.caption,
    color: Colors.textSoft,
  },
  errorCard: {
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: "#F87171",
    borderRadius: Radius.xl,
    padding: 18,
    gap: 12,
  },
  errorTitle: {
    ...Typography.heading,
    color: Colors.textStrong,
  },
  errorBody: {
    ...Typography.body,
    color: Colors.textSoft,
  },
  scanCard: { ...cardStyles.primary, gap: 14, backgroundColor: Colors.cardSoft },
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
  helper: { ...Typography.caption, color: Colors.textSoft },
  loadingScreen: { flex: 1, gap: 16 },
  loadingHeroFrame: {
    width: "100%",
    height: 360,
    borderRadius: Radius.xl,
    overflow: "hidden",
    backgroundColor: Colors.cardSoft,
  },
  loadingHeroImage: {
    width: "100%",
    height: "100%",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-start",
    alignItems: "stretch",
    overflow: "hidden",
  },
  scanLineGlow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 28,
    borderRadius: Radius.lg,
    backgroundColor: "rgba(94,231,255,0.18)",
    shadowColor: Colors.premium,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  scanLineCore: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.premium,
  },
  loadingCopyCard: {
    backgroundColor: Colors.cardSoft,
    borderRadius: Radius.xl,
    padding: 18,
    gap: 8,
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  loadingTitle: { ...Typography.heading, color: Colors.textStrong },
  loadingBody: { ...Typography.body, color: Colors.textSoft },
});
