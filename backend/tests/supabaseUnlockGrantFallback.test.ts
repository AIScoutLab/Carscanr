import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SupabaseVehicleUnlockRepository } from "../src/repositories/supabaseRepositories.js";

type Row = Record<string, any>;

class FakeSupabaseTableQuery {
  private filters: Record<string, unknown> = {};
  private mode: "select" | "insert" | "upsert" | "delete" = "select";
  private payload: Row | null = null;

  constructor(
    private readonly tableName: string,
    private readonly state: {
      balances: Row[];
      unlocks: Row[];
    },
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  order() {
    return this;
  }

  maybeSingle() {
    const row = this.findRows()[0] ?? null;
    return Promise.resolve({ data: row, error: null });
  }

  insert(payload: Row) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  upsert(payload: Row) {
    this.mode = "upsert";
    this.payload = payload;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  single() {
    if (!this.payload) {
      return Promise.resolve({ data: null, error: null });
    }

    if (this.tableName === "user_vehicle_unlocks" && this.mode === "insert") {
      const duplicate = this.state.unlocks.find((row) =>
        row.user_id === this.payload?.user_id && row.unlock_key === this.payload?.unlock_key
      );
      if (duplicate) {
        return Promise.resolve({
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        });
      }
      this.state.unlocks.push(this.payload);
      return Promise.resolve({ data: this.payload, error: null });
    }

    if (this.tableName === "user_unlock_balances" && this.mode === "upsert") {
      const index = this.state.balances.findIndex((row) => row.user_id === this.payload?.user_id);
      if (index === -1) {
        this.state.balances.push(this.payload);
      } else {
        this.state.balances[index] = { ...this.state.balances[index], ...this.payload };
      }
      const row = this.state.balances.find((entry) => entry.user_id === this.payload?.user_id) ?? null;
      return Promise.resolve({ data: row, error: null });
    }

    return Promise.resolve({ data: null, error: null });
  }

  then(resolve: (value: { data: Row[] | null; error: null }) => void) {
    if (this.mode === "delete") {
      this.state.unlocks = this.state.unlocks.filter((row) => !this.matches(row));
      resolve({ data: [], error: null });
      return;
    }
    resolve({ data: this.findRows(), error: null });
  }

  private findRows() {
    const rows = this.tableName === "user_unlock_balances" ? this.state.balances : this.state.unlocks;
    return rows.filter((row) => this.matches(row));
  }

  private matches(row: Row) {
    return Object.entries(this.filters).every(([key, value]) => row[key] === value);
  }
}

function createFailingRpcClient(seed: { freeUnlocksUsed: number; unlockCredits: number }) {
  const state = {
    balances: [
      {
        user_id: "demo-user",
        free_unlocks_total: 3,
        free_unlocks_used: seed.freeUnlocksUsed,
        unlock_credits: seed.unlockCredits,
        created_at: "2026-06-04T12:00:00.000Z",
        updated_at: "2026-06-04T12:00:00.000Z",
      },
    ],
    unlocks: [] as Row[],
  };
  const client = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function public.grant_user_vehicle_unlock in the schema cache",
        },
      });
    },
    from(tableName: string) {
      return new FakeSupabaseTableQuery(tableName, state);
    },
  };
  return { client: client as any, state };
}

describe("Supabase vehicle unlock grant RPC fallback", () => {
  test("consumes a purchased unlock credit when RPC grant fails", async () => {
    const { client, state } = createFailingRpcClient({
      freeUnlocksUsed: 3,
      unlockCredits: 5,
    });
    const repository = new SupabaseVehicleUnlockRepository(client);

    const result = await repository.grantUnlock({
      userId: "demo-user",
      unlockKey: "vehicle:2023:audi:a5:premium-plus-quattro:car",
      unlockType: "vehicle",
      vehicleKey: "vehicle:2023:audi:a5:premium-plus-quattro:car",
      sourceVehicleId: "estimate:manual-search:2023-audi-a5-quattro",
    });

    assert.equal(result.allowed, true);
    assert.equal(result.usedUnlock, true);
    assert.equal(result.usedUnlockCredit, true);
    assert.equal(result.freeUnlocksRemaining, 0);
    assert.equal(result.unlockCreditsRemaining, 4);
    assert.equal(state.unlocks.length, 1);
    assert.equal(state.balances[0].unlock_credits, 4);
  });

  test("returns insufficient credits when RPC fails and no unlocks remain", async () => {
    const { client, state } = createFailingRpcClient({
      freeUnlocksUsed: 3,
      unlockCredits: 0,
    });
    const repository = new SupabaseVehicleUnlockRepository(client);

    const result = await repository.grantUnlock({
      userId: "demo-user",
      unlockKey: "vehicle:2023:audi:a5:premium-plus-quattro:car",
      unlockType: "vehicle",
      vehicleKey: "vehicle:2023:audi:a5:premium-plus-quattro:car",
      sourceVehicleId: "estimate:manual-search:2023-audi-a5-quattro",
    });

    assert.equal(result.allowed, false);
    assert.equal(result.usedUnlock, false);
    assert.equal(result.usedUnlockCredit, false);
    assert.equal(result.freeUnlocksRemaining, 0);
    assert.equal(result.unlockCreditsRemaining, 0);
    assert.equal(state.unlocks.length, 0);
  });
});
