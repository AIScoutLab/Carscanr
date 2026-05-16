import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const screenPath = path.join(process.cwd(), "app/vehicle/[id].tsx");
const cardPath = path.join(process.cwd(), "components/ValueEstimateCard.tsx");

test("value results keep the live market button grouped with the card", () => {
  const screenSource = fs.readFileSync(screenPath, "utf8");
  const cardSource = fs.readFileSync(cardPath, "utf8");

  assert.match(screenSource, /const loadingValueCardCopy = \{/);
  assert.match(screenSource, /<ApproximateDataState[\s\S]*title=\{loadingValueCardCopy\.title\}[\s\S]*loading/);
  assert.doesNotMatch(screenSource, /Updating live value…/);
  assert.doesNotMatch(screenSource, /Updating pricing…/);
  assert.doesNotMatch(screenSource, /Updating live listings…/);
  assert.match(cardSource, /actionLabel\?: string \| null;/);
  assert.match(cardSource, /<Pressable[\s\S]*actionButton/);
});

test("listings refresh hydrates value state from cached listings", () => {
  const screenSource = fs.readFileSync(screenPath, "utf8");

  assert.match(screenSource, /\.getListings\([\s\S]*fetchReason:\s*"user_requested_listings_refresh"/);
  assert.match(screenSource, /buildListingsHydratedValuation/);
  assert.match(screenSource, /VALUE_COMP_SOURCE/);
  assert.match(screenSource, /VALUE_COMP_DERIVATION_STARTED/);
  assert.match(screenSource, /VALUE_COMP_DERIVATION_RESULT/);
  assert.match(screenSource, /acceptedListingsAvailable: true/);
  assert.match(screenSource, /listingCacheKeysChecked: \["shared_vehicle_listings"\]/);
});

test("vehicle detail tabs keep shared vertical spacing around cards and bottom actions", () => {
  const screenSource = fs.readFileSync(screenPath, "utf8");

  assert.match(screenSource, /<Animated\.View style=\{\[styles\.contentStack,/);
  assert.match(screenSource, /contentStack:\s*\{\s*gap:\s*18\s*\}/);
  assert.match(screenSource, /bottomActionStack:\s*\{[^}]*marginTop:\s*6[^}]*paddingTop:\s*10/);
});
