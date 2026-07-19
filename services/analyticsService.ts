export const analyticsEvents = [
  "app_opened",
  "onboarding_started",
  "onboarding_completed",
  "camera_screen_viewed",
  "camera_permission_requested",
  "camera_permission_granted",
  "camera_permission_denied",
  "scan_started",
  "photo_captured",
  "photo_selected",
  "identify_request_sent",
  "identify_succeeded",
  "identify_failed",
  "results_viewed",
  "marketcheck_request_sent",
  "marketcheck_request_succeeded",
  "marketcheck_request_failed",
  "garage_vehicle_saved",
  "account_created",
  "login_completed",
  "paywall_viewed",
  "unlock_pack_purchased",
  "subscription_started",
] as const;

export type AnalyticsEventName = (typeof analyticsEvents)[number];

export type AnalyticsEventProperties = Record<string, string | number | boolean | null | undefined>;

type AnalyticsClient = {
  capture: (eventName: string, properties?: any) => unknown;
  identify: (distinctId: string, userProperties?: any) => unknown;
  reset: () => unknown;
};

const SAFE_PROPERTY_KEYS = new Set([
  "action",
  "allow_live",
  "app_env",
  "auth_method",
  "backend_confirmed",
  "completion_type",
  "confirmation_required",
  "error_category",
  "force_live",
  "garage_source_type",
  "has_pro",
  "listing_count_bucket",
  "market_request_type",
  "outcome",
  "permission_state",
  "plan",
  "product_kind",
  "provider",
  "purchase_availability_state",
  "purchase_kind",
  "request_stage",
  "result_source",
  "result_status",
  "route",
  "scan_source",
  "source_screen",
  "step_count",
  "valuation_source",
  "valuation_status",
  "zip_source",
]);

const SENSITIVE_PROPERTY_PATTERN = /(email|token|secret|password|receipt|photo|image|uri|url|vin|jwt|authorization|bearer|transaction|license|plate)/i;

let analyticsClient: AnalyticsClient | null = null;
let analyticsAvailable = true;
let currentIdentifiedUserId: string | null = null;
const onceKeys = new Set<string>();
const pendingWork: Array<() => unknown> = [];
const MAX_PENDING_WORK = 50;

function logDevelopment(message: string, payload?: unknown) {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.log(`[analytics] ${message}`, payload ?? "");
  }
}

function logDevelopmentWarning(message: string, payload?: unknown) {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(`[analytics] ${message}`, payload ?? "");
  }
}

function toSnakeCase(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function sanitizeProperties(properties: AnalyticsEventProperties = {}) {
  const sanitized: Record<string, string | number | boolean | null> = {};

  Object.entries(properties).forEach(([key, value]) => {
    const normalizedKey = toSnakeCase(key);
    if (!SAFE_PROPERTY_KEYS.has(normalizedKey) || SENSITIVE_PROPERTY_PATTERN.test(normalizedKey)) {
      return;
    }
    if (value === undefined) {
      return;
    }
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      sanitized[normalizedKey] = value;
    }
  });

  return sanitized;
}

function scheduleAnalyticsWork(work: () => unknown) {
  if (!analyticsAvailable) {
    return;
  }
  if (!analyticsClient) {
    pendingWork.push(work);
    if (pendingWork.length > MAX_PENDING_WORK) {
      pendingWork.shift();
    }
    return;
  }
  Promise.resolve()
    .then(work)
    .catch((error) => {
      logDevelopmentWarning("delivery failed", normalizeErrorCategory(error));
    });
}

export const analyticsService = {
  setClient(client: AnalyticsClient | null, options?: { enabled?: boolean }) {
    analyticsClient = client;
    analyticsAvailable = Boolean(client && options?.enabled !== false);
    if (!analyticsAvailable) {
      pendingWork.length = 0;
      return;
    }
    const queued = pendingWork.splice(0);
    queued.forEach((work) => scheduleAnalyticsWork(work));
  },

  track(eventName: AnalyticsEventName, properties?: AnalyticsEventProperties) {
    const sanitized = sanitizeProperties(properties);
    logDevelopment("capture", { eventName, properties: sanitized });
    scheduleAnalyticsWork(() => analyticsClient?.capture(eventName, sanitized));
  },

  trackOnce(key: string, eventName: AnalyticsEventName, properties?: AnalyticsEventProperties) {
    if (onceKeys.has(key)) {
      return;
    }
    onceKeys.add(key);
    this.track(eventName, properties);
  },

  identifyUser(userId: string | null | undefined, properties?: AnalyticsEventProperties) {
    if (!userId || currentIdentifiedUserId === userId) {
      return;
    }
    currentIdentifiedUserId = userId;
    const sanitized = sanitizeProperties(properties);
    logDevelopment("identify", { userIdPresent: true, properties: sanitized });
    scheduleAnalyticsWork(() => analyticsClient?.identify(userId, sanitized));
  },

  resetIdentity() {
    currentIdentifiedUserId = null;
    logDevelopment("reset identity");
    scheduleAnalyticsWork(() => analyticsClient?.reset());
  },
};

export function normalizeErrorCategory(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const raw = (code || message || "unknown").toLowerCase();

  if (raw.includes("timeout")) return "timeout";
  if (raw.includes("network") || raw.includes("fetch") || raw.includes("offline")) return "network";
  if (raw.includes("auth") || raw.includes("unauthorized") || raw.includes("forbidden")) return "auth";
  if (raw.includes("permission") || raw.includes("denied")) return "permission_denied";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("marketcheck") || raw.includes("provider")) return "provider";
  if (raw.includes("premium") || raw.includes("unlock")) return "access_required";
  return code ? toSnakeCase(code) : "unknown";
}

export function bucketCount(count: number | null | undefined) {
  if (typeof count !== "number" || !Number.isFinite(count)) return "unknown";
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 5) return "2_5";
  if (count <= 10) return "6_10";
  return "11_plus";
}

export const analyticsTestUtils = {
  sanitizeProperties,
  resetForTest() {
    analyticsClient = null;
    analyticsAvailable = true;
    currentIdentifiedUserId = null;
    onceKeys.clear();
    pendingWork.length = 0;
  },
};
