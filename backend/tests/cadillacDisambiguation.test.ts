import assert from "node:assert/strict";
import test from "node:test";
import { refineVehicleYearEstimate } from "../src/lib/yearRefinement.js";
import { normalizeVisionResult } from "../src/services/scanService.js";

test("visible CT4 text evidence overrides an ambiguous Cadillac CT5 sibling result", () => {
  const normalized = normalizeVisionResult({
    vehicle_type: "car",
    likely_year: 2021,
    likely_make: "Cadillac",
    likely_model: "CT5",
    likely_trim: "Premium Luxury",
    confidence: 0.88,
    visible_clues: ["Compact sedan proportions", "Vertical LED signature", "Narrow grille opening", "Shorter wheelbase", "Short front overhang"],
    visible_badge_text: "CT4 Premium Luxury",
    visible_model_text: "CT4",
    alternate_candidates: [
      {
        likely_year: 2021,
        likely_make: "Cadillac",
        likely_model: "CT4",
        likely_trim: "Premium Luxury",
        confidence: 0.8,
      },
    ],
  });

  assert.equal(normalized.likely_model, "CT4");
  assert.ok(normalized.confidence <= 0.91);
  assert.ok(normalized.confidence >= 0.82);
});

test("Cadillac CT4/CT5 close calls keep the sibling alternate and lower confidence", () => {
  const normalized = normalizeVisionResult({
    vehicle_type: "car",
    likely_year: 2022,
    likely_make: "Cadillac",
    likely_model: "CT5",
    likely_trim: "Sport",
    confidence: 0.86,
    visible_clues: ["Vertical LED signature", "Cadillac crest grille"],
    alternate_candidates: [
      {
        likely_year: 2022,
        likely_make: "Cadillac",
        likely_model: "CT4",
        likely_trim: "Sport",
        confidence: 0.82,
      },
    ],
  });

  assert.equal(normalized.likely_model, "CT5");
  assert.ok(normalized.confidence <= 0.74);
  assert.ok(normalized.alternate_candidates.some((candidate) => candidate.likely_model === "CT4"));
});

test("Cadillac CT4-V style visual clues do not resolve to an overconfident CT5", () => {
  const normalized = normalizeVisionResult({
    vehicle_type: "car",
    likely_year: 2023,
    likely_make: "Cadillac",
    likely_model: "CT5",
    likely_trim: "V-Series",
    confidence: 0.95,
    visible_clues: [
      "Compact sedan proportions",
      "Vertical DRL signature",
      "Shorter wheelbase",
      "Short hood",
      "Tighter front overhang",
      "Smaller lower intake",
    ],
    alternate_candidates: [
      {
        likely_year: 2023,
        likely_make: "Cadillac",
        likely_model: "CT4",
        likely_trim: "V-Series",
        confidence: 0.86,
      },
    ],
  });

  assert.notEqual(normalized.confidence > 0.9 && normalized.likely_model === "CT5", true);
  assert.ok(normalized.likely_model === "CT4" || normalized.alternate_candidates.some((candidate) => candidate.likely_model === "CT4"));
});

test("clear CT4 family evidence avoids low-confidence CT4/CT5 ambiguity cap", () => {
  const normalized = normalizeVisionResult({
    vehicle_type: "car",
    likely_year: 2021,
    likely_make: "Cadillac",
    likely_model: "CT5",
    likely_trim: "Premium Luxury",
    confidence: 0.87,
    visible_clues: [
      "Compact sedan proportions",
      "Shorter wheelbase",
      "Narrow grille opening",
      "Short front overhang",
      "Vertical LED signature",
    ],
    alternate_candidates: [
      {
        likely_year: 2021,
        likely_make: "Cadillac",
        likely_model: "CT4",
        likely_trim: "Premium Luxury",
        confidence: 0.83,
      },
    ],
  });

  assert.equal(normalized.likely_model, "CT4");
  assert.ok(normalized.confidence >= 0.82);
  assert.ok(normalized.confidence > 0.64);
});

test("CT4 without exact year returns a generation range fallback", () => {
  const normalized = normalizeVisionResult({
    vehicle_type: "car",
    likely_year: 0,
    likely_make: "Cadillac",
    likely_model: "CT4",
    likely_trim: "Premium Luxury",
    confidence: 0.84,
    visible_clues: ["Compact Cadillac sedan", "Shorter wheelbase", "Vertical LED signature"],
    alternate_candidates: [],
  });
  const refinement = refineVehicleYearEstimate({
    normalizedResult: normalized,
    canonicalAvailableYears: [2020, 2021, 2022, 2023, 2024, 2025],
    nowYear: 2026,
  });

  assert.equal(refinement?.yearConfidence, "range");
  assert.deepEqual(refinement?.yearRange, { start: 2020, end: 2026 });
  assert.equal(refinement?.bestYear, 2021);
});

test("clear CT5 family evidence is not blindly downgraded to CT4", () => {
  const normalized = normalizeVisionResult({
    vehicle_type: "car",
    likely_year: 2022,
    likely_make: "Cadillac",
    likely_model: "CT4",
    likely_trim: "Sport",
    confidence: 0.86,
    visible_clues: [
      "Midsize sedan proportions",
      "Longer wheelbase",
      "Broader grille",
      "Longer hood",
      "Wider DRL signature",
    ],
    alternate_candidates: [
      {
        likely_year: 2022,
        likely_make: "Cadillac",
        likely_model: "CT5",
        likely_trim: "Sport",
        confidence: 0.82,
      },
    ],
  });

  assert.equal(normalized.likely_model, "CT5");
  assert.ok(normalized.confidence >= 0.78);
});
