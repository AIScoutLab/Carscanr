import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "@/services/apiClient";
import { authService } from "@/services/authService";
import { getVehicleImage } from "@/constants/vehicleImages";
import { resolveHorsepower } from "@/lib/vehicleData";
import { GarageItem, VehicleRecord } from "@/types";

let mutableGarage: GarageItem[] = [];
const LOCAL_ESTIMATE_GARAGE_STORAGE_KEY = "carscanr.localEstimateGarage.v1";

type BackendVehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  msrp: number;
  engine: string;
  horsepower?: number | string | null;
  hp?: number | string | null;
  engine_hp?: number | string | null;
  torque: string;
  transmission: string;
  drivetrain: string;
  mpgOrRange: string;
  colors: string[];
};

type BackendGarageItem = {
  id: string;
  userId: string;
  vehicleId: string;
  imageUrl: string;
  notes: string;
  favorite: boolean;
  createdAt: string;
  vehicle: BackendVehicle | null;
};

type LocalEstimateGarageItem = {
  id: string;
  vehicleId: string;
  unlockId: string;
  sourceType: "estimate" | "visual_override";
  imageUrl: string;
  notes: string;
  favorite: boolean;
  createdAt: string;
  confidence: number | null;
  estimateMeta: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    vehicleType?: "car" | "motorcycle" | "";
    titleLabel?: string;
    trustedCase?: boolean;
    resultSource?: string;
  };
  vehicle: VehicleRecord;
};

function mapVehicle(vehicle: BackendVehicle | null, vehicleId: string): VehicleRecord {
  if (!vehicle) {
    return {
      id: vehicleId,
      year: 0,
      make: "Unknown",
      model: "Vehicle",
      trim: "",
      bodyStyle: "",
      heroImage: getVehicleImage(vehicleId),
      overview: "Vehicle details unavailable.",
      specs: {
        engine: "",
        horsepower: null,
        torque: "",
        transmission: "",
        drivetrain: "",
        mpgOrRange: "",
        exteriorColors: [],
        msrp: 0,
      },
      valuation: {
        tradeIn: "Unavailable",
        tradeInRange: "Unavailable",
        privateParty: "Unavailable",
        privatePartyRange: "Unavailable",
        dealerRetail: "Unavailable",
        dealerRetailRange: "Unavailable",
        confidenceLabel: "Unavailable",
        sourceLabel: "No live value source",
        modelType: "modeled",
      },
      listings: [],
    };
  }

  return {
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    bodyStyle: vehicle.bodyStyle,
    heroImage: getVehicleImage(vehicle.id),
    overview: `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim} saved from your Garage.`,
    specs: {
      engine: vehicle.engine,
      horsepower: resolveHorsepower(vehicle.horsepower, vehicle.hp, vehicle.engine_hp),
      torque: vehicle.torque,
      transmission: vehicle.transmission,
      drivetrain: vehicle.drivetrain,
      mpgOrRange: vehicle.mpgOrRange,
      exteriorColors: vehicle.colors,
      msrp: vehicle.msrp,
    },
    valuation: {
      tradeIn: "Unavailable",
      tradeInRange: "Unavailable",
      privateParty: "Unavailable",
      privatePartyRange: "Unavailable",
      dealerRetail: "Unavailable",
      dealerRetailRange: "Unavailable",
      confidenceLabel: "Open vehicle detail for live value",
      sourceLabel: "No live value source",
      modelType: "modeled",
    },
    listings: [],
  };
}

function mapGarageItem(item: BackendGarageItem): GarageItem {
  return {
    id: item.id,
    vehicleId: item.vehicleId,
    unlockId: item.vehicleId,
    sourceType: "catalog",
    favorite: item.favorite,
    notes: item.notes,
    savedAt: item.createdAt,
    confidence: null,
    estimateMeta: null,
    imageUri: item.imageUrl,
    vehicle: mapVehicle(item.vehicle, item.vehicleId),
  };
}

function normalizeLocalEstimateGarageItems(input: unknown): LocalEstimateGarageItem[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((item): item is LocalEstimateGarageItem => {
    return Boolean(
      item &&
      typeof item === "object" &&
      typeof (item as LocalEstimateGarageItem).id === "string" &&
      typeof (item as LocalEstimateGarageItem).vehicleId === "string" &&
      typeof (item as LocalEstimateGarageItem).unlockId === "string" &&
      typeof (item as LocalEstimateGarageItem).sourceType === "string" &&
      typeof (item as LocalEstimateGarageItem).imageUrl === "string" &&
      typeof (item as LocalEstimateGarageItem).createdAt === "string" &&
      (item as LocalEstimateGarageItem).vehicle &&
      typeof (item as LocalEstimateGarageItem).vehicle === "object",
    );
  });
}

