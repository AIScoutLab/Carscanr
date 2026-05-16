import { buildSpecialtyVehicleOverview, isSpecialtyExoticMake } from "@/lib/specialtyVehicles";

type VehicleDescriptionInput = {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  bodyStyle?: string | null;
  vehicleType?: string | null;
  engine?: string | null;
  horsepower?: number | null;
  drivetrain?: string | null;
  transmission?: string | null;
};

type VehicleDescriptionResult = {
  description: string | null;
  reason: "generated" | "data_insufficient";
};

function cleanText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "Unknown" || trimmed === "Unavailable") {
    return "";
  }
  return trimmed;
}

function formatBodyDescriptor(input: { bodyStyle?: string | null; vehicleType?: string | null }) {
  const bodyStyle = cleanText(input.bodyStyle);
  const normalized = bodyStyle.toLowerCase();
  if (normalized.includes("sport utility") || normalized.includes("suv")) return "SUV";
  if (normalized.includes("sedan")) return "sedan";
  if (normalized.includes("coupe")) return "coupe";
  if (normalized.includes("convertible")) return "convertible";
  if (normalized.includes("hatch")) return "hatchback";
  if (normalized.includes("wagon")) return "wagon";
  if (normalized.includes("pickup") || normalized.includes("truck")) return "pickup";
  if (normalized.includes("motorcycle")) return "motorcycle";
  if (bodyStyle) return bodyStyle;
  if (cleanText(input.vehicleType).toLowerCase() === "motorcycle") return "motorcycle";
  if (cleanText(input.vehicleType).toLowerCase() === "car") return "passenger vehicle";
  return "";
}

function formatIdentity(input: VehicleDescriptionInput) {
  const year = typeof input.year === "number" && Number.isFinite(input.year) ? `${input.year}` : "";
  const make = cleanText(input.make);
  const model = cleanText(input.model);
  const trim = cleanText(input.trim);
  const parts = [year, make, model, trim].filter(Boolean);
  return parts.join(" ");
}

function joinTraits(input: VehicleDescriptionInput) {
  const traits: string[] = [];
  const engine = cleanText(input.engine);
  const drivetrain = cleanText(input.drivetrain);
  const transmission = cleanText(input.transmission);
  const horsepower = typeof input.horsepower === "number" && Number.isFinite(input.horsepower) && input.horsepower > 0 ? `${Math.round(input.horsepower)} hp` : "";

  if (engine) traits.push(engine);
  if (horsepower) traits.push(horsepower);
  if (drivetrain) traits.push(drivetrain);
  if (transmission) traits.push(transmission);

  return traits.slice(0, 3);
}

export function buildVehicleDescription(input: VehicleDescriptionInput): VehicleDescriptionResult {
  const identity = formatIdentity(input);
  const bodyDescriptor = formatBodyDescriptor(input);
  const traits = joinTraits(input);

  if (!identity || (!bodyDescriptor && traits.length === 0)) {
    return {
      description: null,
      reason: "data_insufficient",
    };
  }

  const opening = isSpecialtyExoticMake(cleanText(input.make))
    ? buildSpecialtyVehicleOverview({
        make: cleanText(input.make),
        model: cleanText(input.model),
        bodyStyle: cleanText(input.bodyStyle) || bodyDescriptor,
      })
    : bodyDescriptor
      ? `${identity} is a ${bodyDescriptor.toLowerCase()} in this record.`
      : `${identity} is identified in this record with confirmed vehicle details.`;

  const traitsSentence =
    traits.length > 0
      ? `Confirmed details include ${traits.join(", ")}.`
      : "";

  return {
    description: [opening, traitsSentence].filter(Boolean).join(" "),
    reason: "generated",
  };
}
