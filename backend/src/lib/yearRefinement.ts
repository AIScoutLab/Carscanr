import { VisionCandidate, VisionResult } from "../types/domain.js";

type YearRange = {
  start: number;
  end: number;
};

type YearRefinementProfileWindow = {
  start: number;
  end: number;
  preferredYears?: number[];
  reasoning: string;
};

type YearRefinementProfile = {
  familyKey: string;
  windows: YearRefinementProfileWindow[];
};

export type YearRefinementCandidate = {
  year: number;
  score: number;
  reasons: string[];
};

export type YearRefinementResult = {
  bestYear: number;
  yearRange: YearRange | null;
  yearConfidence: "exact" | "estimated" | "range";
  yearReasoning: string[];
  candidates: YearRefinementCandidate[];
  overruledAiYear: boolean;
  profileApplied: boolean;
  rangeWidenedByProfile: boolean;
};

const YEAR_REFINEMENT_PROFILES: YearRefinementProfile[] = [
  {
    familyKey: "bmw:z3",
    windows: [
      {
        start: 1996,
        end: 2002,
        preferredYears: [2000],
        reasoning: "BMW Z3 production spans 1996-2002, and facelift-era cues often align more closely with 2000 models than pre-facelift guesses.",
      },
    ],
  },
  {
    familyKey: "aston martin:v8 vantage",
    windows: [
      {
        start: 2005,
        end: 2012,
        preferredYears: [2010],
        reasoning: "Aston Martin V8 Vantage visual matches are often generation-level; 2010 is a safer facelift-era anchor than an earlier first-guess year.",
      },
    ],
  },
  {
    familyKey: "honda:civic",
    windows: [
      {
        start: 1992,
        end: 1995,
        preferredYears: [1995],
        reasoning: "Early-1990s Honda Civic identification is often generation-level; the 1992-1995 EG generation should be treated as a range, with 1995 as a conservative late-cycle estimate.",
      },
    ],
  },
  {
    familyKey: "toyota:highlander",
    windows: [
      {
        start: 2020,
        end: 2023,
        preferredYears: [2023],
        reasoning: "Current-generation Toyota Highlander matches should consider the full 2020-2023 run, with 2023 as the safest late-cycle refinement when visuals are close.",
      },
    ],
  },
];

