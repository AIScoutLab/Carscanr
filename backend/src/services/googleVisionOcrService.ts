import fs from "node:fs";
import path from "node:path";
import vision from "@google-cloud/vision";
import { logger } from "../lib/logger.js";

type OcrCandidateHint = {
  year?: number | null;
  make: string;
  model: string;
  trim?: string | null;
};

export type GoogleVisionOcrResult = {
  rawText: string;
  textLines: string[];
  detectedYear: number | null;
  detectedMake: string | null;
  detectedModel: string | null;
  detectedTrim: string | null;
  decisionReason:
    | "structured_vehicle_confirmed"
    | "make_only"
    | "text_detected_but_unvalidated"
    | "no_vehicle_text";
  structuredVehicle:
    | {
        year: number;
        make: string;
        model: string;
        trim?: string | null;
      }
    | null;
  confidence: number;
  credentialSource: "env" | "local-dev-fallback";
};

type OcrDecisionReason = GoogleVisionOcrResult["decisionReason"];

const KNOWN_MAKES = [
  "Mercedes-Benz",
  "Rolls-Royce",
  "Land Rover",
  "Alfa Romeo",
  "Aston Martin",
  "Chevrolet",
  "Cadillac",
  "Chrysler",
  "Volkswagen",
  "Mitsubishi",
  "Lamborghini",
  "Harley-Davidson",
  "Porsche",
  "Ferrari",
  "Bentley",
  "Maserati",
  "Genesis",
  "Hyundai",
  "Infiniti",
  "Lincoln",
  "Subaru",
  "Toyota",
  "Honda",
  "Nissan",
  "Mazda",
  "Suzuki",
  "Lexus",
  "Acura",
  "Audi",
  "Buick",
  "Dodge",
  "GMC",
  "Jeep",
  "Kia",
  "Mini",
  "Ram",
  "Volvo",
  "Ford",
  "BMW",
  "Fiat",
  "Saab",
  "Tesla",
];

let clientPromise: Promise<{ client: vision.ImageAnnotatorClient; credentialSource: "env" | "local-dev-fallback" } | null> | null = null;

function normalizeText(value: string | undefined | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(value: string | undefined | null) {
  return normalizeText(value).replace(/\s+/g, "");
}

function matchesPhrase(normalizedText: string, compactText: string, phrase: string | undefined | null) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) {
    return false;
  }
  const compactPhrase = normalizeCompact(phrase);
  return normalizedText.includes(normalizedPhrase) || (compactPhrase.length > 0 && compactText.includes(compactPhrase));
}

function collectDetectedYears(rawText: string) {
  const matches = [...rawText.matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)];
  return matches
    .map((match) => Number(match[1]))
    .filter((year, index, array) => Number.isFinite(year) && array.indexOf(year) === index);
}

function resolveLocalCredentialFallback() {
  const credentialsDir = path.resolve(process.cwd(), "credentials");
  if (!fs.existsSync(credentialsDir)) {
    return null;
  }

  const preferred = path.join(credentialsDir, "google-vision.json");
  if (fs.existsSync(preferred)) {
    return preferred;
  }

  const jsonFiles = fs
    .readdirSync(credentialsDir)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .sort();

  return jsonFiles.length > 0 ? path.join(credentialsDir, jsonFiles[0]) : null;
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const explicitCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (explicitCredentials) {
        return {
          client: new vision.ImageAnnotatorClient(),
          credentialSource: "env" as const,
        };
      }

      const localCredentialFile = resolveLocalCredentialFallback();
      if (!localCredentialFile) {
        logger.warn({ label: "GOOGLE_VISION_OCR_UNAVAILABLE", reason: "credentials-missing" }, "GOOGLE_VISION_OCR_UNAVAILABLE");
        return null;
      }

      logger.warn(
        {
          label: "GOOGLE_VISION_OCR_LOCAL_FALLBACK",
          credentialFile: path.basename(localCredentialFile),
        },
        "GOOGLE_VISION_OCR_LOCAL_FALLBACK",
      );
      return {
        client: new vision.ImageAnnotatorClient({ keyFilename: localCredentialFile }),
        credentialSource: "local-dev-fallback" as const,
      };
    })().catch((error) => {
      clientPromise = null;
      logger.warn(
        {
          label: "GOOGLE_VISION_OCR_CLIENT_INIT_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
        "GOOGLE_VISION_OCR_CLIENT_INIT_FAILED",
      );
      return null;
    });
  }

  return clientPromise;
}

