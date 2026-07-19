import assert from "node:assert/strict";
import test from "node:test";
import { analyticsEvents, analyticsService, analyticsTestUtils, bucketCount, normalizeErrorCategory } from "@/services/analyticsService";

test("analytics event catalog uses only snake_case names", () => {
  assert.equal(analyticsEvents.length, new Set(analyticsEvents).size);
  analyticsEvents.forEach((eventName) => {
    assert.match(eventName, /^[a-z][a-z0-9_]*$/);
  });
});

test("analytics sanitizer keeps documented safe properties and drops sensitive payloads", () => {
  const sanitized = analyticsTestUtils.sanitizeProperties({
    scan_source: "camera",
    request_stage: "identify_request",
    error_category: "timeout",
    email: "person@example.com",
    vin: "SECRET",
    imageUri: "file:///private/photo.jpg",
    receiptData: "receipt",
    raw_error_body: "provider response",
    nested: { unsafe: true } as never,
  });

  assert.deepEqual(sanitized, {
    scan_source: "camera",
    request_stage: "identify_request",
    error_category: "timeout",
  });
});

test("analytics capture is non-blocking when the client throws", async () => {
  analyticsTestUtils.resetForTest();
  analyticsService.setClient({
    capture() {
      throw new Error("delivery failed");
    },
    identify() {},
    reset() {},
  });

  assert.doesNotThrow(() => {
    analyticsService.track("scan_started", { scan_source: "camera" });
  });
  await Promise.resolve();
});

test("trackOnce prevents duplicate event delivery for the same local key", async () => {
  analyticsTestUtils.resetForTest();
  const events: string[] = [];
  analyticsService.setClient({
    capture(eventName) {
      events.push(eventName);
    },
    identify() {},
    reset() {},
  });

  analyticsService.trackOnce("app_opened:runtime", "app_opened");
  analyticsService.trackOnce("app_opened:runtime", "app_opened");
  await Promise.resolve();

  assert.deepEqual(events, ["app_opened"]);
});

test("analytics queues early work until the PostHog client is attached", async () => {
  analyticsTestUtils.resetForTest();
  const events: string[] = [];

  analyticsService.track("app_opened", { app_env: "production" });
  analyticsService.setClient({
    capture(eventName) {
      events.push(eventName);
    },
    identify() {},
    reset() {},
  });
  await Promise.resolve();

  assert.deepEqual(events, ["app_opened"]);
});

test("identity is internal-id only and reset clears the next identify", async () => {
  analyticsTestUtils.resetForTest();
  const identifies: Array<{ id: string; properties?: Record<string, unknown> }> = [];
  let resetCount = 0;
  analyticsService.setClient({
    capture() {},
    identify(id, properties) {
      identifies.push({ id, properties });
    },
    reset() {
      resetCount += 1;
    },
  });

  analyticsService.identifyUser("user-123", { app_env: "production", email: "person@example.com" });
  analyticsService.identifyUser("user-123", { app_env: "production" });
  analyticsService.resetIdentity();
  analyticsService.identifyUser("user-123", { app_env: "production" });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(resetCount, 1);
  assert.deepEqual(identifies, [
    { id: "user-123", properties: { app_env: "production" } },
    { id: "user-123", properties: { app_env: "production" } },
  ]);
});

test("analytics helpers normalize errors and bucket listing counts safely", () => {
  assert.equal(normalizeErrorCategory(new Error("Network request failed")), "network");
  assert.equal(normalizeErrorCategory({ code: "REQUEST_TIMEOUT" }), "timeout");
  assert.equal(bucketCount(null), "unknown");
  assert.equal(bucketCount(0), "0");
  assert.equal(bucketCount(4), "2_5");
  assert.equal(bucketCount(12), "11_plus");
});
