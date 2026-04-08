import { VehicleCandidate } from "@/types";

type MarketData = {
  avgPrice?: number | null;
  priceRange?: string | null;
  dealRating?: string | null;
};

export function generateVehicleInsight(vehicle: VehicleCandidate, marketData?: MarketData) {
  if (marketData?.avgPrice && Number.isFinite(marketData.avgPrice)) {
    return `Avg market price: $${marketData.avgPrice.toLocaleString("en-US")}`;
  }

  const safeMake = String(vehicle?.make ?? "").toLowerCase();
  const safeModel = String(vehicle?.model ?? "").toLowerCase();
  const year = typeof vehicle?.year === "number" ? vehicle.year : Number(vehicle?.year);
  const currentYear = new Date().getFullYear();
  const age = Number.isFinite(year) ? currentYear - year : null;

  if (age !== null && age <= 2) {
    return "Strong demand for newer model years.";
  }
  if (safeMake.includes("tesla")) {
    return "Great value for performance and range.";
  }
  if (safeModel.includes("mustang")) {
    return "Performance-forward with strong resale appeal.";
  }
  if (age !== null && age >= 10) {
    return "Solid value if well maintained.";
  }

  return "Solid all-around vehicle.";
}
