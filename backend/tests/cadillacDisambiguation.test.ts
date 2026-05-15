import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVisionResult } from "../src/services/scanService.js";

test("visible CT4 text evidence overrides an ambiguous Cadillac CT5 sibling result", () => {
  const normalized = normalizeVisionResult({
    vehicle_type: "car",
    likely_year: 2021,
    likely_make: "Cadillac",
    likely_model: "CT5",
    likely_trim: "Premium Luxury",
    confidence: 0.88,
    visible_clues: ["Compact sedan proportions", "Vertical LED signature", "Narrow grille opening"],
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
  assert.ok(normalized.confidence >= 0.9);
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
