import Constants from "expo-constants";
import Purchases from "react-native-purchases";
import type { CustomerInfo, PurchasesEntitlementInfo, PurchasesPackage } from "@revenuecat/purchases-typescript-internal";
import { mobileEnv } from "@/lib/env";
import { authService } from "@/services/authService";
import { guestSessionService } from "@/services/guestSessionService";
import { SubscriptionProduct } from "@/types";

type PurchaseAvailabilityState = "ready" | "preview_only" | "not_configured";

type PurchaseSnapshot = {
  purchaseAvailable: boolean;
  purchaseAvailabilityState: PurchaseAvailabilityState;
  availableProducts: SubscriptionProduct[];
  activeEntitlement: PurchasesEntitlementInfo | null;
  activeProductId: string | null;
  managementUrl: string | null;
};

let configuredAppUserId: string | null = null;
let purchasesConfigured = false;

function isExpoGo() {
  return Constants.executionEnvironment === "storeClient";
}

function getRevenueCatConfig() {
  const apiKey = mobileEnv.revenueCatIosApiKey;
  const entitlementId = mobileEnv.revenueCatEntitlementId;
  return {
    apiKey,
    entitlementId,
    configured: Boolean(apiKey && entitlementId),
  };
}

function mapPackageToProduct(pkg: PurchasesPackage): SubscriptionProduct {
  const product = pkg.product;
  const billingPeriodLabel =
    pkg.packageType === "MONTHLY"
      ? "month"
      : pkg.packageType === "ANNUAL"
        ? "year"
        : pkg.packageType === "WEEKLY"
          ? "week"
          : "period";

  return {
    productId: product.identifier,
    platform: "ios",
    plan: "pro",
    priceLabel: product.priceString,
    billingPeriodLabel,
  };
}

async function getAppUserId() {
  const user = await authService.getCurrentUser();
  if (user?.id) {
    return user.id;
  }
  return guestSessionService.getGuestId();
}

async function ensureConfigured() {
  const config = getRevenueCatConfig();
  if (!config.configured) {
    return { configured: false as const, reason: "missing_env" as const };
  }
  if (isExpoGo()) {
    return { configured: false as const, reason: "expo_go_preview" as const };
  }

  const appUserId = await getAppUserId();
  if (!purchasesConfigured) {
    Purchases.configure({
      apiKey: config.apiKey,
      appUserID: appUserId,
    });
    if (__DEV__) {
      await Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
    }
    configuredAppUserId = appUserId;
    purchasesConfigured = true;
    return { configured: true as const, appUserId };
  }

  if (configuredAppUserId && configuredAppUserId !== appUserId) {
    await Purchases.logIn(appUserId).catch(async () => {
      Purchases.configure({
        apiKey: config.apiKey,
        appUserID: appUserId,
      });
    });
    configuredAppUserId = appUserId;
  }

  return { configured: true as const, appUserId };
}

function resolveActiveEntitlement(customerInfo: CustomerInfo) {
  const config = getRevenueCatConfig();
  if (config.entitlementId && customerInfo.entitlements.active[config.entitlementId]) {
    return customerInfo.entitlements.active[config.entitlementId];
  }
  return Object.values(customerInfo.entitlements.active)[0] ?? null;
}

export const purchaseService = {
  async getPurchaseSnapshot(): Promise<PurchaseSnapshot> {
    const configuration = await ensureConfigured();
    if (!configuration.configured) {
      return {
        purchaseAvailable: false,
        purchaseAvailabilityState: configuration.reason === "expo_go_preview" ? "preview_only" : "not_configured",
        availableProducts: [],
        activeEntitlement: null,
        activeProductId: null,
        managementUrl: null,
      };
    }

    const [offerings, customerInfo] = await Promise.all([
      Purchases.getOfferings(),
      Purchases.getCustomerInfo(),
    ]);
    const availableProducts = (offerings.current?.availablePackages ?? []).map(mapPackageToProduct);
    const activeEntitlement = resolveActiveEntitlement(customerInfo);
    return {
      purchaseAvailable: availableProducts.length > 0,
      purchaseAvailabilityState: availableProducts.length > 0 ? "ready" : "not_configured",
      availableProducts,
      activeEntitlement,
      activeProductId: activeEntitlement?.productIdentifier ?? null,
      managementUrl: customerInfo.managementURL,
    };
  },

  async purchasePro() {
    const configuration = await ensureConfigured();
    if (!configuration.configured) {
      return {
        snapshot: await this.getPurchaseSnapshot(),
        outcome: "not_configured" as const,
        message:
          configuration.reason === "expo_go_preview"
            ? "Purchases require a development or production build. Expo Go can preview the paywall, but it cannot complete real purchases."
            : "RevenueCat is not configured yet. Add the iOS API key and entitlement id before enabling purchases.",
      };
    }

    const offerings = await Purchases.getOfferings();
    const targetPackage =
      offerings.current?.monthly ??
      offerings.current?.annual ??
      offerings.current?.availablePackages?.[0] ??
      null;

    if (!targetPackage) {
      return {
        snapshot: await this.getPurchaseSnapshot(),
        outcome: "not_configured" as const,
        message: "No purchasable RevenueCat package is configured for this build yet.",
      };
    }

    const result = await Purchases.purchasePackage(targetPackage);
    return {
      snapshot: await this.getPurchaseSnapshot(),
      outcome: "verified" as const,
      customerInfo: result.customerInfo,
      productIdentifier: result.productIdentifier,
      message: "Pro purchase completed successfully.",
    };
  },

  async restorePurchases() {
    const configuration = await ensureConfigured();
    if (!configuration.configured) {
      return {
        snapshot: await this.getPurchaseSnapshot(),
        outcome: "not_configured" as const,
        message:
          configuration.reason === "expo_go_preview"
            ? "Restore requires a development or production build. Expo Go cannot restore real purchases."
            : "RevenueCat is not configured yet. Add the iOS API key and entitlement id before enabling restore.",
      };
    }

    const customerInfo = await Purchases.restorePurchases();
    return {
      snapshot: await this.getPurchaseSnapshot(),
      outcome: "restored" as const,
      customerInfo,
      message: "Purchases restored successfully.",
    };
  },
};