function resolveBestStructuredHint(input: {
  rawText: string;
  candidateHints: OcrCandidateHint[];
  detectedYears: number[];
}): {
  detectedMake: string | null;
  detectedModel: string | null;
  detectedTrim: string | null;
  structuredVehicle: GoogleVisionOcrResult["structuredVehicle"];
  confidence: number;
  decisionReason: OcrDecisionReason;
} {
  const normalizedText = normalizeText(input.rawText);
  const compactText = normalizeCompact(input.rawText);
  const knownMake = [...new Set([...input.candidateHints.map((hint) => hint.make), ...KNOWN_MAKES])]
    .sort((left, right) => right.length - left.length)
    .find((make) => matchesPhrase(normalizedText, compactText, make)) ?? null;

  const rankedHints = input.candidateHints
    .map((hint) => {
      const makeMatch = matchesPhrase(normalizedText, compactText, hint.make);
      const modelMatch = matchesPhrase(normalizedText, compactText, hint.model);
      const trimMatch = matchesPhrase(normalizedText, compactText, hint.trim);
      const yearMatch = typeof hint.year === "number" && input.detectedYears.includes(hint.year);
      const score = (makeMatch ? 4 : 0) + (modelMatch ? 6 : 0) + (trimMatch ? 1.5 : 0) + (yearMatch ? 2.5 : 0);
      return { hint, makeMatch, modelMatch, trimMatch, yearMatch, score };
    })
    .filter((entry) => entry.makeMatch && entry.modelMatch)
    .sort((left, right) => right.score - left.score);

  const bestHint = rankedHints[0] ?? null;
  const detectedYear =
    bestHint?.yearMatch && typeof bestHint.hint.year === "number"
      ? bestHint.hint.year
      : input.detectedYears[0] ?? null;

  if (!bestHint || typeof detectedYear !== "number") {
    return {
      detectedMake: bestHint?.hint.make ?? knownMake,
      detectedModel: bestHint?.hint.model ?? null,
      detectedTrim: bestHint?.trimMatch ? bestHint.hint.trim ?? null : null,
      structuredVehicle: null,
      confidence: bestHint ? 0.72 : knownMake ? 0.45 : 0,
      decisionReason: bestHint
        ? "text_detected_but_unvalidated"
        : knownMake
          ? "make_only"
          : "no_vehicle_text",
    };
  }

  return {
    detectedMake: bestHint.hint.make,
    detectedModel: bestHint.hint.model,
    detectedTrim: bestHint.trimMatch ? bestHint.hint.trim ?? null : null,
    structuredVehicle: {
      year: detectedYear,
      make: bestHint.hint.make,
      model: bestHint.hint.model,
      trim: bestHint.trimMatch ? bestHint.hint.trim ?? null : null,
    },
    confidence: bestHint.score >= 12 ? 0.99 : 0.95,
    decisionReason: "structured_vehicle_confirmed",
  };
}

export const googleVisionOcrService = {
  async extractVehicleText(input: {
    imageBuffer: Buffer;
    mimeType: string;
    candidateHints?: OcrCandidateHint[];
  }): Promise<GoogleVisionOcrResult | null> {
    const clientBundle = await getClient();
    if (!clientBundle) {
      return null;
    }

    try {
      const [response] = await clientBundle.client.textDetection({
        image: { content: input.imageBuffer },
      });
      const rawText = response.fullTextAnnotation?.text ?? response.textAnnotations?.[0]?.description ?? "";
      if (!rawText.trim()) {
        return null;
      }

      const detectedYears = collectDetectedYears(rawText);
      const structured = resolveBestStructuredHint({
        rawText,
        candidateHints: input.candidateHints ?? [],
        detectedYears,
      });

      logger.info(
        {
          label: "GOOGLE_VISION_OCR_SUMMARY",
          rawTextSummary: rawText.replace(/\s+/g, " ").trim().slice(0, 220),
          detectedYear: detectedYears[0] ?? null,
          detectedMake: structured.detectedMake,
          detectedModel: structured.detectedModel,
          detectedTrim: structured.detectedTrim,
          decisionReason: structured.decisionReason,
          credentialSource: clientBundle.credentialSource,
        },
        "GOOGLE_VISION_OCR_SUMMARY",
      );

      return {
        rawText,
        textLines: rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        detectedYear: detectedYears[0] ?? null,
        detectedMake: structured.detectedMake,
        detectedModel: structured.detectedModel,
        detectedTrim: structured.detectedTrim,
        decisionReason: structured.decisionReason,
        structuredVehicle: structured.structuredVehicle,
        confidence: structured.confidence,
        credentialSource: clientBundle.credentialSource,
      };
    } catch (error) {
      logger.warn(
        {
          label: "GOOGLE_VISION_OCR_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
        "GOOGLE_VISION_OCR_FAILED",
      );
      return null;
    }
  },
};
