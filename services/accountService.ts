import { apiRequest } from "@/services/apiClient";
import { authService } from "@/services/authService";

export type AccountDeletionResult = {
  deleted: boolean;
  deletedTables?: string[];
  retainedBillingAudit?: boolean;
};

export const accountService = {
  async deleteAccount(): Promise<AccountDeletionResult> {
    const result = await apiRequest<AccountDeletionResult>({
      path: "/account",
      method: "DELETE",
      timeoutMs: 20000,
    });

    await authService.signOut().catch(() => undefined);
    return result;
  },
};
