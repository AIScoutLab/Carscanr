import fs from "node:fs";
import path from "node:path";
import { googleVisionOcrService } from "../src/services/googleVisionOcrService.js";
import { applyGoogleOcrOverride, normalizeVisionResult } from "../src/services/scanService.js";
import { VisionResult } from "../src/types/domain.js";

function normalizeText(value: string | undefined | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSignature(input: {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
}) {
  return [
    input.year,
    normalizeText(input.make),
    normalizeText(input.model),
    normalizeText(input.trim ?? ""),
  ].join("|");
}

function parseArgs(argv: string[]) {
  const imagePath = argv[0];
  const fallbackMake = argv[1] ?? "Honda";
  const fallbackModel = argv[2] ?? "CR-V";
  const fallbackYear = Number(argv[3] ?? "2024");
  return {
    imagePath,
    fallbackMake,
    fallbackModel,
    fallbackYear: Number.isFinite(fallbackYear) ? fallbackYear : 2024,
  };
}

async function main() {
  const { imagePath, fallbackMake, fallbackModel, fallbackYear } = parseArgs(process.argv.slice(2));
  if (!imagePath) {
    console.error("Usage: npx tsx scripts/smokeGoogleVisionOcr.ts <image-path> [make] [model] [year]");
    process.exit(1);
  }

  const absoluteImagePath = path.resolve(process.cwd(), imagePath);
  const imageBuffer = fs.readFileSync(absoluteImagePath);

  const baseResult: VisionResult = normalizeVisionResult({
    vehicle_type: "car",
    likely_year: fallbackYear,
    likely_make: fallbackMake,
    likely_model: fallbackModel,
    likely_trim: undefined,
    confidence: 0.86,
    alternate_candidates: [],
    visible_clues: [],
    visible_badge_text: undefined,
    visible_make_text: undefined,
    visible_model_text: undefined,
    visible_trim_text: undefined,
    emblem_logo_clues: [],
  });

  const ocr = await googleVisionOcrService.extractVehicleText({
    imageBuffer,
    mimeType: "image/jpeg",
    candidateHints: [
      {
        year: fallbackYear,
        make: fallbackMake,
        model: fallbackModel,
      },
    ],
  });

  const next = applyGoogleOcrOverride(baseResult, ocr);
  const overrideTriggered =
    buildSignature({
      year: baseResult.likely_year,
      make: baseResult.likely_make,
      model: baseResult.likely_model,
      trim: baseResult.likely_trim,
    }) !==
    buildSignature({
      year: next.likely_year,
      make: next.likely_make,
      model: next.likely_model,
      trim: next.likely_trim,
    });
  const confirmationApplied =
    !overrideTriggered &&
    Boolean(ocr?.structuredVehicle) &&
    (next.confidence - baseResult.confidence >= 0.01 ||
      next.visible_clues.some((clue) => clue.toLowerCase().startsWith("readable text confirms ")));

  console.log(
    JSON.stringify(
      {
        imagePath: absoluteImagePath,
        ocr: ocr
          ? {
              rawTextSummary: ocr.rawText.replace(/\s+/g, " ").trim().slice(0, 220),
              decisionReason: ocr.decisionReason,
              detectedYear: ocr.detectedYear,
              detectedMake: ocr.detectedMake,
              detectedModel: ocr.detectedModel,
              detectedTrim: ocr.detectedTrim,
              structuredVehicle: ocr.structuredVehicle,
              confidence: ocr.confidence,
              credentialSource: ocr.credentialSource,
            }
          : null,
        before: {
          year: baseResult.likely_year,
          make: baseResult.likely_make,
          model: baseResult.likely_model,
          trim: baseResult.likely_trim ?? null,
          confidence: baseResult.confidence,
        },
        after: {
          year: next.likely_year,
          make: next.likely_make,
          model: next.likely_model,
          trim: next.likely_trim ?? null,
          confidence: next.confidence,
        },
        overrideTriggered,
        confirmationApplied,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
