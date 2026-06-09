import Constants from "expo-constants";
import { Linking } from "react-native";
import Purchases from "react-native-purchases";
import type { CustomerInfo, PurchasesEntitlementInfo, PurchasesPackage } from "@revenuecat/purchases-typescript-internal";
import { mobileEnv } from "@/lib/env";
import { getMissingPurchaseOptionKinds, getPurchaseOptionKind, getPurchaseOptionKindFromProductMetadata, isSubscriptionPurchaseOptionKind } from "@/lib/purchaseOptions";
import { authService } from "@/services/authService";
import { guestSessionService } from "@/services/guestSessionService";
import { PurchaseAvailabilityState, PurchaseOptionKind, SubscriptionProduct } from "@/types";

const REVENUECAT_SDK_VERSION = "react-native-purchases@10.0.1";

type PurchaseSnapshot = {
  purchaseAvailable: boolean;
  purchaseAvailabilityState: PurchaseAvailabilityState;
  availableProducts: SubscriptionProduct[];
  activeEntitlement: PurchasesEntitlementInfo | null;
  activeProductId: string | null;
  managementUrl: string | null;
};

type RevenueCatConfigurationFailureReason = "missing_env" | "expo_go_preview" | "configure_failed";

type RevenueCatConfigurationResult =
  | { configured: true; appUserId: string }
  | { configured: false; reason: RevenueCatConfigurationFailureReason; purchaseAvailabilityState: PurchaseAvailabilityState };

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

function getErrorDiagnostics(error: unknown) {
  const candidate = error as
    | {
        name?: unknown;
        message?: unknown;
        code?: unknown;
        userInfo?: unknown;
        underlyingErrorMessage?: unknown;
      }
    | undefined;
  return {
    name: typeof candidate?.name === "string" ? candidate.name : error instanceof Error ? error.name : "UnknownError",
    message: typeof candidate?.message === "string" ? candidate.message : error instanceof Error ? error.message : String(error),
    code: typeof candidate?.code === "string" || typeof candidate?.code === "number" ? candidate.code : null,
    underlyingErrorMessage: typeof candidate?.underlyingErrorMessage === "string" ? candidate.underlyingErrorMessage : null,
    userInfoKeys: candidate?.userInfo && typeof candidate.userInfo === "object" ? Object.keys(candidate.userInfo as Record<string, unknown>) : [],
  };
}

function shouldLogRevenueCatDiagnostics() {
  const flag = mobileEnv.showQaDebug.toLowerCase();
  return __DEV__ || flag === "1" || flag === "true";
}

function logRevenueCatDiagnostics(eventName: string, payload: Record<string, unknown>) {
  if (shouldLogRevenueCatDiagnostics()) {
    console.log(eventName, payload);
  }
}

function logRevenueCatRuntimeConfig(context: string) {
  const config = getRevenueCatConfig();
  logRevenueCatDiagnostics("REVENUECAT_RUNTIME_CONFIG", {
    context,
    sdkVersion: REVENUECAT_SDK_VERSION,
    executionEnvironment: Constants.executionEnvironment,
    apiKeyPresent: Boolean(config.apiKey),
    entitlementIdPresent: Boolean(config.entitlementId),
    purchasesConfigured,
    configured: config.configured,
    state: config.configured ? "configured_inputs_present" : "not_configured",
  });
  return config;
}

function logCustomerInfoDiagnostics(context: string, customerInfo: CustomerInfo, extra: Record<string, unknown> = {}) {
  const activeEntitlements = customerInfo.entitlements.active ?? {};
  const entitlementEntries = Object.entries(activeEntitlements).map(([identifier, entitlement]) => ({
    identifier,
    isActive: entitlement.isActive,
    productIdentifier: entitlement.productIdentifier ?? null,
    latestPurchaseDate: entitlement.latestPurchaseDate ?? null,
    expirationDate: entitlement.expirationDate ?? null,
    willRenew: entitlement.willRenew ?? null,
  }));
  const info = customerInfo as CustomerInfo & {
    activeSubscriptions?: string[];
    allPurchasedProductIdentifiers?: string[];
    originalAppUserId?: string;
    originalApplicationVersion?: string | null;
    requestDate?: string;
  };

  logRevenueCatDiagnostics("REVENUECAT_CUSTOMER_INFO_DIAGNOSTIC", {
    context,
    configuredAppUserId,
    originalAppUserId: info.originalAppUserId ?? null,
    requestDate: info.requestDate ?? null,
    activeSubscriptions: Array.isArray(info.activeSubscriptions) ? info.activeSubscriptions : [],
    allPurchasedProductIdentifiers: Array.isArray(info.allPurchasedProductIdentifiers) ? info.allPurchasedProductIdentifiers : [],
    activeEntitlementIdentifiers: Object.keys(activeEntitlements),
    activeEntitlements: entitlementEntries,
    ...extra,
  });
}

