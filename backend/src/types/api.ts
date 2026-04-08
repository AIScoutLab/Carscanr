import { z } from "zod";

export type ApiSuccess<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  requestId?: string;
};

export type ApiError = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
};

export const identifyScanSchema = z.object({
  garageVehicleIdHint: z.string().optional(),
});

export const vehicleSpecsQuerySchema = z.object({
  vehicleId: z.string().min(1),
});

export const vehicleSearchQuerySchema = z.object({
  year: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
});

export const vehicleValueQuerySchema = z.object({
  vehicleId: z.string().min(1),
  zip: z.string().min(3).max(10),
  mileage: z.coerce.number().min(0).max(500000),
  condition: z.enum(["poor", "fair", "good", "very_good", "excellent"]),
});

export const vehicleListingsQuerySchema = z.object({
  vehicleId: z.string().min(1),
  zip: z.string().min(3).max(10),
  radiusMiles: z.coerce.number().min(1).max(250).default(50),
});

export const garageSaveSchema = z.object({
  vehicleId: z.string().min(1),
  imageUrl: z.string().url().or(z.string().startsWith("file://")).or(z.string().startsWith("https://")),
  notes: z.string().max(1000).optional().default(""),
  favorite: z.boolean().optional().default(false),
});

export const subscriptionVerifySchema = z.object({
  platform: z.enum(["ios"]),
  receiptData: z.string().min(10),
  productId: z.string().min(3),
});

export const unlockUseSchema = z.object({
  vehicleId: z.string().min(1),
  scanId: z.string().uuid().optional().nullable(),
});

export const garageDeleteParamsSchema = z.object({
  id: z.string().min(1),
});
