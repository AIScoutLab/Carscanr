import { VehicleRecord, VehicleType } from "../types/domain.js";

type CuratedSpecialtySpec = {
  make: string;
  modelPatterns: RegExp[];
  startYear?: number;
  endYear?: number;
  trimPatterns?: RegExp[];
  bodyStyle: string;
  vehicleType?: VehicleType;
  engine: string;
  horsepower: number;
  torque: string;
  transmission: string;
  drivetrain: string;
  mpgOrRange?: string;
  msrp?: number;
  engineDisplacementL?: number;
  cylinders?: number;
  fuelType?: string;
  doors?: number;
};

type CuratedSpecialtyLookupInput = {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
};

const UNKNOWN_VALUES = new Set(["", "unknown", "unavailable", "vehicle", "see live listing"]);

const CURATED_SPECIALTY_SPECS: CuratedSpecialtySpec[] = [
  {
    make: "bugatti",
    modelPatterns: [/\bchiron\b/],
    startYear: 2016,
    endYear: 2024,
    bodyStyle: "Coupe",
    engine: "8.0L quad-turbo W16",
    horsepower: 1500,
    torque: "1,180 lb-ft",
    transmission: "7-speed dual-clutch automatic",
    drivetrain: "AWD",
    mpgOrRange: "9 city / 14 highway mpg",
    msrp: 2998000,
    engineDisplacementL: 8.0,
    cylinders: 16,
    fuelType: "Premium gasoline",
    doors: 2,
  },
  {
    make: "ferrari",
    modelPatterns: [/\bf430\b/],
    startYear: 2005,
    endYear: 2009,
    bodyStyle: "Coupe",
    engine: "4.3L naturally aspirated V8",
    horsepower: 490,
    torque: "343 lb-ft",
    transmission: "6-speed manual or F1 automated manual",
    drivetrain: "RWD",
    mpgOrRange: "11 city / 16 highway mpg",
    msrp: 186925,
    engineDisplacementL: 4.3,
    cylinders: 8,
    fuelType: "Premium gasoline",
    doors: 2,
  },
  {
    make: "lamborghini",
    modelPatterns: [/\bhuracan\b/],
    startYear: 2015,
    endYear: 2024,
    bodyStyle: "Coupe",
    engine: "5.2L naturally aspirated V10",
    horsepower: 610,
    torque: "413 lb-ft",
    transmission: "7-speed dual-clutch automatic",
    drivetrain: "AWD or RWD",
    mpgOrRange: "13 city / 18 highway mpg",
    msrp: 240000,
    engineDisplacementL: 5.2,
    cylinders: 10,
    fuelType: "Premium gasoline",
    doors: 2,
  },
  {
    make: "mclaren",
    modelPatterns: [/\b720s\b/],
    startYear: 2017,
    endYear: 2023,
    bodyStyle: "Coupe",
    engine: "4.0L twin-turbo V8",
    horsepower: 710,
    torque: "568 lb-ft",
    transmission: "7-speed dual-clutch SSG",
    drivetrain: "RWD",
    mpgOrRange: "15 city / 22 highway mpg",
    msrp: 299000,
    engineDisplacementL: 4.0,
    cylinders: 8,
    fuelType: "Premium gasoline",
    doors: 2,
  },
  {
    make: "porsche",
    modelPatterns: [/\b911\b.*\bgt3\b.*\brs\b/, /\bgt3\b.*\brs\b/],
    startYear: 2022,
    bodyStyle: "Coupe",
    engine: "4.0L naturally aspirated flat-six",
    horsepower: 518,
    torque: "342 lb-ft",
    transmission: "7-speed PDK dual-clutch automatic",
    drivetrain: "RWD",
    mpgOrRange: "14 city / 18 highway mpg",
    msrp: 241300,
    engineDisplacementL: 4.0,
    cylinders: 6,
    fuelType: "Premium gasoline",
    doors: 2,
  },
  {
    make: "porsche",
    modelPatterns: [/\b911\b.*\bgt3\b/, /\bgt3\b/],
    startYear: 2022,
    bodyStyle: "Coupe",
    engine: "4.0L naturally aspirated flat-six",
    horsepower: 502,
    torque: "331 lb-ft",
    transmission: "6-speed manual or 7-speed PDK",
    drivetrain: "RWD",
    mpgOrRange: "15 city / 18 highway mpg",
    msrp: 182900,
    engineDisplacementL: 4.0,
    cylinders: 6,
    fuelType: "Premium gasoline",
    doors: 2,
  },
  {
    make: "porsche",
    modelPatterns: [/\b911\b/],
    trimPatterns: [/\bgt3\b.*\brs\b/],
    startYear: 2022,
    bodyStyle: "Coupe",
    engine: "4.0L naturally aspirated flat-six",
    horsepower: 518,
    torque: "342 lb-ft",
    transmission: "7-speed PDK dual-clutch automatic",
    drivetrain: "RWD",
    mpgOrRange: "14 city / 18 highway mpg",
    msrp: 241300,
    engineDisplacementL: 4.0,
    cylinders: 6,
    fuelType: "Premium gasoline",
    doors: 2,
  },
  {
    make: "porsche",
    modelPatterns: [/\b911\b/],
    trimPatterns: [/\bgt3\b/],
    startYear: 2022,
    bodyStyle: "Coupe",
    engine: "4.0L naturally aspirated flat-six",
    horsepower: 502,
    torque: "331 lb-ft",
    transmission: "6-speed manual or 7-speed PDK",
    drivetrain: "RWD",
    mpgOrRange: "15 city / 18 highway mpg",
    msrp: 182900,
    engineDisplacementL: 4.0,
    cylinders: 6,
    fuelType: "Premium gasoline",
    doors: 2,
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
  const trim = normalize(input.trim);
  const combinedModel = `${model} ${trim}`.trim();
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
  const modelMatches = rule.modelPatterns.some((pattern) => pattern.test(combinedModel));
  const trimMatches = !rule.trimPatterns?.length || rule.trimPatterns.some((pattern) => pattern.test(trim));
  return modelMatches && trimMatches;
}

export function getCuratedSpecialtySpecs(input: CuratedSpecialtyLookupInput) {
  return CURATED_SPECIALTY_SPECS.find((rule) => matchesRule(rule, input)) ?? null;
}

export function applyCuratedSpecialtySpecs(vehicle: VehicleRecord): VehicleRecord {
  const curated = getCuratedSpecialtySpecs(vehicle);
  if (!curated) {
    return vehicle;
  }

  return {
    ...vehicle,
    bodyStyle: isMeaningfulText(vehicle.bodyStyle) ? vehicle.bodyStyle : curated.bodyStyle,
    vehicleType: vehicle.vehicleType ?? curated.vehicleType ?? "car",
    engine: isMeaningfulText(vehicle.engine) ? vehicle.engine : curated.engine,
    horsepower: isPositiveNumber(vehicle.horsepower) ? vehicle.horsepower : curated.horsepower,
    torque: isMeaningfulText(vehicle.torque) ? vehicle.torque : curated.torque,
    transmission: isMeaningfulText(vehicle.transmission) ? vehicle.transmission : curated.transmission,
    drivetrain: isMeaningfulText(vehicle.drivetrain) ? vehicle.drivetrain : curated.drivetrain,
    mpgOrRange: isMeaningfulText(vehicle.mpgOrRange) ? vehicle.mpgOrRange : curated.mpgOrRange ?? vehicle.mpgOrRange,
    msrp: isPositiveNumber(vehicle.msrp) ? vehicle.msrp : curated.msrp ?? vehicle.msrp,
    engineDisplacementL: isPositiveNumber(vehicle.engineDisplacementL) ? vehicle.engineDisplacementL : curated.engineDisplacementL ?? vehicle.engineDisplacementL,
    cylinders: isPositiveNumber(vehicle.cylinders) ? vehicle.cylinders : curated.cylinders ?? vehicle.cylinders,
    fuelType: isMeaningfulText(vehicle.fuelType) ? vehicle.fuelType : curated.fuelType ?? vehicle.fuelType,
    doors: isPositiveNumber(vehicle.doors) ? vehicle.doors : curated.doors ?? vehicle.doors,
  };
}
