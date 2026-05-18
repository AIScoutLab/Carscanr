export const seededVehicleImages = {
  "2021-cadillac-ct4-premium-luxury": "https://commons.wikimedia.org/wiki/Special:FilePath/2020_Cadillac_CT4.jpg",
  "2020-honda-civic-ex": "https://commons.wikimedia.org/wiki/Special:FilePath/2019_Honda_Civic_LX_Sedan_in_Modern_Steel_Metallic%2C_front_left%2C_2024-10-28.jpg",
  "2018-kia-optima-ex": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=1200&q=80",
  "2019-ford-mustang-gt": "https://commons.wikimedia.org/wiki/Special:FilePath/2019_Ford_Mustang_GT_5.0_facelift_Side.jpg",
  "2022-tesla-model-3-long-range": "https://commons.wikimedia.org/wiki/Special:FilePath/Tesla_Model_3_%2852304163995%29.jpg",
  "2021-yamaha-yzf-r3-standard": "https://commons.wikimedia.org/wiki/Special:FilePath/5-YZF_R3_2021.jpg",
  "2023-harley-davidson-street-glide-special": "https://commons.wikimedia.org/wiki/Special:FilePath/2015_Street_Glide_Special.jpg",
} as const;

export const legacyGenericSportsCarImage =
  "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1200&q=80";

const neutralVehiclePlaceholderImage = "https://placehold.co/1200x675/111827/94a3b8.png?text=CarScanr";
const unsafeFordExpeditionFallbackImage =
  "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1200&q=80";
const pickupTruckFallbackImage =
  "https://placehold.co/1200x675/0b1220/e2e8f0.png?text=Pickup%20truck";

const bodyStyleVehicleImages = {
  truck: pickupTruckFallbackImage,
  suv: "https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&w=1200&q=80",
  sedan: seededVehicleImages["2018-kia-optima-ex"],
  coupe: seededVehicleImages["2019-ford-mustang-gt"],
  wagon: "https://commons.wikimedia.org/wiki/Special:FilePath/2019_Volvo_V60_Inscription_D4_Automatic_2.0_Front.jpg",
  hatchback: "https://commons.wikimedia.org/wiki/Special:FilePath/2018_Toyota_Corolla_Icon_Tech_VVT-i_Hybrid_1.8_Front.jpg",
  convertible: "https://commons.wikimedia.org/wiki/Special:FilePath/2019_Mazda_MX-5_RF_Sport_Nav%2B_2.0_Front.jpg",
  van: "https://commons.wikimedia.org/wiki/Special:FilePath/2021_Chrysler_Pacifica_Touring_L%2C_front_4.17.21.jpg",
} as const;

const modelFamilyVehicleImages: Record<string, string> = {};

const genericVehicleImages = {
  car: neutralVehiclePlaceholderImage,
  truck: neutralVehiclePlaceholderImage,
  motorcycle: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1200&q=80",
} as const;

export type NormalizedVehicleType = "car" | "truck" | "motorcycle";

export type VehicleIdentityInput = {
  vehicleId?: string | null;
  make?: string | null;
  model?: string | null;
  vehicleType?: string | null;
  bodyStyle?: string | null;
};

export type NormalizedVehicleIdentity = {
  vehicleType: NormalizedVehicleType;
  bodyStyle: string | null;
  bodyStyleKey: keyof typeof bodyStyleVehicleImages | null;
  normalizationApplied: boolean;
  normalizationReason: string | null;
};

export type VehicleImageFallbackType =
  | "seeded"
  | "model-family"
  | "pickup-truck-fallback"
  | "body-style-truck"
  | "body-style-suv"
  | "body-style-sedan"
  | "body-style-coupe"
  | "body-style-wagon"
  | "body-style-hatchback"
  | "body-style-convertible"
  | "body-style-van"
  | "motorcycle-placeholder"
  | "neutral-placeholder";

export type VehicleImageResolution = {
  uri: string;
  source: "vehicle" | "model-family" | "body-style" | "placeholder";
  fallbackType: VehicleImageFallbackType;
};

