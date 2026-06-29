import { AppError } from "../errors/appError.js";
import { logger } from "../lib/logger.js";
import { supabaseAdmin } from "../lib/supabase.js";

type SupabaseDeleteResult = {
  error: unknown;
  count?: number | null;
};

const USER_DATA_TABLES = [
  "vision_debug_logs",
  "garage_items",
  "user_vehicle_unlocks",
  "user_unlock_balances",
  "subscriptions",
  "usage_counters",
  "scans",
] as const;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Supabase error.";
}

export class AccountService {
  constructor(private readonly adminClient = supabaseAdmin) {}

  async deleteAccount(userId: string) {
    if (!this.adminClient) {
      throw new AppError(
        500,
        "SUPABASE_NOT_CONFIGURED",
        "Account deletion is not configured on the server.",
      );
    }

    const deletedTables: string[] = [];

    for (const table of USER_DATA_TABLES) {
      const { error } = (await this.adminClient
        .from(table)
        .delete({ count: "exact" })
        .eq("user_id", userId)) as SupabaseDeleteResult;

      if (error) {
        logger.error(
          {
            userId,
            table,
            error: getErrorMessage(error),
          },
          "ACCOUNT_DELETE_USER_DATA_FAILED",
        );
        throw new AppError(500, "ACCOUNT_DELETE_FAILED", "Unable to delete account data.");
      }

      deletedTables.push(table);
    }

    const { error: deleteUserError } = await this.adminClient.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      logger.error(
        {
          userId,
          error: getErrorMessage(deleteUserError),
        },
        "ACCOUNT_DELETE_AUTH_USER_FAILED",
      );
      throw new AppError(500, "ACCOUNT_DELETE_FAILED", "Unable to delete the account.");
    }

    logger.info(
      {
        userId,
        deletedTables,
        retainedBillingAudit: true,
      },
      "ACCOUNT_DELETE_SUCCEEDED",
    );

    return {
      deleted: true,
      deletedTables,
      retainedBillingAudit: true,
    };
  }
}
