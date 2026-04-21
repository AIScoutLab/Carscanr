import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { SupabaseHeartbeatResult, supabaseHeartbeatService } from "../services/supabaseHeartbeatService.js";

function heartbeatMeta(result: SupabaseHeartbeatResult) {
  return {
    table: result.table,
  };
}

export class HeartbeatController {
  run = async (_req: Request, res: Response) => {
    const result = await supabaseHeartbeatService.run("endpoint");
    return sendSuccess(
      res,
      {
        ok: result.ok,
        message: result.message,
      },
      heartbeatMeta(result),
    );
  };
}
