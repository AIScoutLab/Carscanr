import sharp from "sharp";

export type ProcessedImage = {
  buffer: Buffer;
  width: number;
  height: number;
  format: "jpeg";
};

const MAX_DIMENSION = 1280;
const OUTPUT_QUALITY = 80;

export async function resizeForVision(input: Buffer): Promise<ProcessedImage> {
  const pipeline = sharp(input, { failOnError: false });
  const metadata = await pipeline.metadata();
  const width = metadata.width ?? MAX_DIMENSION;
  const height = metadata.height ?? MAX_DIMENSION;
  const maxDim = Math.max(width, height);
  const scale = maxDim > MAX_DIMENSION ? MAX_DIMENSION / maxDim : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const buffer = await pipeline
    .resize(targetWidth, targetHeight, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: OUTPUT_QUALITY, mozjpeg: true })
    .toBuffer();

  return {
    buffer,
    width: targetWidth,
    height: targetHeight,
    format: "jpeg",
  };
}

export async function computeDhashHex(input: Buffer): Promise<string> {
  const hashWidth = 9;
  const hashHeight = 8;
  const raw = await sharp(input, { failOnError: false })
    .resize(hashWidth, hashHeight, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  const bits: number[] = [];
  for (let y = 0; y < hashHeight; y += 1) {
    for (let x = 0; x < hashWidth - 1; x += 1) {
      const left = raw[y * hashWidth + x];
      const right = raw[y * hashWidth + x + 1];
      bits.push(left > right ? 1 : 0);
    }
  }

  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const chunk = bits.slice(i, i + 4);
    const value = chunk.reduce((acc, bit, idx) => acc + (bit << (3 - idx)), 0);
    hex += value.toString(16);
  }
  return hex;
}

export function hammingDistanceHex(a: string, b: string) {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = parseInt(a[i], 16);
    const bi = parseInt(b[i], 16);
    const xor = ai ^ bi;
    distance += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return distance;
}
