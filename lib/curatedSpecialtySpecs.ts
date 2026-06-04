import type { VehicleSpecs } from "@/types";

type CuratedSpecialtySpec = {
  make: string;
  modelPatterns: RegExp[];
  startYear?: number;
  endYear?: number;
  engine: string;
  horsepower: number;
  torque: string;
  transmission: string;
  drivetrain: string;
  mpgOrRange?: string;
  msrp?: number;
};

type CuratedSpecialtyLookupInput = {
  year?: number | null;
  make?: string | null;
  model?: string | null;
};

const UNKNOWN_VALUES = new Set(["", "unknown", "unavailable", "vehicle", "see live listing"]);

const CURATED_SPECIALTY_SPECS: CuratedSpecialtySpec[] = [
  {
    make: "bugatti",
    modelPatterns: [/\bchiron\b/],
    startYear: 2016,
    endYear: 2024,
    engine: "8.0L quad-turbo W16",
    horsepower: 1500,
    torque: "1,180 lb-ft",
    transmission: "7-speed dual-clutch automatic",
    drivetrain: "AWD",
    mpgOrRange: "9 city / 14 highway mpg",
    msrp: 2998000,
  },
  {
    make: "ferrari",
    modelPatterns: [/\bf430\b/],
    startYear: 2005,
    endYear: 2009,
    engine: "4.3L naturally aspirated V8",
    horsepower: 490,
    torque: "343 lb-ft",
    transmission: "6-speed manual or F1 automated manual",
    drivetrain: "RWD",
    mpgOrRange: "11 city / 16 highway mpg",
    msrp: 186925,
  },
  {
    make: "lamborghini",
    modelPatterns: [/\bhuracan\b/],
    startYear: 2015,
    endYear: 2024,
    engine: "5.2L naturally aspirated V10",
    horsepower: 610,
    torque: "413 lb-ft",
    transmission: "7-speed dual-clutch automatic",
    drivetrain: "AWD or RWD",
    mpgOrRange: "13 city / 18 highway mpg",
    msrp: 240000,
  },
  {
    make: "mclaren",
    modelPatterns: [/\b720s\b/],
    startYear: 2017,
    endYear: 2023,
    engine: "4.0L twin-turbo V8",
    horsepower: 710,
    torque: "568 lb-ft",
    transmission: "7-speed dual-clutch SSG",
    drivetrain: "RWD",
    mpgOrRange: "15 city / 22 highway mpg",
    msrp: 299000,
  },
  {
    make: "porsche",
    modelPatterns: [/\b911\b.*\bgt3\b.*\brs\b/, /\bgt3\b.*\brs\b/],
    startYear: 2022,
    engine: "4.0L naturally aspirated flat-six",
    horsepower: 518,
    torque: "342 lb-ft",
    transmission: "7-speed PDK dual-clutch automatic",
    drivetrain: "RWD",
    mpgOrRange: "14 city / 18 highway mpg",
    msrp: 241300,
  },
  {
    make: "porsche",
    modelPatterns: [/\b911\b.*\bgt3\b/, /\bgt3\b/],
    startYear: 2022,
    engine: "4.0L naturally aspirated flat-six",
    horsepower: 502,
    torque: "331 lb-ft",
    transmission: "6-speed manual or 7-speed PDK",
    drivetrain: "RWD",
    mpgOrRange: "15 city / 18 highway mpg",
    msrp: 182900,
  },
];

function normalize(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMeaningfulText(value: string | null | undefined) {
  return !UNKNOWN_VALUES.has(normalize(value));
}

function isPositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function matchesRule(rule: CuratedSpecialtySpec, input: CuratedSpecialtyLookupInput) {
  const make = normalize(input.make);
  const model = normalize(input.model);
  const year = typeof input.year === "number" && Number.isFinite(input.year) ? input.year : null;
  if (make !== rule.make) {
    return false;
  }
  if (year != null && rule.startYear != null && year < rule.startYear) {
    return false;
  }
  if (year != null && rule.endYear != null && year > rule.endYear) {
    return false;
  }
  return rule.modelPatterns.some((pattern) => pattern.test(model));
}

export function getCuratedSpecialtySpecs(input: CuratedSpecialtyLookupInput) {
  return CURATED_SPECIALTY_SPECS.find((rule) => matchesRule(rule, input)) ?? null;
}

export function applyCuratedSpecialtySpecs(input: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  specs: VehicleSpecs;
}): VehicleSpecs {
  const curated = getCuratedSpecialtySpecs(input);
  if (!curated) {
    return input.specs;
  }

  return {
    ...input.specs,
    engine: isMeaningfulText(input.specs.engine) ? input.specs.engine : curated.engine,
    horsepower: isPositiveNumber(input.specs.horsepower) ? input.specs.horsepower : curated.horsepower,
    torque: isMeaningfulText(input.specs.torque) ? input.specs.torque : curated.torque,
    transmission: isMeaningfulText(input.specs.transmission) ? input.specs.transmission : curated.transmission,
    drivetrain: isMeaningfulText(input.specs.drivetrain) ? input.specs.drivetrain : curated.drivetrain,
    mpgOrRange: isMeaningfulText(input.specs.mpgOrRange) ? input.specs.mpgOrRange : curated.mpgOrRange ?? input.specs.mpgOrRange,
    msrp: isPositiveNumber(input.specs.msrp) ? input.specs.msrp : curated.msrp ?? input.specs.msrp,
  };
}
