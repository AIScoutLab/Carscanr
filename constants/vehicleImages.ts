export const seededVehicleImages = {
  "2021-cadillac-ct4-premium-luxury": "https://commons.wikimedia.org/wiki/Special:FilePath/2020_Cadillac_CT4.jpg",
  "2020-honda-civic-ex": "https://commons.wikimedia.org/wiki/Special:FilePath/2019_Honda_Civic_LX_Sedan_in_Modern_Steel_Metallic%2C_front_left%2C_2024-10-28.jpg",
  "2018-kia-optima-ex": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=1200&q=80",
  "2019-ford-mustang-gt": "https://commons.wikimedia.org/wiki/Special:FilePath/2019_Ford_Mustang_GT_5.0_facelift_Side.jpg",
  "2022-tesla-model-3-long-range": "https://commons.wikimedia.org/wiki/Special:FilePath/Tesla_Model_3_%2852304163995%29.jpg",
  "2021-yamaha-yzf-r3-standard": "https://commons.wikimedia.org/wiki/Special:FilePath/5-YZF_R3_2021.jpg",
  "2023-harley-davidson-street-glide-special": "https://commons.wikimedia.org/wiki/Special:FilePath/2015_Street_Glide_Special.jpg",
} as const;

export const SILHOUETTE_IMAGES = {
  pickup_truck: require("../carscanr_silhouettes/pickup_truck.png"),
  suv: require("../carscanr_silhouettes/suv.png"),
  sedan: require("../carscanr_silhouettes/sedan.png"),
  coupe: require("../carscanr_silhouettes/coupe.png"),
  hatchback_wagon: require("../carscanr_silhouettes/hatchback_wagon.png"),
  van: require("../carscanr_silhouettes/van.png"),
  motorcycle: require("../carscanr_silhouettes/motorcycle.png"),
  neutral_vehicle: require("../carscanr_silhouettes/neutral_vehicle.png"),
} as const;

export type VehicleImageSource = string | number;

type SilhouetteKey = keyof typeof SILHOUETTE_IMAGES;
type BodyStyleKey = "truck" | "suv" | "sedan" | "coupe" | "wagon" | "hatchback" | "convertible" | "van";

const bodyStyleVehicleImages: Record<BodyStyleKey, VehicleImageSource> = {
  truck: SILHOUETTE_IMAGES.pickup_truck,
  suv: SILHOUETTE_IMAGES.suv,
  sedan: SILHOUETTE_IMAGES.sedan,
  coupe: SILHOUETTE_IMAGES.coupe,
  wagon: SILHOUETTE_IMAGES.hatchback_wagon,
  hatchback: SILHOUETTE_IMAGES.hatchback_wagon,
  convertible: SILHOUETTE_IMAGES.coupe,
  van: SILHOUETTE_IMAGES.van,
};

const modelFamilyVehicleImages: Record<string, VehicleImageSource> = {};

const genericVehicleImages = {
  car: SILHOUETTE_IMAGES.neutral_vehicle,
  truck: SILHOUETTE_IMAGES.pickup_truck,
  motorcycle: SILHOUETTE_IMAGES.motorcycle,
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
  bodyStyleKey: BodyStyleKey | null;
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
  uri: VehicleImageSource;
  source: "vehicle" | "model-family" | "body-style" | "placeholder";
  fallbackType: VehicleImageFallbackType;
};

export function toVehicleImageSource(source: VehicleImageSource) {
  return typeof source === "string" ? { uri: source } : source;
}

type ImageDescriptor = {
  model: string | null;
  category: "pickup" | "suv" | "crossover" | "sports" | "sedan" | "motorcycle" | "placeholder" | "unknown";
};

function sourceForLog(source?: VehicleImageSource | null) {
  if (typeof source === "number") {
    return `static-asset:${source}`;
  }
  return source ?? null;
}

function silhouetteKeyForSource(source?: VehicleImageSource | null): SilhouetteKey | null {
  if (source == null) {
    return null;
  }
  for (const [key, value] of Object.entries(SILHOUETTE_IMAGES) as Array<[SilhouetteKey, VehicleImageSource]>) {
    if (source === value) {
      return key;
    }
  }
  return null;
}

