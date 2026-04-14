import { AuthUser, SubscriptionStatus } from "@/types";

// Non-production UI placeholders only.
// Vehicle/spec/listing/value data must come from backend APIs.
export const defaultSubscriptionStatus: SubscriptionStatus = {
  plan: "free",
  renewalLabel: "Upgrade for unlimited Pro details",
  scansUsed: 0,
  scansRemaining: null,
  limitType: "lifetime",
  limit: null,
  scansUsedToday: 0,
  dailyScanLimit: null,
};

// Auth/profile placeholder until real user session data is wired.
export const seedUser: AuthUser = {
  id: "user_001",
  email: "alex@example.com",
  fullName: "Alex Parker",
};
