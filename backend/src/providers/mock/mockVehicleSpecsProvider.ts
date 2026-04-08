import { seedVehicles } from "../../data/seedVehicles.js";
import { VehicleRecord } from "../../types/domain.js";
import { VehicleSpecsProvider } from "../interfaces.js";

export class MockVehicleSpecsProvider implements VehicleSpecsProvider {
  async getVehicleSpecs(input: { vehicleId: string }): Promise<VehicleRecord | null> {
    return seedVehicles.find((vehicle) => vehicle.id === input.vehicleId) ?? null;
  }

  async searchVehicles(input: {
    year?: string;
    make?: string;
    model?: string;
  }): Promise<VehicleRecord[]> {
    return seedVehicles.filter((vehicle) => {
      return [
        input.year ? `${vehicle.year}`.includes(input.year) : true,
        input.make ? vehicle.make.toLowerCase().includes(input.make.toLowerCase()) : true,
        input.model ? vehicle.model.toLowerCase().includes(input.model.toLowerCase()) : true,
      ].every(Boolean);
    });
  }

  async searchCandidates(input: {
    year: number;
    make: string;
    model: string;
    trim?: string;
  }): Promise<VehicleRecord[]> {
    const norm = (value: string) => value.toLowerCase().trim();
    return seedVehicles.filter((vehicle) => {
      const yearMatch = vehicle.year === input.year;
      const makeMatch = norm(vehicle.make) === norm(input.make);
      const modelMatch = norm(vehicle.model) === norm(input.model);
      const trimMatch = input.trim ? norm(vehicle.trim).includes(norm(input.trim)) : true;
      return yearMatch && makeMatch && modelMatch && trimMatch;
    });
  }
}
