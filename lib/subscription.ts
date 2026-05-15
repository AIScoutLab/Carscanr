import { UserPlan } from "@/types";

export function isProPlan(plan?: UserPlan | null) {
  return plan === "pro";
}

export function getPlanDisplayName(plan?: UserPlan | null) {
  if (plan === "pro") {
    return "Pro";
  }
  return "Free";
}
