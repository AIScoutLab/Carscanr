import { apiRequest } from "@/services/apiClient";
import { getVehicleImage } from "@/constants/vehicleImages";
import { GarageItem, VehicleRecord } from "@/types";

let mutableGarage: GarageItem[] = [];

type BackendVehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  msrp: number;
  engine: string;
  horsepower: number;
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
        horsepower: 0,
        torque: "",
        transmission: "",
        drivetrain: "",
        mpgOrRange: "",
        exteriorColors: [],
        msrp: 0,
      },
      valuation: {
        tradeIn: "Unavailable",
        privateParty: "Unavailable",
        dealerRetail: "Unavailable",
        confidenceLabel: "Unavailable",
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
      horsepower: vehicle.horsepower,
      torque: vehicle.torque,
      transmission: vehicle.transmission,
      drivetrain: vehicle.drivetrain,
      mpgOrRange: vehicle.mpgOrRange,
      exteriorColors: vehicle.colors,
      msrp: vehicle.msrp,
    },
    valuation: {
      tradeIn: "Unavailable",
      privateParty: "Unavailable",
      dealerRetail: "Unavailable",
      confidenceLabel: "Open vehicle detail for live value",
    },
    listings: [],
  };
}

function mapGarageItem(item: BackendGarageItem): GarageItem {
  return {
    id: item.id,
    vehicleId: item.vehicleId,
    favorite: item.favorite,
    notes: item.notes,
    savedAt: item.createdAt,
    imageUri: item.imageUrl,
    vehicle: mapVehicle(item.vehicle, item.vehicleId),
  };
}

export const garageService = {
  async list(): Promise<GarageItem[]> {
    const items = await apiRequest<BackendGarageItem[]>({
      path: "/api/garage/list",
    });
    mutableGarage = items.map(mapGarageItem);
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

  async toggleFavorite(id: string): Promise<void> {
    mutableGarage = mutableGarage.map((item) => (item.id === id ? { ...item, favorite: !item.favorite } : item));
  },

  async deleteItem(id: string): Promise<void> {
    await apiRequest<{ deleted: true }>({
      path: `/api/garage/${encodeURIComponent(id)}`,
      method: "DELETE",
    });
    mutableGarage = mutableGarage.filter((item) => item.id !== id);
  },
};
