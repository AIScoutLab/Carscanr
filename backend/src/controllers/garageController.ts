import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { GarageService } from "../services/garageService.js";

export class GarageController {
  constructor(private readonly garageService: GarageService) {}

  save = async (req: Request, res: Response) => {
    const result = await this.garageService.save({
      userId: req.auth!.userId,
      vehicleId: req.body.vehicleId,
      imageUrl: req.body.imageUrl,
      notes: req.body.notes,
      favorite: req.body.favorite,
    });
    return sendSuccess(res, result);
  };

  list = async (req: Request, res: Response) => {
    const result = await this.garageService.list(req.auth!.userId);
    return sendSuccess(res, result, { count: result.length });
  };

  delete = async (req: Request, res: Response) => {
    await this.garageService.delete(req.auth!.userId, String(req.params.id));
    return sendSuccess(res, { deleted: true });
  };
}
