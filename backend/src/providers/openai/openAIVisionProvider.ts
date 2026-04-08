import { env } from "../../config/env.js";
import { AppError } from "../../errors/appError.js";
import { VisionProvider } from "../interfaces.js";
import { VisionProviderResult, VisionResult } from "../../types/domain.js";

type OpenAIResponse = {
  id: string;
  model: string;
  output?: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
};

type OpenAIVisionSchema = {
  vehicle_type: "car" | "motorcycle";
  likely_year: string;
  likely_make: string;
  likely_model: string;
  likely_trim: string | null;
  confidence: number;
  visible_clues: string[];
  alternate_candidates: Array<{
    year: string;
    make: string;
    model: string;
    trim: string | null;
    confidence: number;
  }>;
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "vehicle_type",
    "likely_year",
    "likely_make",
    "likely_model",
    "likely_trim",
    "confidence",
    "visible_clues",
    "alternate_candidates",
  ],
  properties: {
    vehicle_type: {
      type: "string",
      enum: ["car", "motorcycle"],
    },
    likely_year: {
      type: "string",
    },
    likely_make: {
      type: "string",
    },
    likely_model: {
      type: "string",
    },
    likely_trim: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    visible_clues: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    alternate_candidates: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["year", "make", "model", "trim", "confidence"],
        properties: {
          year: { type: "string" },
          make: { type: "string" },
          model: { type: "string" },
          trim: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
      },
    },
  },
} as const;

const vehicleVisionInstructions = [
  "You are a vehicle identification system.",
  "Analyze the provided image and identify the vehicle as accurately as possible.",
  "Return strict JSON only.",
  "Determine whether the vehicle is a car or motorcycle.",
  "Estimate the most likely year, make, and model.",
  "Include trim only if reasonably visible or strongly inferable.",
  "If uncertain, provide best estimate and lower confidence.",
  "Provide up to 3 alternate candidates.",
  "Base output only on visible evidence and common vehicle design cues.",
  "Do not invent VINs or hidden details.",
  "Keep confidence between 0 and 1.",
].join(" ");

function extractOutputText(response: OpenAIResponse) {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
      if (content.type === "refusal" && content.refusal) {
        throw new AppError(502, "VISION_MODEL_REFUSAL", content.refusal);
      }
    }
  }
  throw new AppError(502, "VISION_MODEL_EMPTY", "Vision model returned no text output.");
}

function normalizeVisionSchema(input: OpenAIVisionSchema): VisionResult {
  const parseYear = (value: string) => {
    const matched = value.match(/\d{4}/);
    return matched ? Number(matched[0]) : 0;
  };

  const normalizeConfidence = (value: number) => Math.max(0, Math.min(1, value));

  return {
    vehicle_type: input.vehicle_type,
    likely_year: parseYear(input.likely_year),
    likely_make: input.likely_make.trim(),
    likely_model: input.likely_model.trim(),
    likely_trim: input.likely_trim?.trim() || undefined,
    confidence: normalizeConfidence(input.confidence),
    visible_clues: input.visible_clues.map((clue) => clue.trim()).filter(Boolean).slice(0, 8),
    alternate_candidates: input.alternate_candidates
      .map((candidate) => ({
        likely_year: parseYear(candidate.year),
        likely_make: candidate.make.trim(),
        likely_model: candidate.model.trim(),
        likely_trim: candidate.trim?.trim() || undefined,
        confidence: normalizeConfidence(candidate.confidence),
      }))
      .filter((candidate) => candidate.likely_year > 0 && candidate.likely_make && candidate.likely_model)
      .slice(0, 3),
  };
}

export class OpenAIVisionProvider implements VisionProvider {
  async identifyFromImage(input: { imageBuffer: Buffer; mimeType: string; fileName?: string }): Promise<VisionProviderResult> {
    if (!env.OPENAI_API_KEY) {
      throw new AppError(500, "OPENAI_API_KEY_MISSING", "OPENAI_API_KEY is required for the OpenAI vision provider.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.OPENAI_VISION_TIMEOUT_MS);

    try {
      const base64Image = input.imageBuffer.toString("base64");
      const response = await fetch(`${env.OPENAI_BASE_URL}/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.OPENAI_VISION_MODEL,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: vehicleVisionInstructions,
                },
                {
                  type: "input_image",
                  image_url: `data:${input.mimeType};base64,${base64Image}`,
                  detail: "high",
                },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "vehicle_identification_result",
              strict: true,
              schema: responseSchema,
            },
          },
        }),
      });

      const rawResponse = (await response.json()) as OpenAIResponse | { error?: { message?: string } };

      if (!response.ok) {
        const message =
          "error" in rawResponse && rawResponse.error?.message
            ? rawResponse.error.message
            : `OpenAI vision request failed with status ${response.status}`;
        throw new AppError(502, "VISION_PROVIDER_ERROR", message, rawResponse);
      }

      const outputText = extractOutputText(rawResponse as OpenAIResponse);
      let parsed: OpenAIVisionSchema;
      try {
        parsed = JSON.parse(outputText) as OpenAIVisionSchema;
      } catch {
        throw new AppError(502, "VISION_INVALID_JSON", "Vision provider returned invalid JSON.", {
          rawResponse,
          outputText,
        });
      }

      return {
        normalized: normalizeVisionSchema(parsed),
        rawResponse,
        provider: "openai",
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError(504, "VISION_TIMEOUT", "Vision provider timed out.");
      }
      // TODO: Refine prompt and confidence calibration after collecting real-world scan/debug samples.
      throw new AppError(
        502,
        "VISION_PROVIDER_ERROR",
        error instanceof Error ? error.message : "Unknown vision provider error.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
