const SPECIALTY_EXOTIC_MAKES = new Set([
  "ferrari",
  "lamborghini",
  "mclaren",
  "aston martin",
  "bentley",
  "rolls royce",
  "rolls-royce",
  "porsche",
  "maserati",
  "lotus",
  "maybach",
  "bugatti",
  "pagani",
  "koenigsegg",
]);

function normalizeMake(make: string | null | undefined) {
  return String(make ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isSpecialtyExoticMake(make: string | null | undefined) {
  return SPECIALTY_EXOTIC_MAKES.has(normalizeMake(make));
}

export function buildSpecialtyVehicleOverview(input: {
  make: string;
  model: string;
  bodyStyle?: string | null;
}) {
  const bodyStyle = String(input.bodyStyle ?? "").trim().toLowerCase();
  if (bodyStyle.includes("coupe") || bodyStyle.includes("convertible") || bodyStyle.includes("spider")) {
    return "Exotic sports car with collector-market pricing. Market value can vary widely by mileage, condition, options, service history, and provenance.";
  }
  return "High-performance specialty vehicle. Market value can vary widely by mileage, condition, options, service history, and provenance.";
}
