import test from "node:test";
import assert from "node:assert/strict";
import { applyGoogleOcrOverride } from "../src/services/scanService.js";
import { VisionResult } from "../src/types/domain.js";

test("applyGoogleOcrOverride hard-overrides year for text-confirmed family match", () => {
  const base: VisionResult = {
    vehicle_type: "car",
    likely_year: 2024,
    likely_make: "Honda",
    likely_model: "CR-V",
    likely_trim: "EX-L",
    confidence: 0.86,
    alternate_candidates: [],
    visible_clues: [],
    visible_make_text: "Honda",
    visible_model_text: "CR-V",
    visible_trim_text: undefined,
    visible_badge_text: undefined,
    emblem_logo_clues: [],
  };

  const next = applyGoogleOcrOverride(base, {
    rawText: "2026 Honda CR-V EX-L",
    textLines: ["2026 Honda CR-V EX-L"],
    detectedYear: 2026,
    detectedMake: "Honda",
    detectedModel: "CR-V",
    detectedTrim: "EX-L",
    decisionReason: "structured_vehicle_confirmed",
    structuredVehicle: {
      year: 2026,
      make: "Honda",
      model: "CR-V",
      trim: "EX-L",
    },
    confidence: 0.99,
    credentialSource: "env",
  });

  assert.equal(next.likely_year, 2026);
  assert.equal(next.likely_make, "Honda");
  assert.equal(next.likely_model, "CR-V");
  assert.equal(next.source, "ocr_override");
  assert.ok(next.confidence >= 0.99);
  assert.equal(next.visible_make_text, "Honda");
  assert.equal(next.visible_model_text, "CR-V");
});
