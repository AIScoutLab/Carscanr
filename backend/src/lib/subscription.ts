import { UserPlan } from "../types/domain.js";

export function normalizePlan(plan?: string | null): UserPlan {
  if (plan === "pro" || plan === "pro_monthly" || plan === "pro_yearly") {
    return plan;
  }
  return "free";
}

export function isProPlan(plan?: UserPlan | null) {
  return plan === "pro" || plan === "pro_monthly" || plan === "pro_yearly";
}

export function planHasProEntitlement(plan?: UserPlan | null) {
  return isProPlan(plan);
}