async function loadLocalEstimateGarageItems() {
  const raw = await AsyncStorage.getItem(LOCAL_ESTIMATE_GARAGE_STORAGE_KEY);
  if (!raw) {
    return [] as LocalEstimateGarageItem[];
  }
  try {
    return normalizeLocalEstimateGarageItems(JSON.parse(raw));
  } catch {
    await AsyncStorage.removeItem(LOCAL_ESTIMATE_GARAGE_STORAGE_KEY);
    return [] as LocalEstimateGarageItem[];
  }
}

async function saveLocalEstimateGarageItems(items: LocalEstimateGarageItem[]) {
  await AsyncStorage.setItem(LOCAL_ESTIMATE_GARAGE_STORAGE_KEY, JSON.stringify(items));
}

function mapLocalEstimateGarageItem(item: LocalEstimateGarageItem): GarageItem {
  return {
    id: item.id,
    vehicleId: item.vehicleId,
    unlockId: item.unlockId,
    sourceType: item.sourceType,
    favorite: item.favorite,
    notes: item.notes,
    savedAt: item.createdAt,
    confidence: item.confidence,
    estimateMeta: item.estimateMeta,
    imageUri: item.imageUrl,
    vehicle: item.vehicle,
  };
}

export const garageService = {
  async list(): Promise<GarageItem[]> {
    const [localEstimateItems, token] = await Promise.all([
      loadLocalEstimateGarageItems(),
      authService.getAccessToken(),
    ]);

    let backendItems: GarageItem[] = [];
    if (token) {
      try {
        const items = await apiRequest<BackendGarageItem[]>({
          path: "/api/garage/list",
        });
        backendItems = items.map(mapGarageItem);
      } catch {
        backendItems = [];
      }
    }

    const merged = [
      ...localEstimateItems.map(mapLocalEstimateGarageItem),
      ...backendItems,
    ].sort((left, right) => right.savedAt.localeCompare(left.savedAt));

    mutableGarage = merged;
    return mutableGarage;
  },

  async save(vehicleId: string, imageUri: string): Promise<GarageItem> {
    const item = await apiRequest<BackendGarageItem>({
      path: "/api/garage/save",
      method: "POST",
      body: {
        vehicleId,
        imageUrl: imageUri,
        notes: "Saved from scan. Add notes about condition, options, or buying plans.",
        favorite: false,
      },
    });
    const mapped = mapGarageItem(item);
    mutableGarage = [mapped, ...mutableGarage.filter((entry) => entry.id !== mapped.id)];
    return mapped;
  },

  async saveEstimate(input: {
    unlockId: string;
    sourceType: "estimate" | "visual_override";
    imageUri: string;
    confidence: number | null;
    estimateMeta: {
      year: number;
      make: string;
      model: string;
      trim?: string;
      vehicleType?: "car" | "motorcycle" | "";
      titleLabel?: string;
      trustedCase?: boolean;
      resultSource?: string;
    };
    vehicle: VehicleRecord;
  }): Promise<GarageItem> {
    const existing = await loadLocalEstimateGarageItems();
    const nextItem: LocalEstimateGarageItem = {
      id: `${input.unlockId}:${Date.now()}`,
      vehicleId: input.unlockId,
      unlockId: input.unlockId,
      sourceType: input.sourceType,
      imageUrl: input.imageUri,
      notes: "Saved from scan. Reopen later to continue exploring this vehicle.",
      favorite: false,
      createdAt: new Date().toISOString(),
      confidence: input.confidence,
      estimateMeta: input.estimateMeta,
      vehicle: input.vehicle,
    };
    const deduped = existing.filter((item) => item.unlockId !== input.unlockId);
    const nextState = [nextItem, ...deduped];
    await saveLocalEstimateGarageItems(nextState);
    console.log("[garage] GARAGE_SAVE_ESTIMATE", {
      unlockId: input.unlockId,
      sourceType: input.sourceType,
      saved: true,
      garageItemId: nextItem.id,
    });
    const mapped = mapLocalEstimateGarageItem(nextItem);
    mutableGarage = [mapped, ...mutableGarage.filter((entry) => entry.unlockId !== input.unlockId)];
    return mapped;
  },

  async toggleFavorite(id: string): Promise<void> {
    mutableGarage = mutableGarage.map((item) => (item.id === id ? { ...item, favorite: !item.favorite } : item));
  },

  async deleteItem(id: string): Promise<void> {
    const localItems = await loadLocalEstimateGarageItems();
    if (localItems.some((item) => item.id === id)) {
      const next = localItems.filter((item) => item.id !== id);
      await saveLocalEstimateGarageItems(next);
      mutableGarage = mutableGarage.filter((item) => item.id !== id);
      return;
    }
    await apiRequest<{ deleted: true }>({
      path: `/api/garage/${encodeURIComponent(id)}`,
      method: "DELETE",
    });
    mutableGarage = mutableGarage.filter((item) => item.id !== id);
  },
};