function normalizeBodyStyle(bodyStyle?: string | null): BodyStyleKey | null {
  const normalized = bodyStyle?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (/\b(pickup|truck)\b/.test(normalized)) return "truck";
  if (/\b(suv|crossover|sport utility|utility)\b/.test(normalized)) return "suv";
  if (/\b(wagon|estate)\b/.test(normalized)) return "wagon";
  if (/\b(hatch|hatchback)\b/.test(normalized)) return "hatchback";
  if (/\b(convertible|cabriolet|roadster)\b/.test(normalized)) return "convertible";
  if (/\b(van|minivan)\b/.test(normalized)) return "van";
  if (/\b(coupe|2-door|two-door|sports?)\b/.test(normalized)) return "coupe";
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

function describeImageSource(source?: VehicleImageSource | null): ImageDescriptor {
  const silhouetteKey = silhouetteKeyForSource(source);
  if (silhouetteKey === "pickup_truck") return { model: "pickup-fallback", category: "pickup" };
  if (silhouetteKey === "neutral_vehicle") return { model: "neutral-placeholder", category: "placeholder" };
  if (silhouetteKey === "suv") return { model: "suv-silhouette", category: "suv" };
  if (silhouetteKey === "coupe") return { model: "coupe-silhouette", category: "sports" };
  if (silhouetteKey === "sedan") return { model: "sedan-silhouette", category: "sedan" };
  if (silhouetteKey === "motorcycle") return { model: "motorcycle-silhouette", category: "motorcycle" };
  if (silhouetteKey) return { model: `${silhouetteKey}-silhouette`, category: "unknown" };

  const normalized = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (!normalized) return { model: null, category: "unknown" };
  if (/placehold\.co|text=|pickup%20truck|carscanr/.test(normalized)) {
    return { model: "text-placeholder", category: "placeholder" };
  }
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

function shouldRejectImageForIdentity(input: VehicleIdentityInput, source?: VehicleImageSource | null) {
  const requestedModel = normalizeRequestedModel(input);
  const resolvedImage = describeImageSource(source);
  const rangerIdentity = isFordRangerIdentity(input);
  const unsafeForRanger =
    rangerIdentity &&
    (resolvedImage.category === "suv" ||
      resolvedImage.category === "crossover" ||
      resolvedImage.category === "sports" ||
      resolvedImage.model === "text-placeholder" ||
      resolvedImage.model === "neutral-placeholder" ||
      (resolvedImage.model !== null &&
        resolvedImage.model !== "ranger" &&
        resolvedImage.model !== "pickup-fallback"));
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
      requestedModel,
      resolvedImageModel: resolvedImage.model,
      resolvedImageCategory: resolvedImage.category,
      resolvedImageSource: sourceForLog(source),
      IMAGE_MODEL_REQUESTED: requestedModel,
      IMAGE_MODEL_RESOLVED: resolvedImage.model,
      IMAGE_REJECT_REASON: unsafeForRanger ? "ranger-unsafe-ford-family-or-suv-image" : "model-mismatch-unsafe-category",
    });
    return true;
  }

  return false;
}

export function isSafeVehicleImageForIdentity(input: VehicleIdentityInput, source?: VehicleImageSource | null) {
  if (source == null || (typeof source === "string" && source.trim().length === 0)) return false;
  const rejected = shouldRejectImageForIdentity(input, source);
  if (!rejected) {
    const resolvedImage = describeImageSource(source);
    console.log("[vehicle-images] IMAGE_SAFE_MATCH_ACCEPTED", {
      make: input.make ?? null,
      model: input.model ?? null,
      bodyStyle: input.bodyStyle ?? null,
      vehicleId: input.vehicleId ?? null,
      resolvedImageModel: resolvedImage.model,
      resolvedImageCategory: resolvedImage.category,
      resolvedImageSource: sourceForLog(source),
      IMAGE_MODEL_REQUESTED: normalizeRequestedModel(input),
      IMAGE_MODEL_RESOLVED: resolvedImage.model,
    });
  }
  return !rejected;
}

