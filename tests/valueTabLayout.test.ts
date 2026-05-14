import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const screenPath = path.join(process.cwd(), "app/vehicle/[id].tsx");
const cardPath = path.join(process.cwd(), "components/ValueEstimateCard.tsx");

test("value results keep the live market button grouped with the card", () => {
  const screenSource = fs.readFileSync(screenPath, "utf8");
  const cardSource = fs.readFileSync(cardPath, "utf8");

  assert.match(screenSource, /<ValueEstimateCard[\s\S]*actionLabel=\{valuationLoading \? "Loading live market value\.\.\." : "Load live market value"\}/);
  assert.match(cardSource, /actionLabel\?: string \| null;/);
  assert.match(cardSource, /<Pressable[\s\S]*actionButton/);
});

test("listings refresh hydrates value state from cached listings", () => {
  const screenSource = fs.readFileSync(screenPath, "utf8");

  assert.match(screenSource, /\.getListings\([\s\S]*fetchReason:\s*"user_requested_listings_refresh"/);
  assert.match(screenSource, /\.getValue\([\s\S]*fetchReason:\s*"cached_listings_value_sync"/);
});
