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
