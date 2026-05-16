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
  if (cleanText(input.vehicleType).toLowerCase() === "car") return "car";
  return "";
}

function formatIdentity(input: VehicleDescriptionInput) {
  const year = typeof input.year === "number" && Number.isFinite(input.year) ? `${input.year}` : "";
  const make = cleanText(input.make);
  const model = cleanText(input.model);
  const trim = cleanText(input.trim);
  return [year, make, model, trim].filter(Boolean).join(" ");
}

function buildBodySentence(identity: string, bodyDescriptor: string) {
  switch (bodyDescriptor.toLowerCase()) {
    case "suv":
      return `The ${identity} is an SUV shaped around passenger space, cargo flexibility, and everyday versatility.`;
    case "sedan":
      return `The ${identity} is a sedan built for everyday road use with a more traditional three-box profile.`;
    case "coupe":
      return `The ${identity} is a coupe with a lower, sportier roofline and a more focused road-car stance.`;
    case "convertible":
      return `The ${identity} is a convertible with an open-air touring focus and a more dramatic profile.`;
    case "hatchback":
      return `The ${identity} is a hatchback with upright packaging and practical day-to-day usability.`;
    case "wagon":
      return `The ${identity} is a wagon with added cargo flexibility and a long-roof shape built for everyday use.`;
    case "pickup":
      return `The ${identity} is a pickup designed around utility, hauling, and everyday work duty.`;
    case "motorcycle":
      return `The ${identity} is a motorcycle identified from the confirmed details available for this match.`;
    case "car":
      return `The ${identity} is a road-going passenger vehicle identified from the strongest confirmed details available.`;
    default:
      return `The ${identity} is identified from the strongest confirmed vehicle details available here.`;
  }
}

function joinKnownTraits(input: VehicleDescriptionInput) {
  const engine = cleanText(input.engine);
  const drivetrain = cleanText(input.drivetrain);
  const transmission = cleanText(input.transmission);
  const horsepower =
    typeof input.horsepower === "number" && Number.isFinite(input.horsepower) && input.horsepower > 0
      ? `${Math.round(input.horsepower)} hp`
      : "";

  return [engine, horsepower, drivetrain, transmission].filter(Boolean).slice(0, 4);
}

function buildTraitSentence(traits: string[]) {
  if (traits.length === 0) {
    return "";
  }
  if (traits.length === 1) {
    return `Known details for this match include ${traits[0]}.`;
  }
  const finalTrait = traits[traits.length - 1];
  const leadingTraits = traits.slice(0, -1);
  return `Known details for this match include ${leadingTraits.join(", ")}, and ${finalTrait}.`;
}

export function buildVehicleDescription(input: VehicleDescriptionInput): VehicleDescriptionResult {
  const identity = formatIdentity(input);
  const bodyDescriptor = formatBodyDescriptor(input);
  const traits = joinKnownTraits(input);

  if (!identity || (!bodyDescriptor && traits.length === 0)) {
    return {
      description: null,
      reason: "data_insufficient",
    };
  }

  if (isSpecialtyExoticMake(cleanText(input.make))) {
    const overview = buildSpecialtyVehicleOverview({
      make: cleanText(input.make),
      model: cleanText(input.model),
      bodyStyle: cleanText(input.bodyStyle) || bodyDescriptor,
    });
    const traitSentence = buildTraitSentence(traits);
    return {
      description: [overview, traitSentence].filter(Boolean).join(" "),
      reason: "generated",
    };
  }

  return {
    description: [buildBodySentence(identity, bodyDescriptor), buildTraitSentence(traits)].filter(Boolean).join(" "),
    reason: "generated",
  };
}
