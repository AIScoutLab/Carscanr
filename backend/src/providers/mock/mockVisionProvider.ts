import { VisionProvider } from "../interfaces.js";
import { VisionProviderResult, VisionResult } from "../../types/domain.js";

const cadillacResult: VisionResult = {
  vehicle_type: "car",
  likely_year: 2021,
  likely_make: "Cadillac",
  likely_model: "CT4",
  likely_trim: "Premium Luxury",
  confidence: 0.89,
  alternate_candidates: [
    { likely_year: 2020, likely_make: "Honda", likely_model: "Civic", likely_trim: "EX", confidence: 0.58 },
    { likely_year: 2022, likely_make: "Tesla", likely_model: "Model 3", likely_trim: "Long Range", confidence: 0.44 },
  ],
  visible_clues: ["vertical LED signature", "compact luxury sedan silhouette", "Cadillac crest grille shape"],
};

const teslaResult: VisionResult = {
  vehicle_type: "car",
  likely_year: 2022,
  likely_make: "Tesla",
  likely_model: "Model 3",
  likely_trim: "Long Range",
  confidence: 0.93,
  alternate_candidates: [
    { likely_year: 2021, likely_make: "Cadillac", likely_model: "CT4", likely_trim: "Premium Luxury", confidence: 0.37 },
    { likely_year: 2020, likely_make: "Honda", likely_model: "Civic", likely_trim: "EX", confidence: 0.28 },
  ],
  visible_clues: ["smooth EV nose", "Tesla side profile", "Model 3 headlight shape"],
};

const mustangResult: VisionResult = {
  vehicle_type: "car",
  likely_year: 2019,
  likely_make: "Ford",
  likely_model: "Mustang",
  likely_trim: "GT",
  confidence: 0.91,
  alternate_candidates: [
    { likely_year: 2020, likely_make: "Honda", likely_model: "Civic", likely_trim: "EX", confidence: 0.19 },
    { likely_year: 2021, likely_make: "Cadillac", likely_model: "CT4", likely_trim: "Premium Luxury", confidence: 0.16 },
  ],
  visible_clues: ["long hood coupe proportions", "Mustang fascia cues", "performance coupe stance"],
};

const kiaResult: VisionResult = {
  vehicle_type: "car",
  likely_year: 2018,
  likely_make: "Kia",
  likely_model: "Optima",
  likely_trim: "EX",
  confidence: 0.88,
  alternate_candidates: [
    { likely_year: 2019, likely_make: "Honda", likely_model: "Civic", likely_trim: "EX", confidence: 0.32 },
    { likely_year: 2020, likely_make: "Cadillac", likely_model: "CT4", likely_trim: "Premium Luxury", confidence: 0.25 },
  ],
  visible_clues: ["sleek mid-size sedan proportions", "Kia tiger-nose grille shape", "swept headlight profile"],
};

const motorcycleResult: VisionResult = {
  vehicle_type: "motorcycle",
  likely_year: 2023,
  likely_make: "Harley-Davidson",
  likely_model: "Street Glide",
  likely_trim: "Special",
  confidence: 0.9,
  alternate_candidates: [
    { likely_year: 2021, likely_make: "Yamaha", likely_model: "YZF-R3", likely_trim: "Standard", confidence: 0.22 },
  ],
  visible_clues: ["large touring fairing", "hard saddlebags", "Harley touring proportions"],
};

const carResults: VisionResult[] = [
  {
    ...cadillacResult,
  },
  {
    ...kiaResult,
  },
  {
    ...mustangResult,
  },
  {
    ...teslaResult,
  },
];

export class MockVisionProvider implements VisionProvider {
  async identifyFromImage(input: { imageBuffer: Buffer; mimeType: string; fileName?: string }): Promise<VisionProviderResult> {
    const fileNameHint = input.fileName?.toLowerCase() ?? "";

    if (fileNameHint.includes("tesla") || fileNameHint.includes("model-3")) {
      return {
        normalized: teslaResult,
        rawResponse: {
          provider: "mock",
          selectedBy: "filename",
          fileName: input.fileName,
        },
        provider: "mock",
      };
    }

    if (fileNameHint.includes("kia") || fileNameHint.includes("optima") || fileNameHint.includes("k5")) {
      return {
        normalized: kiaResult,
        rawResponse: {
          provider: "mock",
          selectedBy: "filename",
          fileName: input.fileName,
        },
        provider: "mock",
      };
    }

    if (fileNameHint.includes("mustang")) {
      return {
        normalized: mustangResult,
        rawResponse: {
          provider: "mock",
          selectedBy: "filename",
          fileName: input.fileName,
        },
        provider: "mock",
      };
    }

    if (fileNameHint.includes("harley") || fileNameHint.includes("street-glide") || fileNameHint.includes("motorcycle") || fileNameHint.includes("bike")) {
      return {
        normalized: motorcycleResult,
        rawResponse: {
          provider: "mock",
          selectedBy: "filename",
          fileName: input.fileName,
        },
        provider: "mock",
      };
    }

    const resultIndex = Math.abs(input.imageBuffer.byteLength) % carResults.length;
    return {
      normalized: carResults[resultIndex],
      rawResponse: {
        provider: "mock",
        selectedIndex: resultIndex,
        fileName: input.fileName,
      },
      provider: "mock",
    };
  }
}
