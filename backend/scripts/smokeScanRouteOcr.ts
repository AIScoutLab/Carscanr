import fs from "node:fs";
import path from "node:path";
import inject from "light-my-request";
import { createApp } from "../src/app.js";

function parseArgs(argv: string[]) {
  const imagePath = argv[0];
  const guestId = argv[1] ?? "smoke-ocr-route";
  return {
    imagePath,
    guestId,
  };
}

function createMultipartImageBody(filename: string, contentType: string, content: Buffer) {
  const boundary = "----carscanr-ocr-route-boundary";
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

async function main() {
  const { imagePath, guestId } = parseArgs(process.argv.slice(2));
  if (!imagePath) {
    console.error("Usage: npx tsx scripts/smokeScanRouteOcr.ts <image-path> [guest-id]");
    process.exit(1);
  }

  const absoluteImagePath = path.resolve(process.cwd(), imagePath);
  const imageBuffer = fs.readFileSync(absoluteImagePath);
  const filename = path.basename(absoluteImagePath);
  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === ".png" ? "image/png" : "image/jpeg";
  const multipart = createMultipartImageBody(filename, contentType, imageBuffer);
  const app = createApp();

  const response = await inject(app as any, {
    method: "POST",
    url: "/api/scan/identify",
    headers: {
      ...multipart.headers,
      "x-carscanr-guest-id": guestId,
    },
    payload: multipart.payload,
  });

  const body = JSON.parse(response.payload);
  console.log(
    JSON.stringify(
      {
        statusCode: response.statusCode,
        requestId: body.requestId ?? null,
        meta: body.meta ?? null,
        result: body.success
          ? {
              confidence: body.data.confidence,
              normalizedResult: body.data.normalizedResult,
              topCandidate: body.data.candidates?.[0] ?? null,
            }
          : body.error,
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
