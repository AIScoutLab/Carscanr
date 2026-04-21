import cron, { ScheduledTask } from "node-cron";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { supabaseAdmin } from "../lib/supabase.js";

type HeartbeatAttempt = {
  table: string;
  column: string;
};

export type SupabaseHeartbeatResult = {
  success: boolean;
  message: string;
  table: string | null;
};

const HEARTBEAT_ATTEMPTS: HeartbeatAttempt[] = [
  { table: "canonical_vehicles", column: "id" },
  { table: "vehicle_global_trending", column: "id" },
  { table: "valuations", column: "id" },
  { table: "listing_results", column: "id" },
  { table: "usage_counters", column: "id" },
];

const HEARTBEAT_CRON_SCHEDULE = "0 3 * * *";
const HEARTBEAT_TIMEOUT_MS = 8000;

function timeoutMessage(timeoutMs: number) {
  return `Supabase heartbeat timed out after ${timeoutMs}ms.`;
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage(timeoutMs))), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

class SupabaseHeartbeatService {
  private scheduler: ScheduledTask | null = null;
  private startupTriggered = false;

  async run(trigger: "endpoint" | "startup" | "scheduler" = "endpoint"): Promise<SupabaseHeartbeatResult> {
    if (!supabaseAdmin) {
      const message = "Supabase heartbeat skipped because Supabase is not configured.";
      logger.warn({ trigger, configured: false }, `[heartbeat] ${message}`);
      return {
        success: false,
        message,
        table: null,
      };
    }

    for (const attempt of HEARTBEAT_ATTEMPTS) {
      try {
        const query = supabaseAdmin.from(attempt.table).select(attempt.column).limit(1);
        const result = await withTimeout(query as PromiseLike<{ error?: { code?: string | null; message?: string | null } | null }>, HEARTBEAT_TIMEOUT_MS);
        const error = result?.error ?? null;

        if (error) {
          logger.warn(
            {
              trigger,
              table: attempt.table,
              column: attempt.column,
              code: error.code ?? null,
              message: error.message,
            },
            `[heartbeat] read failed for ${attempt.table}`,
          );
          continue;
        }

        const message = `Supabase heartbeat succeeded via ${attempt.table}.`;
        logger.info(
          {
            trigger,
            table: attempt.table,
            column: attempt.column,
          },
          `[heartbeat] ${message}`,
        );
        return {
          success: true,
          message,
          table: attempt.table,
        };
      } catch (error) {
        logger.warn(
          {
            trigger,
            table: attempt.table,
            column: attempt.column,
            message: error instanceof Error ? error.message : "Unknown heartbeat failure",
          },
          `[heartbeat] read failed for ${attempt.table}`,
        );
      }
    }

    const message = "Supabase heartbeat failed for all fallback tables.";
    logger.error(
      {
        trigger,
        attempts: HEARTBEAT_ATTEMPTS.map((attempt) => attempt.table),
      },
      `[heartbeat] ${message}`,
    );
    return {
      success: false,
      message,
      table: null,
    };
  }

  startScheduler() {
    if (this.scheduler || env.NODE_ENV === "test") {
      return;
    }

    this.scheduler = cron.schedule(HEARTBEAT_CRON_SCHEDULE, async () => {
      logger.info({ schedule: HEARTBEAT_CRON_SCHEDULE }, "[heartbeat] scheduled heartbeat started");
      const result = await this.run("scheduler");
      logger.info(
        {
          schedule: HEARTBEAT_CRON_SCHEDULE,
          success: result.success,
          table: result.table,
          message: result.message,
        },
        "[heartbeat] scheduled heartbeat finished",
      );
    });
    logger.info({ schedule: HEARTBEAT_CRON_SCHEDULE }, "[heartbeat] scheduler registered");
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
            success: result.success,
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
}

export const supabaseHeartbeatService = new SupabaseHeartbeatService();
