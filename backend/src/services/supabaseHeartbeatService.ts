import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { supabaseAdmin } from "../lib/supabase.js";

export type SupabaseHeartbeatResult = {
  ok: boolean;
  message: string;
  table: string | null;
};

const HEARTBEAT_TABLE = "canonical_vehicles";
const HEARTBEAT_COLUMN = "id";

class SupabaseHeartbeatService {
  private startupTriggered = false;

  async run(trigger: "endpoint" | "startup" | "scheduler" = "endpoint"): Promise<SupabaseHeartbeatResult> {
    if (!supabaseAdmin) {
      const message = "Supabase heartbeat skipped because Supabase is not configured.";
      logger.warn({ trigger, configured: false }, `[heartbeat] ${message}`);
      return {
        ok: false,
        message,
        table: null,
      };
    }

    try {
      const { error } = await supabaseAdmin.from(HEARTBEAT_TABLE).select(HEARTBEAT_COLUMN).limit(1);
      if (error) {
        const message = `Supabase heartbeat failed via ${HEARTBEAT_TABLE}.`;
        logger.warn(
          {
            trigger,
            table: HEARTBEAT_TABLE,
            column: HEARTBEAT_COLUMN,
            code: error.code ?? null,
            message: error.message,
          },
          `[heartbeat] ${message}`,
        );
        return {
          ok: false,
          message,
          table: HEARTBEAT_TABLE,
        };
      }

      const message = `Supabase heartbeat succeeded via ${HEARTBEAT_TABLE}.`;
      logger.info(
        {
          trigger,
          table: HEARTBEAT_TABLE,
          column: HEARTBEAT_COLUMN,
        },
        `[heartbeat] ${message}`,
      );
      return {
        ok: true,
        message,
        table: HEARTBEAT_TABLE,
      };
    } catch (error) {
      const message = `Supabase heartbeat failed via ${HEARTBEAT_TABLE}.`;
      logger.warn(
        {
          trigger,
          table: HEARTBEAT_TABLE,
          column: HEARTBEAT_COLUMN,
          message: error instanceof Error ? error.message : "Unknown heartbeat failure",
        },
        `[heartbeat] ${message}`,
      );
      return {
        ok: false,
        message,
        table: HEARTBEAT_TABLE,
      };
    }
  }

  triggerStartupHeartbeat() {
    if (this.startupTriggered || env.NODE_ENV === "test") {
      return;
    }

    this.startupTriggered = true;
    void this.run("startup")
      .then((result) => {
        logger.info(
          {
            ok: result.ok,
            table: result.table,
            message: result.message,
          },
          "[heartbeat] startup heartbeat finished",
        );
      })
      .catch((error) => {
        logger.error(
          {
            message: error instanceof Error ? error.message : "Unknown startup heartbeat failure",
          },
          "[heartbeat] startup heartbeat failed",
        );
      });
  }

  // TODO: Add a daily scheduled heartbeat after the deploy environment has a stable cron setup.
}

export const supabaseHeartbeatService = new SupabaseHeartbeatService();
