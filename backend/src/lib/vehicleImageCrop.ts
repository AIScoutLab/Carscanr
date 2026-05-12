import sharp from "sharp";

export type VehicleFocusCrop = {
  buffer: Buffer;
  width: number;
  height: number;
  format: "jpeg";
};

export async function createVehicleFocusCrop(
  inputImageBuffer: Buffer,
  metadata?: { width?: number | null; height?: number | null } | null,
): Promise<VehicleFocusCrop> {
  const baseImage = sharp(inputImageBuffer, { failOnError: false });
  const imageMetadata = await baseImage.metadata();
  const sourceWidth = metadata?.width ?? imageMetadata.width ?? 0;
  const sourceHeight = metadata?.height ?? imageMetadata.height ?? 0;

  if (!sourceWidth || !sourceHeight) {
    throw new Error("Unable to determine source dimensions for vehicle focus crop.");
  }

  const portrait = sourceHeight > sourceWidth;
  const cropWidthRatio = portrait ? 0.78 : 0.7;
  const cropHeightRatio = portrait ? 0.56 : 0.68;
  const cropWidth = Math.max(1, Math.round(sourceWidth * cropWidthRatio));
  const cropHeight = Math.max(1, Math.round(sourceHeight * cropHeightRatio));
  const left = Math.max(0, Math.round((sourceWidth - cropWidth) / 2));
  const topAnchorRatio = portrait ? 0.16 : 0.2;
  const top = Math.max(0, Math.min(sourceHeight - cropHeight, Math.round(sourceHeight * topAnchorRatio)));

  const buffer = await baseImage
    .extract({
      left,
      top,
      width: Math.min(cropWidth, sourceWidth - left),
      height: Math.min(cropHeight, sourceHeight - top),
    })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();

  return {
    buffer,
    width: Math.min(cropWidth, sourceWidth - left),
    height: Math.min(cropHeight, sourceHeight - top),
    format: "jpeg",
  };
}
