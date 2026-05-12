import { normalizeLookupText } from "./providerCache.js";

export type AliasNormalizedVehicleIdentity = {
  make: string;
  model: string;
  trim: string | null;
  badgeText: string | null;
  aliasApplied: boolean;
  aliasLabels: string[];
};

export type MercedesSlNormalizedIdentity = {
  make: string;
  model: string;
  trim: string | null;
  normalizationApplied: boolean;
};

type CanonicalLookupAliasInput = {
  make: string;
  model: string;
  trim?: string | null;
  badgeText?: string | null;
  modelText?: string | null;
};

function trimOrNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBadgeSpacing(value: string | null | undefined) {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, " ").trim();
}

function normalizeCommonTrimFormatting(trim: string | null | undefined) {
  const normalized = normalizeLookupText(trim);
  if (!normalized) {
    return trimOrNull(trim);
  }
  if (normalized === "ex l" || normalized === "exl") return "EX-L";
  if (normalized === "lx s" || normalized === "lxs") return "LX-S";
  if (normalized === "xse" || normalized === "x se") return "XSE";
  if (normalized === "xle" || normalized === "x le") return "XLE";
  if (normalized === "se" || normalized === "s e") return "SE";
  if (normalized === "sel" || normalized === "s el") return "SEL";
  return trimOrNull(trim);
}

function isMercedesMake(normalizedMake: string) {
  return normalizedMake === "mercedes-benz" || normalizedMake === "mercedes benz";
}

function isBmw3Series(normalizedMake: string, normalizedModel: string) {
  return normalizedMake === "bmw" && normalizedModel === "3 series";
}

function isRam1500(normalizedMake: string, normalizedModel: string) {
  return normalizedMake === "ram" && normalizedModel === "ram 1500";
}

function isAstonMartinVantage(normalizedMake: string, normalizedModel: string) {
  return normalizedMake === "aston martin" && normalizedModel === "vantage";
}

function hasAstonMartinV12Evidence(...values: Array<string | null | undefined>) {
  const joined = values.map((value) => normalizeLookupText(value)).join(" ");
  return /\bv12\b/.test(joined);
}

function isBmw3SeriesVariant(normalizedModel: string) {
  return /^3\d{2}[a-z0-9-]*$/i.test(normalizedModel);
}

function extractMercedesSlBadgeSeries(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeLookupText(value);
    const matched = normalized.match(/\bsl[\s-]*(320|500|600)\b/);
    if (matched) {
      return matched[1];
    }
  }
  return null;
}

function extractMercedesSClassBadgeSeries(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeLookupText(value);
    const matched = normalized.match(/\bs\s*(430|500|550|600|63)\b/);
    if (matched) {
      return matched[1];
    }
  }
  return null;
}

export function normalizeMercedesSlIdentity(input: {
  make: string;
  model: string;
  trim?: string | null;
  badgeText?: string | null;
  modelText?: string | null;
}) : MercedesSlNormalizedIdentity {
  const make = input.make.trim();
  const model = input.model.trim();
  const trim = trimOrNull(input.trim);
  const normalizedMake = normalizeLookupText(make);
  const normalizedModel = normalizeLookupText(model);
  const normalizedTrim = normalizeLookupText(trim);
  const slSeries = extractMercedesSlBadgeSeries(model, trim, input.badgeText, input.modelText);
  const trimOnlySeries = normalizedTrim.match(/^(320|500|600)$/)?.[1] ?? null;
  const modelOnlySeries = normalizedModel.match(/^sl[\s-]?(320|500|600)$/)?.[1] ?? null;

  const shouldNormalize =
    isMercedesMake(normalizedMake) &&
    Boolean(
      slSeries ||
      modelOnlySeries ||
      ((normalizedModel === "sl" || normalizedModel === "sl class" || normalizedModel === "sl-class") && trimOnlySeries),
    );

  if (!shouldNormalize) {
    return {
      make,
      model,
      trim,
      normalizationApplied: false,
    };
  }

  const series = slSeries ?? modelOnlySeries ?? trimOnlySeries;
  return {
    make,
    model: "SL-Class",
    trim: series ? `SL${series}` : trim,
    normalizationApplied: true,
  };
}