function inferBodyStyleFromIdentity(input: VehicleIdentityInput): BodyStyleKey | null {
  const normalized = buildVehicleIdentityText(input);
  if (!normalized) return null;
  if (
    /\b(ranger|f 150|f150|f 250|f250|f 350|f350|maverick|frontier|canyon|colorado|ridgeline|tacoma|tundra|silverado|sierra|ram 1500|ram 2500|ram 3500|gladiator|santa cruz|titan)\b/.test(
      normalized,
    )
  ) {
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
}): BodyStyleKey | null {
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

export function isGeneratedVehicleFallbackImageUri(source?: VehicleImageSource | null) {
  if (source == null || (typeof source === "string" && source.trim().length === 0)) {
    return false;
  }
  if (Object.values(SILHOUETTE_IMAGES).includes(source as (typeof SILHOUETTE_IMAGES)[SilhouetteKey])) {
    return true;
  }
  if (typeof source !== "string") {
    return false;
  }
  const normalized = source.trim();
  return (
    /1492144534655|ae79c964c9d7|placehold\.co|text=|pickup%20truck|carscanr/i.test(normalized)
  );
}

function logSilhouetteMatch(input: VehicleIdentityInput, silhouetteKey: SilhouetteKey, source: VehicleImageSource) {
  console.log("[vehicle-images] IMAGE_RESOLUTION_SILHOUETTE_MATCH", {
    make: input.make ?? null,
    model: input.model ?? null,
    bodyStyle: input.bodyStyle ?? null,
    vehicleId: input.vehicleId ?? null,
    resolvedImageType: silhouetteKey,
    resolvedImageSource: sourceForLog(source),
  });
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
  if (seeded && !shouldRejectImageForIdentity(input, seeded)) {
    console.log("[vehicle-images] IMAGE_RESOLUTION_EXACT_MATCH", {
      ...logContext,
      vehicleId: input.vehicleId,
      resolvedImageType: "exact",
      resolvedImageSource: seeded,
    });
    return { uri: seeded, source: "vehicle", fallbackType: "seeded" };
  }

  const familyImage = modelFamilyVehicleImages[normalizeFamilyKey(input.make, input.model)];
  if (familyImage && !shouldRejectImageForIdentity(input, familyImage)) {
    console.log("[vehicle-images] IMAGE_RESOLUTION_EXACT_MATCH", {
      ...logContext,
      vehicleId: input.vehicleId,
      resolvedImageType: "model-family",
      resolvedImageSource: sourceForLog(familyImage),
    });
    return { uri: familyImage, source: "model-family", fallbackType: "model-family" };
  }

  const normalizedIdentity = normalizeVehicleIdentityForRendering(input);
  if (normalizedIdentity.vehicleType === "motorcycle") {
    logSilhouetteMatch(input, "motorcycle", SILHOUETTE_IMAGES.motorcycle);
    return { uri: SILHOUETTE_IMAGES.motorcycle, source: "placeholder", fallbackType: "motorcycle-placeholder" };
  }

  const bodyStyleKey = normalizedIdentity.bodyStyleKey;
  if (bodyStyleKey) {
    const fallbackSource = bodyStyleVehicleImages[bodyStyleKey];
    const silhouetteKey = bodyStyleKey === "truck" ? "pickup_truck" : bodyStyleKey === "wagon" || bodyStyleKey === "hatchback" ? "hatchback_wagon" : bodyStyleKey === "convertible" ? "coupe" : bodyStyleKey;
    logSilhouetteMatch(input, silhouetteKey, fallbackSource);
    return {
      uri: fallbackSource,
      source: "body-style",
      fallbackType: bodyStyleKey === "truck" ? "pickup-truck-fallback" : (`body-style-${bodyStyleKey}` as VehicleImageFallbackType),
    };
  }

  console.log("[vehicle-images] IMAGE_RESOLUTION_NEUTRAL_FALLBACK", {
    ...logContext,
    vehicleId: input.vehicleId,
    resolvedImageType: "neutral_vehicle",
    resolvedImageSource: sourceForLog(genericVehicleImages.car),
  });
  return { uri: genericVehicleImages.car, source: "placeholder", fallbackType: "neutral-placeholder" };
}

export function getVehicleImage(vehicleId: string, vehicleType: string | null = "car", bodyStyle?: string | null) {
  return resolveVehicleImageSource({ vehicleId, vehicleType, bodyStyle }).uri;
}
