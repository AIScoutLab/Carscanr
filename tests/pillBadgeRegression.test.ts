import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("canonical premium badge component does not expose the old aqua/green pill palette", () => {
  const pillBadgeSource = read("components/PillBadge.tsx");

  for (const forbiddenToken of [
    "rgba(94, 235, 255, 0.12)",
    "rgba(94, 235, 255, 0.18)",
    "rgba(122, 240, 168, 0.12)",
    "rgba(122, 240, 168, 0.20)",
  ]) {
    assert.equal(pillBadgeSource.includes(forbiddenToken), false, `Legacy pill token ${forbiddenToken} leaked back into PillBadge.tsx`);
  }
});

test("high-risk screens do not carry the old bright pill colors inline", () => {
  const guardedFiles = [
    "app/(tabs)/scan.tsx",
    "app/(tabs)/garage.tsx",
    "app/scan/result.tsx",
    "app/scan/camera.tsx",
    "components/PaywallCard.tsx",
    "components/UpgradePromptCard.tsx",
    "components/ProLockCard.tsx",
  ];

  for (const filePath of guardedFiles) {
    const source = read(filePath);
    for (const forbiddenToken of [
      "rgba(0, 194, 255, 0.12)",
      "rgba(94, 231, 255, 0.12)",
      "rgba(122, 240, 168, 0.12)",
      "Colors.cyanGlow",
    ]) {
      assert.equal(source.includes(forbiddenToken), false, `Legacy pill styling token ${forbiddenToken} leaked back into ${filePath}`);
    }
  }
});

test("banned decorative labels do not return on high-risk production screens", () => {
  const guardedFiles = [
    "app/(tabs)/scan.tsx",
    "app/(tabs)/garage.tsx",
    "app/scan/camera.tsx",
    "app/vehicle/[id].tsx",
    "components/EmptyState.tsx",
  ];

  for (const filePath of guardedFiles) {
    const source = read(filePath);
    for (const forbiddenLabel of [
      "Ready to identify",
      "SCAN IN PROGRESS",
      "Scan in progress",
      "Garage archive",
      "VEHICLE DOSSIER",
      "Vehicle dossier",
    ]) {
      assert.equal(source.includes(forbiddenLabel), false, `Decorative label ${forbiddenLabel} leaked back into ${filePath}`);
    }
  }
});
