import type { VehicleSpecs } from "@/types";

const UNKNOWN_SPEC_VALUES = new Set(["unknown", "unavailable", "see live listing", "vehicle"]);

type PartialSpecs = Partial<VehicleSpecs>;

type CompletionRule = {
  make: string;
  model: string;
  engineIncludes: string;
  startYear: number;
  endYear: number;
  specs: PartialSpecs;
};

const MODEL_DISPLAY_NAMES = new Map<string, string>([
  ["toyota|4runner", "4Runner"],
  ["cadillac|ct4", "CT4"],
  ["cadillac|ct5", "CT5"],
  ["ford|f 150", "F-150"],
  ["ford|f150", "F-150"],
  ["porsche|911", "911"],
]);

const CANONICAL_COMPLETION_RULES: CompletionRule[] = [
  {
    make: "toyota",
    model: "4runner",
    engineIncludes: "4 0l v6",
    startYear: 2005,
    endYear: 2009,
    specs: {
      horsepower: 236,
      torque: "266 lb-ft",
      transmission: "5-speed automatic",
    },
  },
  {
    make: "toyota",
    model: "4runner",
    engineIncludes: "4 0l v6",
    startYear: 2010,
    endYear: 2024,
    specs: {
      horsepower: 270,
      torque: "278 lb-ft",
      transmission: "5-speed automatic",
    },
  },
];

function normalize(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSpecText(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || UNKNOWN_SPEC_VALUES.has(trimmed.toLowerCase())) {
    return null;
  }
  return trimmed;
}

function isPositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function formatCanonicalModelName(make: string | null | undefined, model: string | null | undefined) {
  const rawModel = String(model ?? "").trim();
  if (!rawModel) {
    return "";
  }
  const key = `${normalize(make)}|${normalize(rawModel)}`;
  const displayName = MODEL_DISPLAY_NAMES.get(key);
  if (displayName) {
    return displayName;
  }
  return rawModel;
}

export function sanitizeSpecValue(value: string | null | undefined, fallback = "Unknown") {
  return cleanSpecText(value) ?? fallback;
}

export function completeCanonicalSpecs(input: {
  year?: number | null;
  make: string;
  model: string;
  specs: PartialSpecs;
}) {
  const make = normalize(input.make);
  const model = normalize(input.model);
  const year = typeof input.year === "number" && Number.isFinite(input.year) ? input.year : null;
  const engine = cleanSpecText(input.specs.engine) ?? "";
  const normalizedEngine = normalize(engine);
  const completion =
    year == null
      ? null
      : CANONICAL_COMPLETION_RULES.find(
          (rule) =>
            rule.make === make &&
            rule.model === model &&
            year >= rule.startYear &&
            year <= rule.endYear &&
            normalizedEngine.includes(rule.engineIncludes),
        ) ?? null;

  return {
    ...input.specs,
    engine: cleanSpecText(input.specs.engine) ?? "Unknown",
    horsepower: isPositiveNumber(input.specs.horsepower) ? input.specs.horsepower! : completion?.specs.horsepower ?? null,
    torque: cleanSpecText(input.specs.torque) ?? completion?.specs.torque ?? "Unknown",
    transmission: cleanSpecText(input.specs.transmission) ?? completion?.specs.transmission ?? "Unknown",
    drivetrain: cleanSpecText(input.specs.drivetrain) ?? "Unknown",
    mpgOrRange: cleanSpecText(input.specs.mpgOrRange) ?? "Unknown",
    exteriorColors: input.specs.exteriorColors ?? [],
    msrp: isPositiveNumber(input.specs.msrp) ? input.specs.msrp! : 0,
  } satisfies VehicleSpecs;
}
