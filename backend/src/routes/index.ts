import express from "express";
import multer from "multer";
import { env } from "../config/env.js";
import { GarageController } from "../controllers/garageController.js";
import { ScanController } from "../controllers/scanController.js";
import { SubscriptionController } from "../controllers/subscriptionController.js";
import { UnlockController } from "../controllers/unlockController.js";
import { UsageController } from "../controllers/usageController.js";
import { VehicleController } from "../controllers/vehicleController.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import {
  garageDeleteParamsSchema,
  garageSaveSchema,
  subscriptionVerifySchema,
  unlockUseSchema,
  vehicleListingsQuerySchema,
  vehicleSearchQuerySchema,
  vehicleSpecsQuerySchema,
  vehicleValueQuerySchema,
} from "../types/api.js";
import { GarageService } from "../services/garageService.js";
import { ScanService } from "../services/scanService.js";
import { SubscriptionService } from "../services/subscriptionService.js";
import { UnlockService } from "../services/unlockService.js";
import { UsageService } from "../services/usageService.js";
import { VehicleService } from "../services/vehicleService.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_FILE_SIZE_BYTES },
});

const usageService = new UsageService();
const subscriptionService = new SubscriptionService();
const unlockService = new UnlockService();
const scanController = new ScanController(new ScanService(usageService));
const vehicleController = new VehicleController(new VehicleService());
const garageController = new GarageController(new GarageService());
const subscriptionController = new SubscriptionController(subscriptionService);
const unlockController = new UnlockController(unlockService);
const usageController = new UsageController(usageService);

export function buildApiRouter() {
  const router = express.Router();

  router.use(optionalAuthMiddleware);
  router.post(
    "/scan/identify",
    rateLimit({ windowMs: 60 * 1000, max: env.SCAN_RATE_LIMIT_PER_MIN, keyPrefix: "scan-identify" }),
    upload.single("image"),
    asyncHandler(scanController.identify),
  );
  router.get("/usage/today", asyncHandler(usageController.getToday));
  router.get("/vehicle/search", validate(vehicleSearchQuerySchema, "query"), asyncHandler(vehicleController.search));
  router.get("/vehicle/specs", validate(vehicleSpecsQuerySchema, "query"), asyncHandler(vehicleController.getSpecs));
  router.get("/vehicle/value", validate(vehicleValueQuerySchema, "query"), asyncHandler(vehicleController.getValue));
  router.get("/vehicle/listings", validate(vehicleListingsQuerySchema, "query"), asyncHandler(vehicleController.getListings));

  router.use(authMiddleware);
  router.post(
    "/scan/premium",
    rateLimit({ windowMs: 60 * 1000, max: env.SCAN_RATE_LIMIT_PER_MIN, keyPrefix: "scan-premium" }),
    upload.single("image"),
    asyncHandler(scanController.premium),
  );
  router.post("/garage/save", validate(garageSaveSchema, "body"), asyncHandler(garageController.save));
  router.get("/garage/list", asyncHandler(garageController.list));
  router.delete("/garage/:id", validate(garageDeleteParamsSchema, "params"), asyncHandler(garageController.delete));
  router.post(
    "/subscription/verify",
    rateLimit({ windowMs: 10 * 60 * 1000, max: env.UNLOCK_RATE_LIMIT_PER_10_MIN, keyPrefix: "subscription-verify" }),
    validate(subscriptionVerifySchema, "body"),
    asyncHandler(subscriptionController.verify),
  );
  router.post("/subscription/cancel", asyncHandler(subscriptionController.cancel));
  router.get("/unlocks/status", asyncHandler(unlockController.status));
  router.post(
    "/unlocks/use",
    rateLimit({ windowMs: 10 * 60 * 1000, max: env.UNLOCK_RATE_LIMIT_PER_10_MIN, keyPrefix: "unlocks-use" }),
    validate(unlockUseSchema, "body"),
    asyncHandler(unlockController.useUnlock),
  );

  return router;
}
