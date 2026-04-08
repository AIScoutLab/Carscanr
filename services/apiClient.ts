type HttpMethod = "GET" | "POST" | "DELETE";
import { authService } from "@/services/authService";
import { getApiBaseUrlOrThrow, mobileEnv } from "@/lib/env";

export type ApiRequest<TBody = unknown> = {
  path: string;
  method?: HttpMethod;
  body?: TBody;
  headers?: Record<string, string>;
  formData?: FormData;
  authRequired?: boolean;
};

export type ApiEnvelope<T, TMeta = Record<string, unknown>> =
  | {
      success: true;
      data: T;
      meta?: TMeta;
      requestId?: string;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
      requestId?: string;
    };

export type ApiSuccessEnvelope<T, TMeta = Record<string, unknown>> = Extract<ApiEnvelope<T, TMeta>, { success: true }>;

export class ApiRequestError extends Error {
  code?: string;
  details?: unknown;

  constructor(message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = "ApiRequestError";
    this.code = options?.code;
    this.details = options?.details;
  }
}

const API_BASE_URL = mobileEnv.apiBaseUrl;
let lastAuthDebug: {
  path: string;
  method: HttpMethod;
  hadToken: boolean;
  sentAuthHeader: boolean;
  baseUrl: string | undefined;
} | null = null;

export function getApiAuthDebug() {
  return lastAuthDebug;
}
const RETRY_DELAYS_MS = [250, 800];
const REQUEST_TIMEOUT_MS = 20000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (controller) {
        try {
          controller.abort();
        } catch {
          // best effort
        }
      }
      reject(new ApiRequestError("Request timed out. Check your network connection and try again."));
    }, timeoutMs);
  });
  const fetchPromise = fetch(url, { ...options, signal: controller?.signal }).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
  return Promise.race([fetchPromise, timeoutPromise]) as Promise<Response>;
}

function buildUrl(path: string) {
  return `${getApiBaseUrlOrThrow()}${path}`;
}

function isRetriable(status?: number) {
  return status === undefined || status === 429 || status >= 500;
}

async function parseEnvelope<T, TMeta = Record<string, unknown>>(response: Response): Promise<ApiEnvelope<T, TMeta>> {
  const text = await response.text();
  if (!text) {
    throw new Error("Backend returned an empty response.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Backend returned invalid JSON.");
  }

  return payload as ApiEnvelope<T, TMeta>;
}

function normalizeTransportError(error: Error, path: string) {
  const baseUrl = API_BASE_URL || "the configured backend";
  const lowered = error.message.toLowerCase();
  if (lowered.includes("network request failed") || lowered.includes("load failed") || lowered.includes("fetch failed")) {
    return new ApiRequestError(`Unable to reach the CarScanr backend at ${baseUrl}. Check the backend URL, network connection, and server health before retrying.`, {
      code: "BACKEND_UNREACHABLE",
      details: { path, baseUrl },
    });
  }
  return error;
}

export async function apiRequest<TResponse>({
  path,
  method = "GET",
  body,
  headers,
  formData,
  authRequired = true,
}: ApiRequest): Promise<TResponse> {
  let lastError: Error | null = null;
  const accessToken = await authService.getAccessToken();
  if (__DEV__) {
    console.log(`[api] ${method} ${path} auth=${accessToken ? "yes" : "no"} base=${API_BASE_URL || "unset"}`);
  }

  if (authRequired && !accessToken) {
    lastAuthDebug = {
      path,
      method,
      hadToken: false,
      sentAuthHeader: false,
      baseUrl: API_BASE_URL,
    };
    throw new ApiRequestError("Sign in to continue.", { code: "AUTH_REQUIRED" });
  }

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      lastAuthDebug = {
        path,
        method,
        hadToken: Boolean(accessToken),
        sentAuthHeader: Boolean(accessToken),
        baseUrl: API_BASE_URL,
      };
      const response = await fetchWithTimeout(buildUrl(path), {
        method,
        headers: formData
          ? {
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined),
              ...headers,
            }
          : {
              "Content-Type": "application/json",
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined),
              ...headers,
            },
        body: formData ?? (body ? JSON.stringify(body) : undefined),
      });

      const envelope = await parseEnvelope<TResponse>(response);

      if (!response.ok) {
        const message = envelope.success
          ? `Request failed with status ${response.status}`
          : envelope.error.message;
        if (attempt < RETRY_DELAYS_MS.length && isRetriable(response.status)) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        throw new ApiRequestError(message, envelope.success ? undefined : { code: envelope.error.code, details: envelope.error.details });
      }

      if (!envelope.success) {
        throw new ApiRequestError(envelope.error.message, { code: envelope.error.code, details: envelope.error.details });
      }

      return envelope.data as TResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new ApiRequestError("Request timed out. Check your network connection and try again.");
      } else {
        lastError = error instanceof Error ? normalizeTransportError(error, path) : new Error("Unknown API request error.");
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
    }
  }

  throw lastError ?? new Error(`API request failed for ${path}`);
}

export async function apiRequestEnvelope<TResponse, TMeta = Record<string, unknown>>({
  path,
  method = "GET",
  body,
  headers,
  formData,
  authRequired = true,
}: ApiRequest): Promise<ApiSuccessEnvelope<TResponse, TMeta>> {
  let lastError: Error | null = null;
  const accessToken = await authService.getAccessToken();
  if (__DEV__) {
    console.log(`[api] ${method} ${path} auth=${accessToken ? "yes" : "no"} base=${API_BASE_URL || "unset"}`);
  }

  if (authRequired && !accessToken) {
    lastAuthDebug = {
      path,
      method,
      hadToken: false,
      sentAuthHeader: false,
      baseUrl: API_BASE_URL,
    };
    throw new ApiRequestError("Sign in to continue.", { code: "AUTH_REQUIRED" });
  }

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      lastAuthDebug = {
        path,
        method,
        hadToken: Boolean(accessToken),
        sentAuthHeader: Boolean(accessToken),
        baseUrl: API_BASE_URL,
      };
      const response = await fetchWithTimeout(buildUrl(path), {
        method,
        headers: formData
          ? {
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined),
              ...headers,
            }
          : {
              "Content-Type": "application/json",
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined),
              ...headers,
            },
        body: formData ?? (body ? JSON.stringify(body) : undefined),
      });

      const envelope = await parseEnvelope<TResponse, TMeta>(response);

      if (!response.ok) {
        const message = envelope.success
          ? `Request failed with status ${response.status}`
          : envelope.error.message;
        if (attempt < RETRY_DELAYS_MS.length && isRetriable(response.status)) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        throw new ApiRequestError(message, envelope.success ? undefined : { code: envelope.error.code, details: envelope.error.details });
      }

      if (!envelope.success) {
        throw new ApiRequestError(envelope.error.message, { code: envelope.error.code, details: envelope.error.details });
      }

      return envelope as ApiSuccessEnvelope<TResponse, TMeta>;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new ApiRequestError("Request timed out. Check your network connection and try again.");
      } else {
        lastError = error instanceof Error ? normalizeTransportError(error, path) : new Error("Unknown API request error.");
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
    }
  }

  throw lastError ?? new Error(`API request failed for ${path}`);
}
