import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("fresh scanned vehicle details expose Save to Garage without relying on restart or the old result screen", () => {
  const detailSource = read("app/vehicle/[id].tsx");
  const scanTabSource = read("app/(tabs)/scan.tsx");
  const cameraSource = read("app/scan/camera.tsx");

  assert.match(scanTabSource, /buildVehicleDetailRouteFromScanResult\(result/);
  assert.match(cameraSource, /buildVehicleDetailRouteFromScanResult\(result/);
  assert.match(detailSource, /const \[garageActionState, setGarageActionState\] = useState<"idle" \| "checking" \| "saving" \| "saved" \| "removing">\("checking"\)/);
  assert.match(detailSource, /const garageActionLabel = garageSaved[\s\S]*: "\+ Add to Garage"/);
  assert.match(detailSource, /const saveVehicleToGarage = useCallback\(async \(\) => \{/);
  assert.match(detailSource, /<View style=\{styles\.garageActionBlock\}>/);
  assert.match(detailSource, /<Text style=\{\[styles\.garageActionText, garageSaved && styles\.garageActionTextSaved\]\}>\{garageActionLabel\}<\/Text>/);
  assert.match(detailSource, /garageService\s*\.\s*saveEstimate\(\{/);
  assert.match(detailSource, /findMatchingGarageItem\(await garageService\.list\(\)\)/);
});

test("vehicle detail saved badge is based on Garage state, not reopenedSource routing", () => {
  const detailSource = read("app/vehicle/[id].tsx");

  assert.match(detailSource, /\{garageSource === "1" \|\| garageSaved \? <Text style=\{styles\.unlockStatusMeta\}>Saved<\/Text> : null\}/);
  assert.doesNotMatch(detailSource, /garageSource === "1" \|\| reopenedSource === "1" \? <Text style=\{styles\.unlockStatusMeta\}>Saved<\/Text> : null/);
});
