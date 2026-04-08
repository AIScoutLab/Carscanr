import crypto from "node:crypto";
import { AppError } from "../errors/appError.js";
import { repositories } from "../lib/repositoryRegistry.js";

export class GarageService {
  async list(userId: string) {
    const items = await repositories.garageItems.listByUser(userId);
    const vehicles = await Promise.all(items.map((item) => repositories.vehicles.findById(item.vehicleId)));
    return items.map((item, index) => ({
      ...item,
      vehicle: vehicles[index] ?? null,
    }));
  }

  async save(input: {
    userId: string;
    vehicleId: string;
    imageUrl: string;
    notes: string;
    favorite: boolean;
  }) {
    const vehicle = await repositories.vehicles.findById(input.vehicleId);
    if (!vehicle) {
      throw new AppError(404, "VEHICLE_NOT_FOUND", "Cannot save unknown vehicle to garage.");
    }

    const item = {
      id: crypto.randomUUID(),
      userId: input.userId,
      vehicleId: input.vehicleId,
      imageUrl: input.imageUrl,
      notes: input.notes,
      favorite: input.favorite,
      createdAt: new Date().toISOString(),
    };

    const persisted = await repositories.garageItems.create(item);
    return { ...persisted, vehicle };
  }

  async delete(userId: string, id: string) {
    const deleted = await repositories.garageItems.deleteByUserAndId(userId, id);
    if (!deleted) {
      throw new AppError(404, "GARAGE_ITEM_NOT_FOUND", "Garage item not found.");
    }
  }
}
