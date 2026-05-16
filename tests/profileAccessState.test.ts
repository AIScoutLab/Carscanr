import assert from "node:assert/strict";
import test from "node:test";
import { resolveProfileAccessState } from "@/lib/subscription";
import { SubscriptionStatus } from "@/types";

function status(input: Partial<SubscriptionStatus>): SubscriptionStatus {
  return {
    plan: "free",
    renewalLabel: "Upgrade for unlimited Pro details",
    scansUsed: 0,
    scansRemaining: null,
    limitType: "lifetime",
    limit: null,
    scansUsedToday: 0,
    dailyScanLimit: null,
    purchaseAvailabilityState: "ready",
    purchaseAvailable: true,
    availableProducts: [],
    ...input,
  };
}

test("profile access state never renders free plan and active pro together", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "free",
      provider: "placeholder",
      renewalLabel: "Pro active",
      isActive: false,
    }),
  );

  assert.equal(resolved.planLabel, "Free plan");
  assert.equal(resolved.renewalLabel.includes("Pro active"), false);
  assert.equal(resolved.showUpgradeOptions, true);
  assert.equal(resolved.showFreeUnlockUsage, true);
});

test("profile hides upgrade card and free unlock usage when entitlement is active", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "pro_yearly",
      provider: "revenuecat",
      productId: "com.carscanr.pro.yearly",
      renewalLabel: "Pro active",
      isActive: true,
    }),
  );

  assert.equal(resolved.planLabel, "Pro yearly active");
  assert.equal(resolved.showUpgradeOptions, false);
  assert.equal(resolved.showFreeUnlockUsage, false);
});
