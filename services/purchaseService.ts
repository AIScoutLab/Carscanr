import Constants from "expo-constants";
import Purchases from "react-native-purchases";
import type { CustomerInfo, PurchasesEntitlementInfo, PurchasesPackage } from "@revenuecat/purchases-typescript-internal";
import { mobileEnv } from "@/lib/env";
import { getMissingPurchaseOptionKinds, getPurchaseOptionKind } from "@/lib/purchaseOptions";
import { authService } from "@/services/authService";
import { guestSessionService } from "@/services/guestSessionService";
import { PurchaseOptionKind, SubscriptionProduct } from "@/types";

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

function classifyPackage(pkg: PurchasesPackage): PurchaseOptionKind {
  const product = pkg.product;
  const normalized = [
    pkg.identifier,
    pkg.packageType,
    product.identifier,
    product.title,
    product.description,
    product.productCategory,
    product.productType,
    product.subscriptionPeriod,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  if (pkg.packageType === "ANNUAL" || product.subscriptionPeriod === "P1Y" || normalized.includes("annual") || normalized.includes("year")) {
    return "annual";
  }
  if (pkg.packageType === "MONTHLY" || product.subscriptionPeriod === "P1M" || normalized.includes("monthly") || normalized.includes("month")) {
    return "monthly";
  }
  if (
    product.productCategory === "NON_SUBSCRIPTION" ||
    product.productType === "CONSUMABLE" ||
    product.productType === "NON_CONSUMABLE" ||
    normalized.includes("unlock") ||
    normalized.includes("credit") ||
    normalized.includes("pack")
  ) {
    return "unlock_pack";
  }
  return "other";
}

function mapPackageToProduct(pkg: PurchasesPackage): SubscriptionProduct {
  const product = pkg.product;
  const optionKind = classifyPackage(pkg);
  const billingPeriodLabel =
    optionKind === "unlock_pack"
      ? "unlock pack"
      : pkg.packageType === "MONTHLY"
      ? "month"
      : pkg.packageType === "ANNUAL"
        ? "year"
        : pkg.packageType === "WEEKLY"
          ? "week"
          : "period";

  return {
    productId: product.identifier,
    packageIdentifier: pkg.identifier,
    packageType: pkg.packageType,
    optionKind,
    platform: "ios",
    plan: "pro",
    priceLabel: product.priceString,
    billingPeriodLabel,
    title: product.title,
    description: product.description,
  };
}

function logPackageAvailability(availableProducts: SubscriptionProduct[], context: Record<string, unknown>) {
  for (const product of availableProducts) {
    console.log("PAYWALL_PACKAGE_RENDERED", {
      ...context,
      productId: product.productId,
      packageIdentifier: product.packageIdentifier ?? null,
      optionKind: getPurchaseOptionKind(product),
      priceLabel: product.priceLabel,
    });
  }
  for (const missingKind of getMissingPurchaseOptionKinds(availableProducts)) {
    console.log("PAYWALL_PACKAGE_MISSING", {
      ...context,
      optionKind: missingKind,
      availableKinds: availableProducts.map(getPurchaseOptionKind),
      reason: availableProducts.length > 0 ? "revenuecat_current_offering_missing_package" : "no_revenuecat_packages_returned",
    });
  }
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
  console.log("ENTITLEMENT_LOOKUP_STARTED", {
    configured: config.configured,
    expoGo: isExpoGo(),
    hasApiKey: Boolean(config.apiKey),
    hasEntitlementId: Boolean(config.entitlementId),
  });
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
    console.log("ENTITLEMENT_ACCOUNT_LINK", {
      mode: "configure",
      appUserId,
    });
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
    console.log("ENTITLEMENT_ACCOUNT_LINK", {
      mode: "login",
      appUserId,
    });
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
      console.log("PAYWALL_OFFERINGS_LOAD_STARTED", {
        configured: false,
        reason: configuration.reason,
      });
      console.log("PAYWALL_OFFERINGS_LOAD_RESULT", {
        configured: false,
        reason: configuration.reason,
        packageCount: 0,
      });
      logPackageAvailability([], {
        configured: false,
        reason: configuration.reason,
      });
      console.log("ENTITLEMENT_LOOKUP_RESULT", {
        configured: false,
        reason: configuration.reason,
      });
      return {
        purchaseAvailable: false,
        purchaseAvailabilityState: configuration.reason === "expo_go_preview" ? "preview_only" : "not_configured",
        availableProducts: [],
        activeEntitlement: null,
        activeProductId: null,
        managementUrl: null,
      };
    }

    console.log("PAYWALL_OFFERINGS_LOAD_STARTED", {
      configured: true,
      appUserId: configuration.appUserId,
    });
    const [offerings, customerInfo] = await Promise.all([
      Purchases.getOfferings(),
      Purchases.getCustomerInfo(),
    ]);
    const availableProducts = (offerings.current?.availablePackages ?? []).map(mapPackageToProduct);
    const activeEntitlement = resolveActiveEntitlement(customerInfo);
    console.log("PAYWALL_OFFERINGS_LOAD_RESULT", {
      configured: true,
      appUserId: configuration.appUserId,
      currentOffering: offerings.current?.identifier ?? null,
      packageCount: availableProducts.length,
      packages: availableProducts.map((product) => ({
        productId: product.productId,
        packageIdentifier: product.packageIdentifier,
        optionKind: getPurchaseOptionKind(product),
      })),
    });
    logPackageAvailability(availableProducts, {
      configured: true,
      currentOffering: offerings.current?.identifier ?? null,
    });
    console.log("ENTITLEMENT_LOOKUP_RESULT", {
      configured: true,
      appUserId: configuration.appUserId,
      purchaseAvailable: availableProducts.length > 0,
      activeEntitlement: activeEntitlement?.identifier ?? null,
      activeProductId: activeEntitlement?.productIdentifier ?? null,
    });
    return {
      purchaseAvailable: availableProducts.length > 0,
      purchaseAvailabilityState: availableProducts.length > 0 ? "ready" : "not_configured",
      availableProducts,
      activeEntitlement,
      activeProductId: activeEntitlement?.productIdentifier ?? null,
      managementUrl: customerInfo.managementURL,
    };
  },

  async purchasePro(selectedProductKey?: string | null) {
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

    console.log("PAYWALL_PURCHASE_OPTION_SELECTED", {
      selectedProductKey: selectedProductKey ?? null,
    });

    const offerings = await Purchases.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    const packageOptions = packages.map((pkg) => ({
      pkg,
      product: mapPackageToProduct(pkg),
    }));
    const targetOption = selectedProductKey
      ? packageOptions.find(
          (option) =>
            option.pkg.identifier === selectedProductKey ||
            option.pkg.product.identifier === selectedProductKey ||
            option.product.packageIdentifier === selectedProductKey ||
            option.product.productId === selectedProductKey,
        ) ?? null
      : packageOptions.find((option) => option.product.optionKind === "annual") ?? packageOptions[0] ?? null;
    const targetPackage = targetOption?.pkg ?? null;

    if (!targetPackage) {
      return {
        snapshot: await this.getPurchaseSnapshot(),
        outcome: "not_configured" as const,
        message: selectedProductKey
          ? "The selected RevenueCat package is not available in this build."
          : "No purchasable RevenueCat package is configured for this build yet.",
      };
    }

    console.log("PAYWALL_PURCHASE_OPTION_SELECTED", {
      selectedProductKey: selectedProductKey ?? null,
      productId: targetPackage.product.identifier,
      packageIdentifier: targetPackage.identifier,
      optionKind: classifyPackage(targetPackage),
    });

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
    console.log("ENTITLEMENT_RESTORE_ATTEMPT", {
      configured: configuration.configured,
      reason: configuration.configured ? null : configuration.reason,
    });
    if (!configuration.configured) {
      console.log("ENTITLEMENT_RESTORE_SKIPPED_CONFIG_MISSING", {
        reason: configuration.reason,
      });
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
    console.log("ENTITLEMENT_RESTORE_RESULT", {
      configured: true,
      restoredEntitlements: Object.keys(customerInfo.entitlements.active ?? {}),
      activeEntitlement: resolveActiveEntitlement(customerInfo)?.identifier ?? null,
    });
    return {
      snapshot: await this.getPurchaseSnapshot(),
      outcome: "restored" as const,
      customerInfo,
      message: "Purchases restored successfully.",
    };
  },
};