export function normalizeVehicleBadgeAlias(input: {
  make: string;
  model: string;
  trim?: string | null;
  badgeText?: string | null;
}) : AliasNormalizedVehicleIdentity {
  const labels: string[] = [];
  const make = input.make.trim();
  let model = input.model.trim();
  let trim = trimOrNull(input.trim);
  const badgeText = normalizeBadgeSpacing(input.badgeText);

  const normalizedMake = normalizeLookupText(make);
  const normalizedModel = normalizeLookupText(model);
  const normalizedTrim = normalizeLookupText(trim);
  const normalizedBadge = normalizeLookupText(badgeText);

  if (normalizedMake === "honda" && (normalizedModel === "crv" || normalizedModel === "cr-v")) {
    if (model !== "CR-V") {
      model = "CR-V";
      labels.push("honda-crv-model");
    }
  }

  if (isMercedesMake(normalizedMake)) {
    const normalizedMercedesSl = normalizeMercedesSlIdentity({
      make,
      model,
      trim,
      badgeText,
    });
    if (normalizedMercedesSl.normalizationApplied) {
      model = normalizedMercedesSl.model;
      trim = normalizedMercedesSl.trim;
      labels.push("mercedes-sl-family");
    }

    const sSeries = extractMercedesSClassBadgeSeries(model, trim, badgeText);
    if (
      sSeries &&
      (normalizedModel === "s" ||
        normalizedModel === "s class" ||
        normalizedModel === `s${sSeries}` ||
        normalizedBadge.includes(`s ${sSeries}`) ||
        normalizedBadge.includes(`s${sSeries}`))
    ) {
      model = "S-Class";
      trim = `S${sSeries}`;
      labels.push("mercedes-s-class-family");
    }
  }

  const normalizedFormattedTrim = normalizeCommonTrimFormatting(trim);
  if (normalizedFormattedTrim && normalizedFormattedTrim !== trim) {
    trim = normalizedFormattedTrim;
    labels.push("common-trim-format");
  }

  return {
    make,
    model,
    trim,
    badgeText,
    aliasApplied: labels.length > 0,
    aliasLabels: labels,
  };
}

export function getCanonicalLookupAliasCandidates(input: CanonicalLookupAliasInput) {
  const normalizedMake = normalizeLookupText(input.make);
  const normalizedModel = normalizeLookupText(input.model);
  const condensedModel = normalizedModel.replace(/[^a-z0-9]+/g, "");
  const candidates = new Set<string>([normalizedModel]);

  if (normalizedModel.includes("-")) {
    candidates.add(normalizedModel.replace(/-/g, " "));
  }
  if (normalizedModel.includes(" ")) {
    candidates.add(normalizedModel.replace(/\s+/g, "-"));
  }
  if (condensedModel && condensedModel !== normalizedModel) {
    candidates.add(condensedModel);
  }

  if (isAstonMartinVantage(normalizedMake, normalizedModel)) {
    candidates.add("v8 vantage");
    if (hasAstonMartinV12Evidence(input.trim, input.badgeText, input.modelText)) {
      candidates.add("v12 vantage");
    }
  }

  if (normalizedMake === "honda" && (normalizedModel === "cr-v" || normalizedModel === "crv")) {
    candidates.add("cr-v");
    candidates.add("crv");
    candidates.add("cr v");
  }

  if (isMercedesMake(normalizedMake) && normalizedModel === "sl500") {
    candidates.add("sl-class");
    candidates.add("sl class");
  }

  if (isBmw3Series(normalizedMake, normalizedModel)) {
    candidates.add("325i");
    candidates.add("330i");
  }

  if (normalizedMake === "jeep" && normalizedModel === "wrangler") {
    candidates.add("wrangler unlimited");
  }

  if (normalizedMake === "ford" && normalizedModel === "f-150") {
    candidates.add("f150");
    candidates.add("f 150");
  }

  if (normalizedMake === "chevrolet" && normalizedModel === "corvette") {
    candidates.add("chevrolet corvette");
  }

  if (normalizedMake === "porsche" && normalizedModel === "911") {
    candidates.add("carrera");
    candidates.add("911 carrera");
  }

  if (isRam1500(normalizedMake, normalizedModel)) {
    candidates.add("1500");
  }

  if (normalizedMake === "volkswagen" && normalizedModel === "gti") {
    candidates.add("golf gti");
  }

  if (normalizedMake === "mini" && normalizedModel === "cooper") {
    candidates.add("mini cooper");
  }

  if (normalizedMake === "subaru" && normalizedModel === "wrx") {
    candidates.add("impreza wrx");
  }

  return Array.from(candidates);
}

export function shouldBroadenCanonicalLookupModelSearch(input: CanonicalLookupAliasInput) {
  const normalizedMake = normalizeLookupText(input.make);
  const normalizedModel = normalizeLookupText(input.model);
  return (
    isAstonMartinVantage(normalizedMake, normalizedModel) ||
    isBmw3Series(normalizedMake, normalizedModel) ||
    isRam1500(normalizedMake, normalizedModel)
  );
}

export function matchesCanonicalLookupModel(input: CanonicalLookupAliasInput & { candidateModel?: string | null }) {
  const candidateModel = normalizeLookupText(input.candidateModel);
  if (!candidateModel) {
    return false;
  }

  const aliasCandidates = new Set(getCanonicalLookupAliasCandidates(input));
  if (aliasCandidates.has(candidateModel)) {
    return true;
  }

  const normalizedMake = normalizeLookupText(input.make);
  const normalizedModel = normalizeLookupText(input.model);

  if (isBmw3Series(normalizedMake, normalizedModel) && isBmw3SeriesVariant(candidateModel)) {
    return true;
  }

  return false;
}
