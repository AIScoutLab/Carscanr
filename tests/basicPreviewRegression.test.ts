import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const screenPath = path.join(process.cwd(), "app/scan/result.tsx");

test("basic info preview avoids the dead-end partial specs loading copy", () => {
  const screenSource = fs.readFileSync(screenPath, "utf8");

  assert.doesNotMatch(screenSource, /Partial specs are still loading for this result\./);
  assert.match(screenSource, /const previewFallbackFacts = \[/);
  assert.match(screenSource, /const hasMeaningfulBasicInfo = previewSpecFacts\.length > 0 \|\| previewFallbackFacts\.length > 0/);
  assert.match(screenSource, /previewSecondaryLabel = previewSpecFacts\.length > 0 \? "Confirmed details" : "Quick overview"/);
  assert.match(screenSource, /Unlock full details to load deeper specs, value, and nearby listings\./);
  assert.doesNotMatch(screenSource, /Confidence note:/);
});
