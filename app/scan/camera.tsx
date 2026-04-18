import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, type CameraCapturedPicture } from "expo-camera";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";
import { ApiRequestError } from "@/services/apiClient";
import { authService } from "@/services/authService";
import { scanService } from "@/services/scanService";
import { buildSelectedScanPhotoFromUri, getCameraPermissionState, getFileInfoForScan, optimizeScanImage, requestCameraPermission, type SelectedScanPhoto } from "@/features/scan/useScanActions";
import { Colors, Radius, Typography } from "@/constants/theme";

const PERMISSION_PROMPT_TIMEOUT_MS = 10000;
const CAMERA_READY_TIMEOUT_MS = 10000;
const IMAGE_PROCESSING_TIMEOUT_MS = 15000;
const IDENTIFY_TIMEOUT_MS = 60000;
const MAX_CAMERA_ZOOM = 0.32;
const MIN_PINCH_DISTANCE_DELTA = 12;
const ZOOM_WARNING_THRESHOLD = 0.2;

type CameraStatus =
  | "Requesting camera permission"
  | "Opening camera"
  | "Camera ready"
  | "Capture complete"
  | "Photo selected"
  | "File copy"
  | "File info"
  | "Optimizing image"
  | "Preparing upload"
  | "Uploading image"
  | "Identifying vehicle..."
  | "Waiting for identification"
  | "Waking backend, please wait..."
  | "Identify succeeded"
  | "Opening result"
  | `Scan failed: ${string}`;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }) as Promise<T>;
}

function clampZoom(value: number) {
  const clamped = Math.min(MAX_CAMERA_ZOOM, Math.max(0, value));
  if (clamped !== value) {
    console.log("[scan-camera] CAMERA_ZOOM_CLAMPED", { requested: value, clamped, maxZoom: MAX_CAMERA_ZOOM });
  }
  return clamped;
}

