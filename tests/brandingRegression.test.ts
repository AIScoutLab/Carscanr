import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "..");
const deprecatedBrandAssetReferences = [
  "@/carscanr_app_icon_1024.png",
  "../Icon.png",
  "../../Icon.png",
  "../assets/icon.png",
  "../../assets/icon.png",
] as const;
const inspectableFiles = [
  "app",
  "components",
  "lib",
  "services",
  "constants",
  "features",
].flatMap((segment) => collectFiles(path.join(repoRoot, segment)));

function collectFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const nextPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(nextPath);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [nextPath];
  });
}

test("branding uses a single canonical logo asset path in app code", () => {
  const allowedDirectReferences = new Set([
    path.join(repoRoot, "constants", "branding.ts"),
    __filename,
  ]);

  for (const filePath of inspectableFiles) {
    if (allowedDirectReferences.has(filePath)) {
      continue;
    }
    const source = fs.readFileSync(filePath, "utf8");
    for (const forbiddenReference of deprecatedBrandAssetReferences) {
      assert.equal(
        source.includes(forbiddenReference),
        false,
        `Deprecated brand asset reference "${forbiddenReference}" found in ${path.relative(repoRoot, filePath)}`,
      );
    }
    assert.equal(
      source.includes("icon-1024.png"),
      false,
      `Direct canonical logo asset imports must route through constants/branding.ts or BrandMark.tsx (${path.relative(repoRoot, filePath)})`,
    );
  }
});
