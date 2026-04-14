import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
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
const MAX_CAMERA_ZOOM = 0.7;

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
  return Math.min(MAX_CAMERA_ZOOM, Math.max(0, value));
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
    const nextZoom = clampZoom(pinchStartZoomRef.current + (distance - startDistance) / 300);
    setZoom(nextZoom);
    console.log("[scan-camera] CAMERA_ZOOM_CHANGE", { zoom: Number(nextZoom.toFixed(3)) });
  }, []);

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

  const statusTone = useMemo(() => {
    if (status.startsWith("Scan failed:")) {
      return styles.statusError;
    }
    if (status === "Camera ready") {
      return styles.statusReady;
    }
    return styles.statusActive;
  }, [status]);

  return (
    <View style={styles.screen}>
      {permissionReady ? (
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
      ) : (
        <View style={styles.cameraPlaceholder} />
      )}

      <View style={styles.topBar}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonLabel}>Back</Text>
        </Pressable>
      </View>

      <View style={[styles.statusCard, statusTone]}>
        <Text style={styles.statusTitle}>{status}</Text>
        <Text style={styles.zoomMeta}>Zoom: {zoom.toFixed(2)}x digital</Text>
        <Text style={styles.statusMeta}>Signed in: {signedIn ? "yes" : "no"} | Session detected: {sessionDetected ? "yes" : "no"} | Auth token present: {tokenPresent ? "yes" : "no"}</Text>
        <Text style={styles.statusMeta}>
          Permission timeout: {PERMISSION_PROMPT_TIMEOUT_MS}ms | Camera open timeout: {CAMERA_READY_TIMEOUT_MS}ms | Processing timeout: {IMAGE_PROCESSING_TIMEOUT_MS}ms | Identify timeout: {IDENTIFY_TIMEOUT_MS}ms
        </Text>
        {details.map((detail) => (
          <Text key={detail} style={styles.statusDetail}>
            {detail}
          </Text>
        ))}
        {isBusy ? <ActivityIndicator size="small" color={Colors.accent} /> : null}
      </View>

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

      <View style={styles.bottomBar}>
        <Pressable style={[styles.captureButton, (!cameraReady || isBusy) && styles.captureButtonDisabled]} onPress={() => capturePhoto().catch(() => undefined)} disabled={!cameraReady || isBusy}>
          <View style={styles.captureButtonInner} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#020617",
  },
  cameraPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0F172A",
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
    backgroundColor: "rgba(15, 23, 42, 0.78)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backButtonLabel: {
    ...Typography.bodyStrong,
    color: "#FFFFFF",
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
    backgroundColor: "rgba(15, 23, 42, 0.82)",
    borderColor: "rgba(148, 163, 184, 0.45)",
  },
  statusReady: {
    backgroundColor: "rgba(3, 105, 161, 0.82)",
    borderColor: "rgba(125, 211, 252, 0.55)",
  },
  statusError: {
    backgroundColor: "rgba(127, 29, 29, 0.86)",
    borderColor: "rgba(252, 165, 165, 0.55)",
  },
  statusTitle: {
    ...Typography.bodyStrong,
    color: "#FFFFFF",
  },
  statusMeta: {
    ...Typography.caption,
    color: "rgba(255,255,255,0.74)",
  },
  zoomMeta: {
    ...Typography.caption,
    color: "#BAE6FD",
  },
  statusDetail: {
    ...Typography.caption,
    color: "#E2E8F0",
  },
  errorCard: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 150,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: Radius.xl,
    padding: 18,
    gap: 10,
    zIndex: 10,
  },
  errorTitle: {
    ...Typography.heading,
    color: Colors.textStrong,
  },
  errorBody: {
    ...Typography.body,
    color: Colors.text,
  },
  retryButton: {
    alignSelf: "flex-start",
    backgroundColor: "#0F172A",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  retryLabel: {
    ...Typography.bodyStrong,
    color: "#FFFFFF",
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
    borderColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  captureButtonDisabled: {
    opacity: 0.45,
  },
  captureButtonInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: "#FFFFFF",
  },
});