function getTouchDistance(touches: ArrayLike<{ pageX: number; pageY: number }>) {
  if (touches.length < 2) {
    return null;
  }
  const [first, second] = [touches[0], touches[1]];
  const dx = first.pageX - second.pageX;
  const dy = first.pageY - second.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

export default function ScanCameraScreen() {
  const cameraRef = useRef<CameraView | null>(null);
  const flowStartedAtRef = useRef<number | null>(null);
  const lastStageAtRef = useRef<number | null>(null);
  const activeFlowIdRef = useRef(0);
  const cameraMountFlowIdRef = useRef<number | null>(null);
  const cameraReadyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingIdentifyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(0);
  const zoomGestureActiveRef = useRef(false);
  const zoomWarningShownRef = useRef(false);
  const scanBarProgress = useRef(new Animated.Value(0)).current;

  const [permissionReady, setPermissionReady] = useState<boolean | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<CameraStatus>("Requesting camera permission");
  const [details, setDetails] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retrySelection, setRetrySelection] = useState<SelectedScanPhoto | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [sessionDetected, setSessionDetected] = useState(false);
  const [tokenPresent, setTokenPresent] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [capturedPreviewUri, setCapturedPreviewUri] = useState<string | null>(null);
  const { status: usage, freeUnlocksRemaining, freeUnlocksUsed } = useSubscription();

  const isFlowActive = useCallback((flowId: number) => activeFlowIdRef.current === flowId, []);

  const clearCameraReadyTimeout = useCallback(() => {
    if (cameraReadyTimeoutRef.current) {
      clearTimeout(cameraReadyTimeoutRef.current);
      cameraReadyTimeoutRef.current = null;
    }
  }, []);

  const clearWaitingIdentifyTimeout = useCallback(() => {
    if (waitingIdentifyTimeoutRef.current) {
      clearTimeout(waitingIdentifyTimeoutRef.current);
      waitingIdentifyTimeoutRef.current = null;
    }
  }, []);

  const startFlow = useCallback((label: string) => {
    activeFlowIdRef.current += 1;
    const flowId = activeFlowIdRef.current;
    const now = Date.now();
    flowStartedAtRef.current = now;
    lastStageAtRef.current = now;
    clearCameraReadyTimeout();
    clearWaitingIdentifyTimeout();
    setError(null);
    setDetails([`flow: ${label}`]);
    return flowId;
  }, [clearCameraReadyTimeout, clearWaitingIdentifyTimeout]);

  const appendStage = useCallback((label: string, payload?: unknown, flowId?: number) => {
    if (typeof flowId === "number" && activeFlowIdRef.current !== flowId) {
      return;
    }
    const now = Date.now();
    const startedAt = flowStartedAtRef.current ?? now;
    const previousAt = lastStageAtRef.current ?? startedAt;
    lastStageAtRef.current = now;
    const totalMs = now - startedAt;
    const deltaMs = now - previousAt;
    const line = payload === undefined ? `${label} (+${totalMs}ms, Δ${deltaMs}ms)` : `${label} (+${totalMs}ms, Δ${deltaMs}ms): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`;
    console.log("[scan-camera]", line);
    setDetails((current) => [...current.slice(-8), line]);
  }, []);

  const fail = useCallback((message: string, flowId?: number) => {
    if (typeof flowId === "number" && activeFlowIdRef.current !== flowId) {
      return;
    }
    clearCameraReadyTimeout();
    clearWaitingIdentifyTimeout();
    setIsBusy(false);
    setStatus(`Scan failed: ${message}`);
    setError(message);
    appendStage("scan failed", message, flowId);
    if (typeof flowId === "number" && activeFlowIdRef.current === flowId) {
      activeFlowIdRef.current += 1;
    }
  }, [appendStage, clearCameraReadyTimeout, clearWaitingIdentifyTimeout]);

  const armCameraReadyTimeout = useCallback((flowId: number) => {
    clearCameraReadyTimeout();
    cameraReadyTimeoutRef.current = setTimeout(() => {
      if (!isFlowActive(flowId)) {
        return;
      }
      fail("Camera took too long to open.", flowId);
    }, CAMERA_READY_TIMEOUT_MS);
  }, [clearCameraReadyTimeout, fail, isFlowActive]);

  const armWaitingIdentifyTimeout = useCallback((flowId: number) => {
    clearWaitingIdentifyTimeout();
    waitingIdentifyTimeoutRef.current = setTimeout(() => {
      if (!isFlowActive(flowId)) {
        return;
      }
      setStatus("Waiting for identification");
      appendStage("waiting for identification", undefined, flowId);
    }, 1200);
  }, [appendStage, clearWaitingIdentifyTimeout, isFlowActive]);

  const runIdentify = useCallback(async (selection: SelectedScanPhoto, flowId: number) => {
    if (!isFlowActive(flowId)) {
      return;
    }

    setRetrySelection(selection);
    appendStage("photo selected", {
      cachedUri: selection.cachedUri,
      mimeType: selection.mimeType,
      fileSize: selection.fileSize,
      width: selection.width,
      height: selection.height,
    }, flowId);

    try {
      setStatus("Optimizing image");
      appendStage("optimization start", undefined, flowId);
      const optimized = await withTimeout(optimizeScanImage(selection), IMAGE_PROCESSING_TIMEOUT_MS, "Image processing took too long.");
      if (!isFlowActive(flowId)) {
        return;
      }
      appendStage("optimization end", {
        cachedUri: optimized.cachedUri,
        fileSize: optimized.fileSize,
        width: optimized.width,
        height: optimized.height,
      }, flowId);
      setRetrySelection(optimized);

      setStatus("Preparing upload");
      appendStage("form-data creation start", undefined, flowId);
      setStatus("Uploading image");
      armWaitingIdentifyTimeout(flowId);
      const result = await scanService.identifyVehicle(optimized.cachedUri!, {
        timeoutMs: IDENTIFY_TIMEOUT_MS,
          onStage: (stage, payload) => {
            if (!isFlowActive(flowId)) {
              return;
            }
            if (stage === "health wake-up start") {
              setStatus("Waking backend, please wait...");
            }
            if (stage === "form-data creation start") {
              setStatus("Preparing upload");
            }
            if (stage === "identify request start") {
              setStatus("Identifying vehicle...");
            }
            if (stage === "identify request success") {
              clearWaitingIdentifyTimeout();
            }
            appendStage(stage, payload, flowId);
        },
      });
      if (!isFlowActive(flowId)) {
        return;
      }
      clearWaitingIdentifyTimeout();
      setStatus("Identify succeeded");
      appendStage("identify succeeded", { scanId: result.id, imageUri: result.imageUri }, flowId);
      setIsBusy(false);
      setStatus("Opening result");
      appendStage("navigation to result start", { scanId: result.id }, flowId);
      router.replace({ pathname: "/scan/result", params: { scanId: result.id, imageUri: result.imageUri } });
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
          : error instanceof Error
            ? error.message
            : "We couldn’t identify that vehicle right now.";
      console.log("[scan-camera] SCAN_BLOCKED_REASON", {
        code: error instanceof ApiRequestError ? error.code : undefined,
        message,
      });
      fail(message, flowId);
    }
  }, [appendStage, armWaitingIdentifyTimeout, clearWaitingIdentifyTimeout, fail, isFlowActive]);

  const capturePhoto = useCallback(async () => {
    if (!cameraRef.current || !cameraReady || isBusy) {
      return;
    }
    console.log("[scan-camera] CAMERA_SCAN_GATE_CHECK", {
      allowed: true,
      reason: "basic-scan-always-allowed",
      plan: usage?.plan ?? "free",
      freeUnlocksRemaining,
      freeUnlocksUsed,
    });

    const flowId = startFlow("camera-capture");
    setIsBusy(true);
    setStatus("Opening camera");
    appendStage("capture start", undefined, flowId);
    console.log("[scan-camera] CAMERA_CAPTURE_WITH_ZOOM", { flowId, zoom });
    console.log("[scan-camera] CAMERA_CAPTURE_FOCUS_STATE", {
      autofocus: "on",
      zoom,
      cameraReady,
    });

    try {
      const picture = await withTimeout(
        cameraRef.current.takePictureAsync({
          quality: 0.7,
          exif: false,
          skipProcessing: false,
        }),
        IMAGE_PROCESSING_TIMEOUT_MS,
        "Image processing took too long.",
      );
      if (!isFlowActive(flowId)) {
        return;
      }

      const captured = picture as CameraCapturedPicture;
      setCapturedPreviewUri(captured.uri);
      setStatus("Capture complete");
      appendStage("capture complete", {
        uri: captured.uri,
        width: captured.width,
        height: captured.height,
      }, flowId);

      setStatus("Photo selected");
      appendStage("asset extraction start", undefined, flowId);
      const selection = await withTimeout(
        buildSelectedScanPhotoFromUri({
          uri: captured.uri,
          mimeType: "image/jpeg",
          fileSize: null,
          width: captured.width,
          height: captured.height,
          onStage: (stage, payload) => {
            if (stage === "file copy start") {
              setStatus("File copy");
            }
            if (stage === "file info start") {
              setStatus("File info");
            }
            appendStage(stage, payload, flowId);
          },
        }),
        IMAGE_PROCESSING_TIMEOUT_MS,
        "Image processing took too long.",
      );
      if (!isFlowActive(flowId)) {
        return;
      }
      appendStage("asset extraction end", {
        cachedUri: selection.cachedUri,
        width: selection.width,
        height: selection.height,
      }, flowId);

      setStatus("File info");
      appendStage("file info verification start", undefined, flowId);
      const info = await withTimeout(getFileInfoForScan(selection.cachedUri!), IMAGE_PROCESSING_TIMEOUT_MS, "Image processing took too long.");
      if (!isFlowActive(flowId)) {
        return;
      }
      appendStage("file info verification end", {
        exists: info.exists,
        size: info.exists && typeof info.size === "number" ? info.size : null,
      }, flowId);

      await runIdentify(
        {
          ...selection,
          fileSize: info.exists && typeof info.size === "number" ? info.size : selection.fileSize,
        },
        flowId,
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : "We couldn’t capture that photo.", flowId);
    }
  }, [appendStage, cameraReady, fail, isBusy, isFlowActive, runIdentify, startFlow, zoom]);

  const handleTouchStart = useCallback((event: any) => {
    const distance = getTouchDistance(event.nativeEvent.touches);
    if (distance == null) {
      return;
    }
    zoomGestureActiveRef.current = true;
    pinchStartDistanceRef.current = distance;
    pinchStartZoomRef.current = zoom;
    console.log("[scan-camera] CAMERA_ZOOM_START", { zoom });
  }, [zoom]);

  const handleTouchMove = useCallback((event: any) => {
    if (!zoomGestureActiveRef.current) {
      return;
    }
    const distance = getTouchDistance(event.nativeEvent.touches);
    const startDistance = pinchStartDistanceRef.current;
    if (distance == null || startDistance == null) {
      return;
    }
    const rawDelta = distance - startDistance;
    if (Math.abs(rawDelta) < MIN_PINCH_DISTANCE_DELTA) {
      return;
    }
    const normalizedDelta = Math.sign(rawDelta) * Math.pow(Math.min(Math.abs(rawDelta) / 260, 1), 1.5);
    const nextZoom = clampZoom(pinchStartZoomRef.current + normalizedDelta * MAX_CAMERA_ZOOM);
    if (Math.abs(nextZoom - zoom) < 0.004) {
      return;
    }
    setZoom(nextZoom);
    console.log("[scan-camera] CAMERA_ZOOM_CHANGE", {
      zoom: Number(nextZoom.toFixed(3)),
      rawDelta,
      normalizedDelta,
    });
    console.log("[scan-camera] CAMERA_ZOOM_APPLIED", { zoom: Number(nextZoom.toFixed(3)), maxZoom: MAX_CAMERA_ZOOM });
  }, [zoom]);

  const finishZoomGesture = useCallback(() => {
    if (!zoomGestureActiveRef.current) {
      return;
    }
    zoomGestureActiveRef.current = false;
    pinchStartDistanceRef.current = null;
    console.log("[scan-camera] CAMERA_ZOOM_END", { zoom: Number(zoom.toFixed(3)) });
  }, [zoom]);

  const requestPermissionFlow = useCallback(async () => {
    const flowId = startFlow("camera-permission");
    setPermissionReady(null);
    setCameraReady(false);
    setCapturedPreviewUri(null);
    setStatus("Requesting camera permission");
    appendStage("permission request start", undefined, flowId);

    try {
      const current = await getCameraPermissionState();
      if (!isFlowActive(flowId)) {
        return;
      }
      appendStage("permission current state", current, flowId);
      const permission = current.granted
        ? current
        : await withTimeout(requestCameraPermission(), PERMISSION_PROMPT_TIMEOUT_MS, "Camera permission prompt took too long.");
      if (!isFlowActive(flowId)) {
        return;
      }
      appendStage("permission request end", permission, flowId);
      setPermissionReady(permission.granted);

      if (!permission.granted) {
        fail("Camera access is disabled. Enable it in Settings to continue.", flowId);
        return;
      }

      cameraMountFlowIdRef.current = flowId;
      setStatus("Opening camera");
      armCameraReadyTimeout(flowId);
    } catch (error) {
      fail(error instanceof Error ? error.message : "We couldn’t request camera permission.", flowId);
    }
  }, [appendStage, armCameraReadyTimeout, fail, isFlowActive, startFlow]);

  useEffect(() => {
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

    requestPermissionFlow().catch(() => undefined);
    return () => {
      clearCameraReadyTimeout();
      clearWaitingIdentifyTimeout();
    };
  }, [clearCameraReadyTimeout, clearWaitingIdentifyTimeout, requestPermissionFlow]);

  useEffect(() => {
    if (!(capturedPreviewUri && isBusy)) {
      scanBarProgress.stopAnimation();
      scanBarProgress.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanBarProgress, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanBarProgress, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      scanBarProgress.stopAnimation();
      scanBarProgress.setValue(0);
    };
  }, [capturedPreviewUri, isBusy, scanBarProgress]);

  const statusTone = useMemo(() => {
    if (status.startsWith("Scan failed:")) {
      return styles.statusError;
    }
    if (status === "Camera ready") {
      return styles.statusReady;
    }
    return styles.statusActive;
  }, [status]);

  const showZoomWarning = zoom > ZOOM_WARNING_THRESHOLD;
  const processingHeadline = status === "Identifying vehicle..." || status === "Waiting for identification" ? "Analyzing vehicle..." : "Preparing scan...";
  const visibleStatusTitle = useMemo(() => {
    if (status.startsWith("Scan failed:")) {
      return "Scan failed";
    }
    if (status === "Requesting camera permission") {
      return "Preparing camera...";
    }
    if (status === "Opening camera") {
      return "Opening camera...";
    }
    if (status === "Camera ready") {
      return "Frame the vehicle";
    }
    if (status === "Capture complete" || status === "Photo selected" || status === "File copy" || status === "File info" || status === "Optimizing image") {
      return "Preparing your photo...";
    }
    if (status === "Preparing upload" || status === "Uploading image") {
      return "Reading visible text...";
    }
    if (status === "Identifying vehicle..." || status === "Waiting for identification" || status === "Waking backend, please wait...") {
      return "Analyzing vehicle...";
    }
    if (status === "Identify succeeded" || status === "Opening result") {
      return "Opening result...";
    }
    return status;
  }, [status]);
  const processingSubhead =
    status === "Identifying vehicle..." || status === "Waiting for identification"
      ? "Detecting make & model..."
      : "Optimizing your captured photo...";

  useEffect(() => {
    if (showZoomWarning && !zoomWarningShownRef.current) {
      zoomWarningShownRef.current = true;
      console.log("[scan-camera] CAMERA_ZOOM_WARNING_SHOWN", {
        zoom: Number(zoom.toFixed(3)),
        threshold: ZOOM_WARNING_THRESHOLD,
      });
      return;
    }
    if (!showZoomWarning) {
      zoomWarningShownRef.current = false;
    }
  }, [showZoomWarning, zoom]);

  return (
    <View style={styles.screen}>
      {permissionReady ? (
        capturedPreviewUri ? (
          <View style={styles.capturedPreviewFrame}>
            <Image source={{ uri: capturedPreviewUri }} style={styles.capturedPreviewImage} resizeMode="contain" />
            {isBusy ? (
              <View style={styles.processingOverlay} pointerEvents="none">
                <View style={styles.processingCard}>
                  <View style={styles.processingPill}>
                    <Text style={styles.processingPillLabel}>Analyzing photo</Text>
                  </View>
                  <Text style={styles.processingTitle}>{processingHeadline}</Text>
                  <Text style={styles.processingBody}>{processingSubhead}</Text>
                </View>
                <Animated.View
                  style={[
                    styles.previewScanLineGlow,
                    {
                      transform: [
                        {
                          translateY: scanBarProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 720],
                          }),
                        },
                      ],
                    },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.previewScanLineCore,
                    {
                      transform: [
                        {
                          translateY: scanBarProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 720],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <View
            style={StyleSheet.absoluteFill}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={finishZoomGesture}
            onTouchCancel={finishZoomGesture}
          >
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
              autofocus="on"
              zoom={zoom}
              onCameraReady={() => {
                const flowId = cameraMountFlowIdRef.current;
                if (typeof flowId === "number" && !isFlowActive(flowId)) {
                  return;
                }
                clearCameraReadyTimeout();
                setCameraReady(true);
                setStatus("Camera ready");
                appendStage("camera ready", undefined, flowId ?? undefined);
              }}
              onMountError={(event) => {
                const flowId = cameraMountFlowIdRef.current;
                fail(event.message || "Camera took too long to open.", flowId ?? undefined);
              }}
            />
          </View>
        )
      ) : (
        <View style={styles.cameraPlaceholder} />
      )}

      {!(capturedPreviewUri && isBusy) ? (
        <>
          <View style={styles.topBar}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Text style={styles.backButtonLabel}>Back</Text>
            </Pressable>
          </View>

          <View style={[styles.statusCard, statusTone]}>
            <Text style={styles.statusTitle}>{__DEV__ ? status : visibleStatusTitle}</Text>
            <Text style={styles.zoomMeta}>{zoom > 0 ? `Zoom: ${zoom.toFixed(2)}x digital` : "Zoom stays sharpest near 1x."}</Text>
            {showZoomWarning ? <Text style={styles.zoomWarning}>Zoom may reduce clarity</Text> : null}
            {__DEV__ ? <Text style={styles.statusMeta}>Signed in: {signedIn ? "yes" : "no"} | Session detected: {sessionDetected ? "yes" : "no"} | Auth token present: {tokenPresent ? "yes" : "no"}</Text> : null}
            {__DEV__ ? (
              <Text style={styles.statusMeta}>
                Permission timeout: {PERMISSION_PROMPT_TIMEOUT_MS}ms | Camera open timeout: {CAMERA_READY_TIMEOUT_MS}ms | Processing timeout: {IMAGE_PROCESSING_TIMEOUT_MS}ms | Identify timeout: {IDENTIFY_TIMEOUT_MS}ms
              </Text>
            ) : null}
            {__DEV__
              ? details.map((detail) => (
                  <Text key={detail} style={styles.statusDetail}>
                    {detail}
                  </Text>
                ))
              : null}
            {isBusy ? <ActivityIndicator size="small" color={Colors.accent} /> : null}
          </View>
        </>
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Scan failed</Text>
          <Text style={styles.errorBody}>{error}</Text>
          {retrySelection ? (
            <Pressable
              style={styles.retryButton}
              onPress={() => {
                const flowId = startFlow("camera-retry");
                setIsBusy(true);
                runIdentify(retrySelection, flowId).catch(() => undefined);
              }}
            >
              <Text style={styles.retryLabel}>Retry Last Photo</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.retryButton} onPress={() => requestPermissionFlow().catch(() => undefined)}>
              <Text style={styles.retryLabel}>Retry Camera</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {!(capturedPreviewUri && isBusy) ? (
        <View style={styles.bottomBar}>
          <Pressable style={[styles.captureButton, (!cameraReady || isBusy) && styles.captureButtonDisabled]} onPress={() => capturePhoto().catch(() => undefined)} disabled={!cameraReady || isBusy}>
            <View style={styles.captureButtonInner} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  cameraPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.cardAlt,
  },
  capturedPreviewFrame: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  capturedPreviewImage: {
    width: "100%",
    height: "100%",
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3, 8, 22, 0.44)",
    paddingHorizontal: 24,
  },
  processingCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "rgba(9, 16, 32, 0.88)",
    borderRadius: Radius.xl,
    padding: 20,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.accentGlow,
    shadowColor: Colors.accent,
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  processingPill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0, 194, 255, 0.12)",
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.cyanGlow,
  },
  processingPillLabel: {
    ...Typography.caption,
    color: Colors.premium,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  processingTitle: {
    ...Typography.title,
    color: Colors.textStrong,
  },
  processingBody: {
    ...Typography.body,
    color: Colors.textSoft,
  },
  previewScanLineGlow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 26,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(94, 231, 255, 0.16)",
    shadowColor: Colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  previewScanLineCore: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.premium,
  },
  topBar: {
    position: "absolute",
    top: 58,
    left: 20,
    right: 20,
    zIndex: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  backButton: {
    backgroundColor: "rgba(9, 16, 32, 0.78)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  backButtonLabel: {
    ...Typography.bodyStrong,
    color: Colors.textStrong,
  },
  statusCard: {
    position: "absolute",
    top: 112,
    left: 20,
    right: 20,
    borderRadius: Radius.xl,
    padding: 16,
    gap: 6,
    zIndex: 10,
    borderWidth: 1,
  },
  statusActive: {
    backgroundColor: "rgba(9, 16, 32, 0.86)",
    borderColor: Colors.border,
  },
  statusReady: {
    backgroundColor: "rgba(8, 42, 95, 0.88)",
    borderColor: Colors.accentGlow,
  },
  statusError: {
    backgroundColor: "rgba(88, 16, 26, 0.9)",
    borderColor: Colors.dangerSoft,
  },
  statusTitle: {
    ...Typography.bodyStrong,
    color: Colors.textStrong,
  },
  statusMeta: {
    ...Typography.caption,
    color: Colors.textSoft,
  },
  zoomMeta: {
    ...Typography.caption,
    color: Colors.premium,
  },
  zoomWarning: {
    ...Typography.caption,
    color: Colors.textStrong,
  },
  statusDetail: {
    ...Typography.caption,
    color: Colors.textSoft,
  },
  errorCard: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 150,
    backgroundColor: "rgba(9, 16, 32, 0.96)",
    borderRadius: Radius.xl,
    padding: 18,
    gap: 10,
    zIndex: 10,
    borderWidth: 1,
    borderColor: Colors.dangerSoft,
  },
  errorTitle: {
    ...Typography.heading,
    color: Colors.textStrong,
  },
  errorBody: {
    ...Typography.body,
    color: Colors.textSoft,
  },
  retryButton: {
    alignSelf: "flex-start",
    backgroundColor: Colors.cardAlt,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryLabel: {
    ...Typography.bodyStrong,
    color: Colors.textStrong,
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 44,
    alignItems: "center",
    zIndex: 10,
  },
  captureButton: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 4,
    borderColor: Colors.premium,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 194, 255, 0.12)",
    shadowColor: Colors.accent,
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  captureButtonDisabled: {
    opacity: 0.45,
  },
  captureButtonInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: Colors.textStrong,
  },
});