type ImageDescriptor = {
  model: string | null;
  category: "pickup" | "suv" | "crossover" | "sports" | "sedan" | "motorcycle" | "placeholder" | "unknown";
};

function normalizeBodyStyle(bodyStyle?: string | null): keyof typeof bodyStyleVehicleImages | null {
  const normalized = bodyStyle?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (/\b(pickup|truck)\b/.test(normalized)) return "truck";
  if (/\b(suv|crossover|utility)\b/.test(normalized)) return "suv";
  if (/\b(wagon|estate)\b/.test(normalized)) return "wagon";
  if (/\b(hatch|hatchback)\b/.test(normalized)) return "hatchback";
  if (/\b(convertible|cabriolet|roadster)\b/.test(normalized)) return "convertible";
  if (/\b(van|minivan)\b/.test(normalized)) return "van";
  if (/\b(coupe|2-door|two-door)\b/.test(normalized)) return "coupe";
  if (/\b(sedan|saloon)\b/.test(normalized)) return "sedan";
  return null;
}

function buildVehicleIdentityText(input: VehicleIdentityInput) {
  return [input.vehicleId, input.make, input.model]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function normalizeFamilyKey(make?: string | null, model?: string | null) {
  return [make, model]
    .map((value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"))
    .filter(Boolean)
    .join("-");
}

function normalizeRequestedModel(input: VehicleIdentityInput) {
  const modelText = String(input.model ?? input.vehicleId ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (/\branger\b/.test(modelText)) return "ranger";
  if (/\bct4\b/.test(modelText)) return "ct4";
  return modelText || null;
}

function describeImageUri(uri?: string | null): ImageDescriptor {
  const normalized = String(uri ?? "").trim().toLowerCase();
  if (!normalized) return { model: null, category: "unknown" };
  if (normalized === pickupTruckFallbackImage.toLowerCase()) return { model: "pickup-fallback", category: "pickup" };
  if (normalized === neutralVehiclePlaceholderImage.toLowerCase()) return { model: "neutral-placeholder", category: "placeholder" };
  if (normalized === unsafeFordExpeditionFallbackImage.toLowerCase()) return { model: "expedition", category: "suv" };
  if (/expedition/.test(normalized)) return { model: "expedition", category: "suv" };
  if (/explorer/.test(normalized)) return { model: "explorer", category: "suv" };
  if (/bronco/.test(normalized)) return { model: "bronco", category: "suv" };
  if (/(suv|crossover|utility)/.test(normalized)) return { model: null, category: "suv" };
  if (/(camaro|mustang|corvette|sports)/.test(normalized)) return { model: null, category: "sports" };
  if (/ct4/.test(normalized)) return { model: "ct4", category: "sedan" };
  if (/ranger/.test(normalized)) return { model: "ranger", category: "pickup" };
  return { model: null, category: "unknown" };
}

export function isFordRangerIdentity(input: VehicleIdentityInput) {
  const normalized = buildVehicleIdentityText(input);
  return /\bford\b[\s\S]*\branger\b|\branger\b/.test(normalized);
}

function shouldRejectImageForIdentity(input: VehicleIdentityInput, uri?: string | null) {
  const requestedModel = normalizeRequestedModel(input);
  const resolvedImage = describeImageUri(uri);
  const rangerIdentity = isFordRangerIdentity(input);
  const unsafeForRanger =
    rangerIdentity &&
    (resolvedImage.category === "suv" ||
      resolvedImage.category === "crossover" ||
      resolvedImage.category === "sports" ||
      (resolvedImage.model !== null &&
        resolvedImage.model !== "ranger" &&
        resolvedImage.model !== "pickup-fallback" &&
        resolvedImage.model !== "neutral-placeholder"));
  const modelMismatchWithUnsafeCategory =
    requestedModel !== null &&
    resolvedImage.model !== null &&
    resolvedImage.model !== requestedModel &&
    (resolvedImage.category === "suv" || resolvedImage.category === "crossover");

  if (unsafeForRanger || modelMismatchWithUnsafeCategory) {
    console.warn("[vehicle-images] IMAGE_RESOLUTION_REJECTED_UNSAFE_IMAGE", {
      make: input.make ?? null,
      model: input.model ?? null,
      bodyStyle: input.bodyStyle ?? null,
      vehicleId: input.vehicleId ?? null,
      label: "IMAGE_RESOLUTION_REJECTED_UNSAFE_IMAGE",
      requestedModel,
      resolvedImageModel: resolvedImage.model,
      resolvedImageCategory: resolvedImage.category,
      resolvedImageSource: uri ?? null,
      IMAGE_MODEL_REQUESTED: requestedModel,
      IMAGE_MODEL_RESOLVED: resolvedImage.model,
      IMAGE_REJECT_REASON: unsafeForRanger ? "ranger-unsafe-ford-family-or-suv-image" : "model-mismatch-unsafe-category",
    });
    return true;
  }

  return false;
}

export function isSafeVehicleImageForIdentity(input: VehicleIdentityInput, uri?: string | null) {
  if (!uri?.trim()) return false;
  const rejected = shouldRejectImageForIdentity(input, uri);
  if (!rejected) {
    const resolvedImage = describeImageUri(uri);
    console.log("[vehicle-images] IMAGE_SAFE_MATCH_ACCEPTED", {
      make: input.make ?? null,
      model: input.model ?? null,
      bodyStyle: input.bodyStyle ?? null,
      vehicleId: input.vehicleId ?? null,
      resolvedImageModel: resolvedImage.model,
      resolvedImageCategory: resolvedImage.category,
      resolvedImageSource: uri,
      IMAGE_MODEL_REQUESTED: normalizeRequestedModel(input),
      IMAGE_MODEL_RESOLVED: resolvedImage.model,
    });
  }
  return !rejected;
}

function inferBodyStyleFromIdentity(input: VehicleIdentityInput): keyof typeof bodyStyleVehicleImages | null {
  const normalized = buildVehicleIdentityText(input);
  if (!normalized) return null;
  if (/\b(ranger|f 150|f150|maverick|frontier|canyon|colorado|ridgeline|tacoma|tundra|silverado|sierra|ram 1500|gladiator|santa cruz)\b/.test(normalized)) {
    return "truck";
  }
  if (/\b(explorer|escape|bronco|edge|expedition|rav4|cr v|crv|pilot|highlander|4runner|yukon|tahoe|suburban|wrangler|cherokee|grand cherokee)\b/.test(normalized)) {
    return "suv";
  }
  return null;
}

function resolveTrustedBodyStyle(input: {
  vehicleId: string;
  make?: string | null;
  model?: string | null;
  bodyStyle?: string | null;
}): keyof typeof bodyStyleVehicleImages | null {
  const inferredFromIdentity = inferBodyStyleFromIdentity(input);
  if (inferredFromIdentity === "truck") {
    return "truck";
  }

  return normalizeBodyStyle(input.bodyStyle) ?? inferredFromIdentity;
}

export function normalizeVehicleIdentityForRendering(input: VehicleIdentityInput): NormalizedVehicleIdentity {
  const bodyStyleKey = resolveTrustedBodyStyle({
    vehicleId: input.vehicleId ?? "",
    make: input.make,
    model: input.model,
    bodyStyle: input.bodyStyle,
  });
  const incomingVehicleType = String(input.vehicleType ?? "").trim().toLowerCase();
  const rangerIdentity = isFordRangerIdentity(input);

  if (rangerIdentity || bodyStyleKey === "truck" || incomingVehicleType === "truck") {
    return {
      vehicleType: "truck",
      bodyStyle: "Pickup truck",
      bodyStyleKey: "truck",
      normalizationApplied: incomingVehicleType !== "truck" || normalizeBodyStyle(input.bodyStyle) !== "truck",
      normalizationReason: rangerIdentity ? "ford_ranger_identity" : "truck_body_style",
    };
  }

  if (incomingVehicleType === "motorcycle") {
    return {
      vehicleType: "motorcycle",
      bodyStyle: input.bodyStyle?.trim() || null,
      bodyStyleKey,
      normalizationApplied: false,
      normalizationReason: null,
    };
  }

  return {
    vehicleType: "car",
    bodyStyle: input.bodyStyle?.trim() || null,
    bodyStyleKey,
    normalizationApplied: false,
    normalizationReason: null,
  };
}

export function isGeneratedVehicleFallbackImageUri(uri?: string | null) {
  const normalized = uri?.trim() ?? "";
  if (!normalized) {
    return false;
  }
  return (
    normalized === legacyGenericSportsCarImage ||
    normalized === genericVehicleImages.car ||
    normalized === genericVehicleImages.motorcycle ||
    Object.values(bodyStyleVehicleImages).includes(normalized as (typeof bodyStyleVehicleImages)[keyof typeof bodyStyleVehicleImages])
  );
}

export function resolveVehicleImageSource(input: {
  vehicleId: string;
  make?: string | null;
  model?: string | null;
  vehicleType?: string | null;
  bodyStyle?: string | null;
}): VehicleImageResolution {
  const logContext = {
    make: input.make ?? null,
    model: input.model ?? null,
    bodyStyle: input.bodyStyle ?? null,
  };
  console.log("[vehicle-images] IMAGE_RESOLUTION_STARTED", {
    ...logContext,
    vehicleId: input.vehicleId,
    vehicleType: input.vehicleType ?? null,
  });

  const seeded = seededVehicleImages[input.vehicleId as keyof typeof seededVehicleImages];
  if (seeded) {
    if (shouldRejectImageForIdentity(input, seeded)) {
      console.warn("[vehicle-images] IMAGE_REJECT_REASON", {
        ...logContext,
        vehicleId: input.vehicleId,
        reason: "exact-image-rejected",
      });
    } else {
      const resolvedImage = describeImageUri(seeded);
      console.log("[vehicle-images] IMAGE_MODEL_REQUESTED", {
        ...logContext,
        vehicleId: input.vehicleId,
        requestedModel: normalizeRequestedModel(input),
      });
      console.log("[vehicle-images] IMAGE_MODEL_RESOLVED", {
        ...logContext,
        vehicleId: input.vehicleId,
        resolvedImageModel: resolvedImage.model,
      });
      console.log("[vehicle-images] IMAGE_SAFE_MATCH_ACCEPTED", {
        ...logContext,
        vehicleId: input.vehicleId,
        resolvedImageModel: resolvedImage.model,
        resolvedImageSource: seeded,
      });
      console.log("[vehicle-images] IMAGE_RESOLUTION_EXACT_MATCH", {
        ...logContext,
        vehicleId: input.vehicleId,
        resolvedImageType: "exact",
        resolvedImageSource: seeded,
      });
      return { uri: seeded, source: "vehicle", fallbackType: "seeded" };
    }
  }

  const familyImage = modelFamilyVehicleImages[normalizeFamilyKey(input.make, input.model)];
  if (familyImage) {
    if (shouldRejectImageForIdentity(input, familyImage)) {
      console.warn("[vehicle-images] IMAGE_REJECT_REASON", {
        ...logContext,
        vehicleId: input.vehicleId,
        reason: "model-family-image-rejected",
      });
    } else {
      const resolvedImage = describeImageUri(familyImage);
      console.log("[vehicle-images] IMAGE_MODEL_REQUESTED", {
        ...logContext,
        vehicleId: input.vehicleId,
        requestedModel: normalizeRequestedModel(input),
      });
      console.log("[vehicle-images] IMAGE_MODEL_RESOLVED", {
        ...logContext,
        vehicleId: input.vehicleId,
        resolvedImageModel: resolvedImage.model,
      });
      console.log("[vehicle-images] IMAGE_SAFE_MATCH_ACCEPTED", {
        ...logContext,
        vehicleId: input.vehicleId,
        resolvedImageModel: resolvedImage.model,
        resolvedImageSource: familyImage,
      });
      console.log("[vehicle-images] IMAGE_RESOLUTION_MODEL_FAMILY_MATCH", {
        ...logContext,
        vehicleId: input.vehicleId,
        resolvedImageType: "model-family",
        resolvedImageSource: familyImage,
      });
      return { uri: familyImage, source: "model-family", fallbackType: "model-family" };
    }
  }

  const normalizedIdentity = normalizeVehicleIdentityForRendering(input);
  const requestedBodyStyleKey = normalizeBodyStyle(input.bodyStyle);
  if (isFordRangerIdentity(input) && requestedBodyStyleKey && requestedBodyStyleKey !== "truck") {
    console.warn("[vehicle-images] IMAGE_RESOLUTION_REJECTED_UNSAFE_IMAGE", {
      ...logContext,
      vehicleId: input.vehicleId,
      rejectedBodyStyle: requestedBodyStyleKey,
      reason: "ford-ranger-requires-pickup-safe-image",
    });
  }
  if (normalizedIdentity.vehicleType === "motorcycle") {
    console.log("[vehicle-images] IMAGE_RESOLUTION_PLACEHOLDER", {
      ...logContext,
      vehicleId: input.vehicleId,
      resolvedImageType: "motorcycle-placeholder",
      resolvedImageSource: genericVehicleImages.motorcycle,
    });
    return { uri: genericVehicleImages.motorcycle, source: "placeholder", fallbackType: "motorcycle-placeholder" };
  }

  const inferredBodyStyle = normalizedIdentity.bodyStyleKey;
  if (inferredBodyStyle) {
    if (inferredBodyStyle === "truck") {
      console.log("[vehicle-images] IMAGE_MODEL_REQUESTED", {
        ...logContext,
        vehicleId: input.vehicleId,
        requestedModel: normalizeRequestedModel(input),
      });
      console.log("[vehicle-images] IMAGE_MODEL_RESOLVED", {
        ...logContext,
        vehicleId: input.vehicleId,
        resolvedImageModel: "pickup-fallback",
      });
      console.log("[vehicle-images] IMAGE_SAFE_MATCH_ACCEPTED", {
        ...logContext,
        vehicleId: input.vehicleId,
        resolvedImageModel: "pickup-fallback",
        resolvedImageSource: pickupTruckFallbackImage,
      });
      console.log("[vehicle-images] IMAGE_RESOLUTION_PICKUP_FALLBACK", {
        ...logContext,
        vehicleId: input.vehicleId,
        normalizedBodyStyle: normalizedIdentity.bodyStyle,
        resolvedImageType: "pickup-truck-fallback",
        resolvedImageSource: pickupTruckFallbackImage,
      });
      return { uri: pickupTruckFallbackImage, source: "body-style", fallbackType: "pickup-truck-fallback" };
    }

    console.log("[vehicle-images] IMAGE_RESOLUTION_BODY_STYLE_MATCH", {
      ...logContext,
      vehicleId: input.vehicleId,
      normalizedBodyStyle: normalizedIdentity.bodyStyle,
      resolvedImageType: `body-style-${inferredBodyStyle}`,
      resolvedImageSource: bodyStyleVehicleImages[inferredBodyStyle],
    });
    return {
      uri: bodyStyleVehicleImages[inferredBodyStyle],
      source: "body-style",
      fallbackType: `body-style-${inferredBodyStyle}` as VehicleImageFallbackType,
    };
  }

  console.log("[vehicle-images] IMAGE_RESOLUTION_PLACEHOLDER", {
    ...logContext,
    vehicleId: input.vehicleId,
    resolvedImageType: "neutral-placeholder",
    resolvedImageSource: genericVehicleImages.car,
  });
  return { uri: genericVehicleImages.car, source: "placeholder", fallbackType: "neutral-placeholder" };
}

export function getVehicleImage(vehicleId: string, vehicleType: string | null = "car", bodyStyle?: string | null) {
  return resolveVehicleImageSource({ vehicleId, vehicleType, bodyStyle }).uri;
}
