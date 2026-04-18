import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import inject from "light-my-request";
import { createApp } from "../src/app.js";
import { createTestProviders, createTestRepositories } from "./helpers/testData.js";
import { resetProviders, setProviders } from "../src/lib/providerRegistry.js";
import { resetRepositories, setRepositories } from "../src/lib/repositoryRegistry.js";
import { googleVisionOcrService } from "../src/services/googleVisionOcrService.js";

const TEST_IMAGE_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2uoAAAAASUVORK5CYII=",
  "base64",
);

function createMultipartImageBody(filename = "vehicle.jpg", contentType = "image/jpeg", content = TEST_IMAGE_BUFFER) {
  const boundary = "----carscanr-ocr-route-test-boundary";
  const header = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="image"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      "",
      "",
    ].join("\r\n"),
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, content, footer]);

  return {
    payload: body,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": Buffer.byteLength(body).toString(),
    },
  };
}

describe("scan OCR route", () => {
  let originalExtractVehicleText: typeof googleVisionOcrService.extractVehicleText;

  beforeEach(() => {
    originalExtractVehicleText = googleVisionOcrService.extractVehicleText;
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
  });

  afterEach(() => {
    googleVisionOcrService.extractVehicleText = originalExtractVehicleText;
    resetRepositories();
    resetProviders();
  });

  test("POST /api/scan/identify returns OCR-forced winner on the real app route", async () => {
    googleVisionOcrService.extractVehicleText = async () => ({
      rawText: "2026 Honda CR-V",
      textLines: ["2026 Honda CR-V"],
      detectedYear: 2026,
      detectedMake: "Honda",
      detectedModel: "CR-V",
      detectedTrim: null,
      decisionReason: "structured_vehicle_confirmed",
      structuredVehicle: {
        year: 2026,
        make: "Honda",
        model: "CR-V",
        trim: null,
      },
      confidence: 0.99,
      credentialSource: "env",
    });

    setProviders({
      ...createTestProviders({
        provider: "test-vision",
        rawResponse: { source: "test" },
        normalized: {
          vehicle_type: "car",
          likely_year: 2024,
          likely_make: "Honda",
          likely_model: "CR-V",
          likely_trim: undefined,
          source: "visual_candidate",
          confidence: 0.84,
          visible_clues: [],
          alternate_candidates: [],
        },
      }),
      specsProvider: {
        async searchCandidates() {
          return [
            {
              id: "provider-2024-honda-crv-ex",
              year: 2024,
              make: "Honda",
              model: "CR-V",
              trim: "EX",
              bodyStyle: "SUV",
              vehicleType: "car",
              msrp: 34500,
              engine: "1.5L turbo I4",
              horsepower: 190,
              torque: "179 lb-ft",
              transmission: "CVT",
              drivetrain: "AWD",
              mpgOrRange: "27 city / 32 highway",
              colors: ["Urban Gray Pearl"],
            },
          ];
        },
        async getVehicleSpecs() {
          throw new Error("Not used in OCR route test.");
        },
        async searchVehicles() {
          throw new Error("Not used in OCR route test.");
        },
      },
    });

    const multipart = createMultipartImageBody();
    const app = createApp();
    const response = await inject(app as any, {
      method: "POST",
      url: "/api/scan/identify",
      headers: {
        ...multipart.headers,
        authorization: "Bearer dev-session:demo-user:demo%40example.com",
      },
      payload: multipart.payload,
    });

    const body = JSON.parse(response.payload);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.normalizedResult.source, "ocr_override");
    assert.equal(body.data.normalizedResult.likely_year, 2026);
    assert.equal(body.data.normalizedResult.likely_make, "Honda");
    assert.equal(body.data.normalizedResult.likely_model, "CR-V");
    assert.equal(body.data.candidates[0].year, 2026);
    assert.equal(body.data.candidates[0].make, "Honda");
    assert.equal(body.data.candidates[0].model, "CR-V");
    assert.equal(body.meta.scanRuntimeVersion, "ocr-hard-override-route-v1");
  });
});
