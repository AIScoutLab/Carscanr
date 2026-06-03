import { env } from "../src/config/env.js";
import { supabaseAdmin } from "../src/lib/supabase.js";
import { revenueCatProductIds, SubscriptionService } from "../src/services/subscriptionService.js";

type RevenueCatEventRow = {
  id: string;
  app_user_id: string | null;
  user_id: string | null;
  event_type: string;
  product_id: string | null;
  transaction_id: string | null;
  original_transaction_id: string | null;
  payload_summary: Record<string, unknown> | null;
  created_at: string;
};

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function buildReplayPayload(row: RevenueCatEventRow) {
  const summary = row.payload_summary ?? {};
  return {
    event: {
      id: row.id,
      type: row.event_type,
      app_user_id: row.app_user_id ?? row.user_id ?? undefined,
      product_id: row.product_id ?? undefined,
      transaction_id: row.transaction_id ?? undefined,
      original_transaction_id: row.original_transaction_id ?? undefined,
      event_timestamp_ms: readNumber(summary.eventTimestampMs) ?? Date.parse(row.created_at),
      purchased_at_ms: readNumber(summary.purchasedAtMs),
      expiration_at_ms: readNumber(summary.expirationAtMs),
      cancel_reason: readString(summary.cancelReason),
      expiration_reason: readString(summary.expirationReason),
      environment: readString(summary.environment),
      store: readString(summary.store),
    },
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  const productIds = [
    revenueCatProductIds.monthlyPro,
    revenueCatProductIds.yearlyPro,
    revenueCatProductIds.unlockPack5,
  ];
  const { data, error } = await supabaseAdmin
    .from("revenuecat_events")
    .select("id, app_user_id, user_id, event_type, product_id, transaction_id, original_transaction_id, payload_summary, created_at")
    .eq("processed", false)
    .in("product_id", productIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load unprocessed RevenueCat events: ${error.message}`);
  }

  const rows = (data ?? []) as RevenueCatEventRow[];
  console.log(`Found ${rows.length} unprocessed RevenueCat monetization event(s).`);
  if (!apply) {
    for (const row of rows) {
      console.log(
        JSON.stringify({
          id: row.id,
          eventType: row.event_type,
          productId: row.product_id,
          appUserIdPresent: Boolean(row.app_user_id),
          userIdPresent: Boolean(row.user_id),
          transactionIdPresent: Boolean(row.transaction_id),
          createdAt: row.created_at,
        }),
      );
    }
    console.log("Dry run only. Re-run with --apply after the subscription plan migration is live.");
    console.log("If no row appears here, resend the failed event from RevenueCat's event detail page.");
    return;
  }

  const service = new SubscriptionService();
  for (const row of rows) {
    const result = await service.processRevenueCatWebhook({
      authorizationHeader: `Bearer ${env.REVENUECAT_WEBHOOK_AUTH_TOKEN}`,
      payload: buildReplayPayload(row),
    });
    console.log(JSON.stringify({ id: row.id, action: result.action, plan: result.plan ?? null }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
