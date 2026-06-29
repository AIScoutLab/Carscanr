import assert from "node:assert/strict";
import test from "node:test";
import { AccountService } from "../src/services/accountService.js";

function createFakeAdminClient() {
  const deletedTables: Array<{ table: string; userId: string }> = [];
  const deletedUsers: string[] = [];

  return {
    deletedTables,
    deletedUsers,
    client: {
      from(table: string) {
        return {
          delete() {
            return {
              async eq(column: string, userId: string) {
                assert.equal(column, "user_id");
                deletedTables.push({ table, userId });
                return { error: null, count: 1 };
              },
            };
          },
        };
      },
      auth: {
        admin: {
          async deleteUser(userId: string) {
            deletedUsers.push(userId);
            return { error: null };
          },
        },
      },
    },
  };
}

test("account deletion removes app-owned user data and then deletes the auth user", async () => {
  const fake = createFakeAdminClient();
  const service = new AccountService(fake.client as any);

  const result = await service.deleteAccount("user-delete-1");

  assert.equal(result.deleted, true);
  assert.deepEqual(
    fake.deletedTables.map((entry) => entry.table),
    [
      "vision_debug_logs",
      "garage_items",
      "user_vehicle_unlocks",
      "user_unlock_balances",
      "subscriptions",
      "usage_counters",
      "scans",
    ],
  );
  assert.deepEqual(new Set(fake.deletedTables.map((entry) => entry.userId)), new Set(["user-delete-1"]));
  assert.deepEqual(fake.deletedUsers, ["user-delete-1"]);
  assert.equal(result.retainedBillingAudit, true);
});
