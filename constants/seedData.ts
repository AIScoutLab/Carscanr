import { AuthUser, SubscriptionStatus } from "@/types";

// Non-production UI placeholders only.
// Vehicle/spec/listing/value data must come from backend APIs.
export const defaultSubscriptionStatus: SubscriptionStatus = {
  plan: "free",
  renewalLabel: "Upgrade for unlimited scans",
  scansUsed: 0,
  scansRemaining: 5,
  limitType: "lifetime",
  limit: 5,
  scansUsedToday: 0,
  dailyScanLimit: 5,
};

// Auth/profile placeholder until real user session data is wired.
export const seedUser: AuthUser = {
  id: "user_001",
  email: "alex@example.com",
  fullName: "Alex Parker",
};