function emptyPurchaseSnapshot(purchaseAvailabilityState: PurchaseAvailabilityState): PurchaseSnapshot {
  return {
    purchaseAvailable: false,
    purchaseAvailabilityState,
    availableProducts: [],
    activeEntitlement: null,
    activeProductId: null,
    managementUrl: null,
  };
}

function getUnavailablePurchaseMessage(reason: RevenueCatConfigurationFailureReason) {
  if (reason === "expo_go_preview") {
    return "Purchases require a development or production build. Expo Go can preview the paywall, but it cannot complete real purchases.";
  }
  if (reason === "configure_failed") {
    return "RevenueCat configuration failed at runtime. Please try again later or contact support.";
  }
  return "RevenueCat configuration is missing from this build.";
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

async function ensureConfigured(): Promise<RevenueCatConfigurationResult> {
  const config = logRevenueCatRuntimeConfig("ensureConfigured");
  console.log("ENTITLEMENT_LOOKUP_STARTED", {
    configured: config.configured,
    expoGo: isExpoGo(),
    hasApiKey: Boolean(config.apiKey),
    hasEntitlementId: Boolean(config.entitlementId),
  });
  if (!config.configured) {
    logRevenueCatDiagnostics("REVENUECAT_CONFIG_STATE", {
      state: "not_configured",
      failurePoint: "missing_runtime_env",
      apiKeyPresent: Boolean(config.apiKey),
      entitlementIdPresent: Boolean(config.entitlementId),
    });
    return { configured: false, reason: "missing_env", purchaseAvailabilityState: "not_configured" };
  }
  if (isExpoGo()) {
    logRevenueCatDiagnostics("REVENUECAT_CONFIG_STATE", {
      state: "not_configured",
      failurePoint: "expo_go_preview",
      apiKeyPresent: Boolean(config.apiKey),
      entitlementIdPresent: Boolean(config.entitlementId),
    });
    return { configured: false, reason: "expo_go_preview", purchaseAvailabilityState: "preview_only" };
  }

  const appUserId = await getAppUserId();
  if (!purchasesConfigured) {
    logRevenueCatDiagnostics("REVENUECAT_CONFIGURE_ATTEMPT", {
      sdkVersion: REVENUECAT_SDK_VERSION,
      apiKeyPresent: Boolean(config.apiKey),
      entitlementIdPresent: Boolean(config.entitlementId),
      appUserIdPresent: Boolean(appUserId),
    });
    try {
      Purchases.configure({
        apiKey: config.apiKey,
        appUserID: appUserId,
      });
      logRevenueCatDiagnostics("REVENUECAT_CONFIGURE_RESULT", {
        success: true,
        sdkVersion: REVENUECAT_SDK_VERSION,
      });
    } catch (error) {
      logRevenueCatDiagnostics("REVENUECAT_CONFIGURE_RESULT", {
        success: false,
        sdkVersion: REVENUECAT_SDK_VERSION,
        error: getErrorDiagnostics(error),
      });
      return { configured: false, reason: "configure_failed", purchaseAvailabilityState: "configure_failed" };
    }
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

  logRevenueCatDiagnostics("REVENUECAT_CONFIGURE_SKIPPED", {
    reason: "already_configured",
    appUserIdPresent: Boolean(appUserId),
  });

  if (configuredAppUserId && configuredAppUserId !== appUserId) {
    await Purchases.logIn(appUserId).catch(async (error) => {
      logRevenueCatDiagnostics("REVENUECAT_LOGIN_RESULT", {
        success: false,
        error: getErrorDiagnostics(error),
      });
      try {
        Purchases.configure({
          apiKey: config.apiKey,
          appUserID: appUserId,
        });
        logRevenueCatDiagnostics("REVENUECAT_RECONFIGURE_RESULT", { success: true });
      } catch (configureError) {
        logRevenueCatDiagnostics("REVENUECAT_RECONFIGURE_RESULT", {
          success: false,
          error: getErrorDiagnostics(configureError),
        });
        throw configureError;
      }
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
  const configuredEntitlement = config.entitlementId ? customerInfo.entitlements.active[config.entitlementId] : null;
  const activeEntitlements = configuredEntitlement ? [configuredEntitlement] : Object.values(customerInfo.entitlements.active);
  const subscriptionEntitlement =
    activeEntitlements.find((entitlement) =>
      isSubscriptionPurchaseOptionKind(getPurchaseOptionKindFromProductMetadata({ productId: entitlement.productIdentifier })),
    ) ?? null;
  const ignoredEntitlementCount = activeEntitlements.filter((entitlement) => entitlement && entitlement !== subscriptionEntitlement).length;
  if (ignoredEntitlementCount > 0) {
    logRevenueCatDiagnostics("REVENUECAT_ENTITLEMENT_IGNORED", {
      reason: "non_subscription_product",
      ignoredEntitlementCount,
      productIdentifiers: activeEntitlements.map((entitlement) => entitlement.productIdentifier ?? null),
    });
  }
  return subscriptionEntitlement;
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
        purchaseAvailabilityState: configuration.purchaseAvailabilityState,
      });
      logPackageAvailability([], {
        configured: false,
        reason: configuration.reason,
      });
      console.log("ENTITLEMENT_LOOKUP_RESULT", {
        configured: false,
        reason: configuration.reason,
      });
      return emptyPurchaseSnapshot(configuration.purchaseAvailabilityState);
    }

    console.log("PAYWALL_OFFERINGS_LOAD_STARTED", {
      configured: true,
      appUserId: configuration.appUserId,
    });
    logRevenueCatDiagnostics("REVENUECAT_OFFERINGS_FETCH_ATTEMPT", {
      configured: true,
      sdkVersion: REVENUECAT_SDK_VERSION,
      apiKeyPresent: true,
      entitlementIdPresent: true,
    });
    let offerings: Awaited<ReturnType<typeof Purchases.getOfferings>>;
    try {
      offerings = await Purchases.getOfferings();
      logRevenueCatDiagnostics("REVENUECAT_OFFERINGS_FETCH_RESULT", {
        success: true,
        currentOfferingPresent: Boolean(offerings.current),
        currentOfferingIdentifier: offerings.current?.identifier ?? null,
        packageCount: offerings.current?.availablePackages?.length ?? 0,
        allOfferingIdentifiers: Object.keys(offerings.all ?? {}),
      });
    } catch (error) {
      logRevenueCatDiagnostics("REVENUECAT_OFFERINGS_FETCH_RESULT", {
        success: false,
        state: "offerings_unavailable",
        failurePoint: "offerings_request_failed",
        error: getErrorDiagnostics(error),
      });
      console.log("PAYWALL_OFFERINGS_LOAD_RESULT", {
        configured: true,
        appUserId: configuration.appUserId,
        packageCount: 0,
        purchaseAvailabilityState: "offerings_unavailable",
      });
      return emptyPurchaseSnapshot("offerings_unavailable");
    }

    logRevenueCatDiagnostics("REVENUECAT_CUSTOMER_INFO_FETCH_ATTEMPT", {
      configured: true,
      sdkVersion: REVENUECAT_SDK_VERSION,
    });
    const availableProducts = (offerings.current?.availablePackages ?? []).map(mapPackageToProduct);
    let customerInfo: CustomerInfo;
    try {
      customerInfo = await Purchases.getCustomerInfo();
      logCustomerInfoDiagnostics("purchase_snapshot", customerInfo, {
        appUserId: configuration.appUserId,
      });
      logRevenueCatDiagnostics("REVENUECAT_CUSTOMER_INFO_FETCH_RESULT", {
        success: true,
        activeEntitlementCount: Object.keys(customerInfo.entitlements.active ?? {}).length,
      });
    } catch (error) {
      logRevenueCatDiagnostics("REVENUECAT_CUSTOMER_INFO_FETCH_RESULT", {
        success: false,
        state: "customer_info_unavailable",
        failurePoint: "customer_info_request_failed",
        packageCount: availableProducts.length,
        error: getErrorDiagnostics(error),
      });
      console.log("PAYWALL_OFFERINGS_LOAD_RESULT", {
        configured: true,
        appUserId: configuration.appUserId,
        currentOffering: offerings.current?.identifier ?? null,
        packageCount: availableProducts.length,
        purchaseAvailabilityState: "customer_info_unavailable",
      });
      return emptyPurchaseSnapshot("customer_info_unavailable");
    }
    const activeEntitlement = resolveActiveEntitlement(customerInfo);
    logRevenueCatDiagnostics("REVENUECAT_RUNTIME_STATE", {
      state: availableProducts.length > 0 ? "configured" : "offerings_empty",
      offeringsFetchAttempted: true,
      offeringsFetchSucceeded: true,
      currentOfferingPresent: Boolean(offerings.current),
      currentOfferingIdentifier: offerings.current?.identifier ?? null,
      packageCount: availableProducts.length,
      entitlementIdPresent: true,
      configuredEntitlementMatched: Boolean(activeEntitlement),
      activeEntitlementIdentifiers: Object.keys(customerInfo.entitlements.active ?? {}),
      availablePackages: availableProducts.map((product) => ({
        productId: product.productId,
        packageIdentifier: product.packageIdentifier,
        optionKind: getPurchaseOptionKind(product),
      })),
    });
    console.log("PAYWALL_OFFERINGS_LOAD_RESULT", {
      configured: true,
      appUserId: configuration.appUserId,
      currentOffering: offerings.current?.identifier ?? null,
      packageCount: availableProducts.length,
      purchaseAvailabilityState: availableProducts.length > 0 ? "ready" : "offerings_empty",
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
      purchaseAvailabilityState: availableProducts.length > 0 ? "ready" : "offerings_empty",
      activeEntitlement: activeEntitlement?.identifier ?? null,
      activeProductId: activeEntitlement?.productIdentifier ?? null,
    });
    return {
      purchaseAvailable: availableProducts.length > 0,
      purchaseAvailabilityState: availableProducts.length > 0 ? "ready" : "offerings_empty",
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
        message: getUnavailablePurchaseMessage(configuration.reason),
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
          : "RevenueCat is configured, but no purchasable package was returned by the current offering.",
      };
    }

    console.log("PAYWALL_PURCHASE_OPTION_SELECTED", {
      selectedProductKey: selectedProductKey ?? null,
      productId: targetPackage.product.identifier,
      packageIdentifier: targetPackage.identifier,
      optionKind: classifyPackage(targetPackage),
    });

    const result = await Purchases.purchasePackage(targetPackage);
    logCustomerInfoDiagnostics("purchase_result", result.customerInfo, {
      appUserId: configuration.appUserId,
      productIdentifier: result.productIdentifier,
      targetPackageIdentifier: targetPackage.identifier,
      targetProductIdentifier: targetPackage.product.identifier,
    });
    return {
      snapshot: await this.getPurchaseSnapshot(),
      outcome: "verified" as const,
      customerInfo: result.customerInfo,
      productIdentifier: result.productIdentifier,
      message:
        getPurchaseOptionKindFromProductMetadata({ productId: result.productIdentifier }) === "unlock_pack"
          ? "5 unlocks added. Your account now has 5 premium unlocks."
          : "Pro purchase completed successfully.",
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
        message: getUnavailablePurchaseMessage(configuration.reason),
      };
    }

    const customerInfo = await Purchases.restorePurchases();
    logCustomerInfoDiagnostics("restore_result", customerInfo, {
      appUserId: configuration.appUserId,
    });
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

  async openSubscriptionManagement() {
    const configuration = await ensureConfigured();
    if (!configuration.configured) {
      return {
        snapshot: await this.getPurchaseSnapshot(),
        outcome: "not_configured" as const,
        message: getUnavailablePurchaseMessage(configuration.reason),
      };
    }

    const snapshot = await this.getPurchaseSnapshot();
    try {
      await Purchases.showManageSubscriptions();
    } catch (error) {
      if (!snapshot.managementUrl) {
        throw error;
      }
      await Linking.openURL(snapshot.managementUrl);
    }

    return {
      snapshot,
      outcome: "opened" as const,
      message: "Subscription management opened.",
    };
  },
};