function normalizeText(value: string | undefined | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function familyKeyFor(make: string | undefined | null, model: string | undefined | null) {
  return `${normalizeText(make)}:${normalizeText(model)}`;
}

function uniqueSortedYears(years: number[]) {
  return Array.from(new Set(years.filter((year) => Number.isFinite(year) && year > 0))).sort((left, right) => left - right);
}

function buildOrderedYearsAround(center: number, years: number[]) {
  return [...years].sort((left, right) => {
    const leftDistance = Math.abs(left - center);
    const rightDistance = Math.abs(right - center);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    if (left >= center && right < center) {
      return -1;
    }
    if (right >= center && left < center) {
      return 1;
    }
    return left - right;
  });
}

function findMatchingProfileWindow(
  familyKey: string,
  likelyYear: number,
  alternateYears: number[],
) {
  const profile = YEAR_REFINEMENT_PROFILES.find((entry) => entry.familyKey === familyKey) ?? null;
  if (!profile) {
    return null;
  }
  const nearbyYears = [likelyYear, ...alternateYears];
  return (
    profile.windows.find((window) =>
      nearbyYears.some((year) => Number.isFinite(year) && year > 0 && year >= window.start && year <= window.end),
    ) ?? null
  );
}

export function refineVehicleYearEstimate(input: {
  normalizedResult: VisionResult;
  canonicalAvailableYears?: number[];
  nowYear?: number;
}): YearRefinementResult | null {
  const result = input.normalizedResult;
  if (result.likely_year <= 0) {
    return null;
  }
  if (result.yearConfidence === "exact" || result.yearEvidence === "visible_text") {
    return {
      bestYear: result.likely_year,
      yearRange: result.yearRange ?? null,
      yearConfidence: "exact",
      yearReasoning: ["Visible text or OCR confirms the exact model year."],
      candidates: [
        {
          year: result.likely_year,
          score: 1,
          reasons: ["visible_year_evidence"],
        },
      ],
      overruledAiYear: false,
      profileApplied: false,
      rangeWidenedByProfile: false,
    };
  }

  const familyKey = familyKeyFor(result.likely_make, result.likely_model);
  const alternateYears = result.alternate_candidates.map((candidate: VisionCandidate) => candidate.likely_year);
  const matchedWindow = findMatchingProfileWindow(familyKey, result.likely_year, alternateYears);
  const fallbackStart = Math.max(1980, result.likely_year - 2);
  const fallbackEnd = Math.min(input.nowYear ?? new Date().getFullYear() + 1, result.likely_year + 3);
  const yearRange =
    matchedWindow != null
      ? {
          start: matchedWindow.start,
          end: matchedWindow.end,
        }
      : result.yearRange ?? {
          start: fallbackStart,
          end: fallbackEnd,
        };
  const originalRange = result.yearRange ?? null;

  const candidatePool = uniqueSortedYears([
    result.likely_year,
    ...alternateYears,
    ...(input.canonicalAvailableYears ?? []),
    ...Array.from({ length: yearRange.end - yearRange.start + 1 }, (_, index) => yearRange.start + index),
  ]).filter((year) => year >= yearRange.start && year <= yearRange.end);

  const alternateConfidenceByYear = new Map<number, number>();
  for (const candidate of result.alternate_candidates) {
    const previous = alternateConfidenceByYear.get(candidate.likely_year) ?? 0;
    alternateConfidenceByYear.set(candidate.likely_year, Math.max(previous, candidate.confidence));
  }
  const canonicalYearSet = new Set(input.canonicalAvailableYears ?? []);
  const preferredYearSet = new Set(matchedWindow?.preferredYears ?? []);
  const orderedYears = buildOrderedYearsAround(result.likely_year, candidatePool);
  const candidates = orderedYears.map((year) => {
    let score = 1;
    const reasons: string[] = [];
    const distance = Math.abs(year - result.likely_year);
    score -= distance * 0.08;
    if (distance === 0) {
      reasons.push("matches_ai_best_guess");
    } else {
      reasons.push(`distance_${distance}`);
    }
    if (alternateConfidenceByYear.has(year)) {
      score += Math.min(0.18, (alternateConfidenceByYear.get(year) ?? 0) * 0.18);
      reasons.push("provider_alternate_support");
    }
    if (canonicalYearSet.has(year)) {
      score += 0.12;
      reasons.push("catalog_available");
    }
    if (preferredYearSet.has(year)) {
      score += 0.28;
      reasons.push("generation_or_facelift_anchor");
    }
    if (matchedWindow && year >= matchedWindow.start && year <= matchedWindow.end) {
      score += 0.06;
      reasons.push("within_known_generation");
    }
    return {
      year,
      score: Number(score.toFixed(3)),
      reasons,
    };
  });

  candidates.sort((left, right) => right.score - left.score || Math.abs(left.year - result.likely_year) - Math.abs(right.year - result.likely_year) || left.year - right.year);
  const bestCandidate = candidates[0] ?? null;
  if (!bestCandidate) {
    return null;
  }

  const runnerUp = candidates[1] ?? null;
  const spread = runnerUp ? bestCandidate.score - runnerUp.score : 0.3;
  const yearConfidence: "estimated" | "range" =
    spread < 0.12 || yearRange.end - yearRange.start >= 3 ? "range" : "estimated";

  const yearReasoning = [
    matchedWindow?.reasoning ?? "Visual-only year estimates are treated as a range instead of a single exact year.",
    canonicalYearSet.size > 0
      ? `Catalog-supported years in this family: ${uniqueSortedYears([...canonicalYearSet]).join(", ")}.`
      : "No exact catalog-year proof was required to preserve a visual-only range.",
    preferredYearSet.has(bestCandidate.year)
      ? `${bestCandidate.year} scored highest because it matches a known generation/facelift anchor for this family.`
      : `${bestCandidate.year} scored highest after combining provider confidence, generation compatibility, and catalog availability.`,
  ];

  return {
    bestYear: bestCandidate.year,
    yearRange,
    yearConfidence,
    yearReasoning,
    candidates,
    overruledAiYear: bestCandidate.year !== result.likely_year,
    profileApplied: matchedWindow != null,
    rangeWidenedByProfile:
      matchedWindow != null &&
      (!!originalRange
        ? yearRange.start < originalRange.start || yearRange.end > originalRange.end
        : true),
  };
}
