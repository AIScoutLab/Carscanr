import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FREE_PRO_UNLOCKS_TOTAL } from "../src/config/product.js";
import { SupabaseUnlockBalanceRepository } from "../src/repositories/supabaseRepositories.js";

type UpsertPayload = Record<string, unknown>;

class FakeTableQuery {
  private mode: "select" | "upsert" = "select";
  private upsertPayloads: UpsertPayload[] = [];

  constructor(
    private readonly rowsByUser: Record<string, any>,
    private readonly upsertErrors: any[],
  ) {}

  select() {
    return this;
  }

  eq(_column: string, value: string) {
    this.currentUserId = value;
    return this;
  }

  maybeSingle() {
    return Promise.resolve({
      data: this.currentUserId ? this.rowsByUser[this.currentUserId] ?? null : null,
      error: null,
    });
  }

  upsert(payload: UpsertPayload) {
    this.mode = "upsert";
    this.upsertPayloads.push(payload);
    this.pendingPayload = payload;
    return this;
  }

  single() {
    if (this.mode !== "upsert" || !this.pendingPayload) {
      return Promise.resolve({ data: null, error: null });
    }

    const error = this.upsertErrors.shift() ?? null;
    if (error) {
      return Promise.resolve({ data: null, error });
    }

    const userId = String(this.pendingPayload.user_id);
    const row = {
      user_id: userId,
      free_unlocks_total: this.pendingPayload.free_unlocks_total ?? FREE_PRO_UNLOCKS_TOTAL,
      free_unlocks_used: this.pendingPayload.free_unlocks_used ?? 0,
      created_at: this.pendingPayload.created_at ?? new Date().toISOString(),
      updated_at: this.pendingPayload.updated_at ?? new Date().toISOString(),
      ...(Object.prototype.hasOwnProperty.call(this.pendingPayload, "unlock_credits")
        ? { unlock_credits: this.pendingPayload.unlock_credits }
        : {}),
    };
    this.rowsByUser[userId] = row;
    this.pendingPayload = null;
    return Promise.resolve({ data: row, error: null });
  }

  get payloads() {
    return this.upsertPayloads;
  }

  private currentUserId: string | null = null;
  private pendingPayload: UpsertPayload | null = null;
}

describe("SupabaseUnlockBalanceRepository legacy schema compatibility", () => {
  test("getOrCreate retries without unlock_credits when legacy schema is missing the column", async () => {
    const rowsByUser: Record<string, any> = {};
    const missingColumnError = {
      code: "PGRST204",
      message: "Could not find the 'unlock_credits' column of 'user_unlock_balances' in the schema cache",
    };
    const table = new FakeTableQuery(rowsByUser, [missingColumnError]);
    const client = {
      from(tableName: string) {
        assert.equal(tableName, "user_unlock_balances");
        return table;
      },
    } as any;

    const repository = new SupabaseUnlockBalanceRepository(client);
    const balance = await repository.getOrCreate("guest:test");

    assert.equal(balance.userId, "guest:test");
    assert.equal(balance.unlockCredits, 0);
    assert.equal(table.payloads.length, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(table.payloads[0], "unlock_credits"), true);
    assert.equal(Object.prototype.hasOwnProperty.call(table.payloads[1], "unlock_credits"), false);
  });
});
