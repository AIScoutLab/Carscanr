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

const vehicleLookupDescriptorFields = {
  vehicleId: z.string().min(1).optional(),
  year: z.coerce.number().int().min(1886).max(2100).optional(),
  make: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1)).optional(),
  model: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1)).optional(),
  trim: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().min(1)).optional(),
  vehicleType: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }, z.string()).optional(),
  bodyStyle: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string()).optional(),
  normalizedModel: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalized.length > 0 ? normalized : undefined;
  }, z.string().min(1)).optional(),
} as const;

function requireVehicleLookup<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((value, ctx) => {
    const hasVehicleId = typeof value.vehicleId === "string" && value.vehicleId.trim().length > 0;
    const hasDescriptor = typeof value.year === "number" && !!value.make && !!value.model;
    if (hasVehicleId || hasDescriptor) {
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "vehicleId or year/make/model is required",
      path: ["vehicleId"],
    });
  });
}

export const vehicleSpecsQuerySchema = requireVehicleLookup(
  z.object({
    ...vehicleLookupDescriptorFields,
  }),
);

export const vehicleSearchQuerySchema = z.object({
  year: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
});

export const vehicleValueQuerySchema = requireVehicleLookup(
  z.object({
    ...vehicleLookupDescriptorFields,
    zip: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(3).max(10)),
    mileage: z.coerce.number().min(0).max(500000),
    condition: z.preprocess((value) => {
      if (typeof value !== "string") {
        return value;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }, z.string()).optional(),
  }),
);

export const vehicleListingsQuerySchema = requireVehicleLookup(
  z.object({
    ...vehicleLookupDescriptorFields,
    zip: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(3).max(10)),
    radiusMiles: z.coerce.number().min(1).max(250).default(50),
  }),
);

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
