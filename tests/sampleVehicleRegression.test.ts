import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sampleSource = fs.readFileSync(path.join(process.cwd(), "features/scan/samplePhotos.ts"), "utf8");
const scanServiceSource = fs.readFileSync(path.join(process.cwd(), "services/scanService.ts"), "utf8");
const scanResultSource = fs.readFileSync(path.join(process.cwd(), "app/scan/result.tsx"), "utf8");
const detailSource = fs.readFileSync(path.join(process.cwd(), "app/vehicle/[id].tsx"), "utf8");
const vehicleServiceSource = fs.readFileSync(path.join(process.cwd(), "services/vehicleService.ts"), "utf8");
const listingCardSource = fs.readFileSync(path.join(process.cwd(), "components/ListingCard.tsx"), "utf8");

test("sample scan results are marked as demo vehicles and cannot spend unlocks", () => {
  assert.match(sampleSource, /demoValue/);
  assert.match(sampleSource, /demoListings/);
  assert.match(sampleSource, /Dual Motor Electric/);
  assert.match(sampleSource, /5\.0L V8/);
  assert.match(sampleSource, /Milwaukee-Eight 114 V-Twin/);

  assert.match(scanServiceSource, /source:\s*"sample_vehicle"/);
  assert.match(scanServiceSource, /unlockEligible:\s*false/);
  assert.match(scanServiceSource, /unlockRecommendationReason:\s*"sample_vehicle_demo"/);
  assert.match(scanServiceSource, /isSampleVehicle:\s*true/);
});

test("sample scan result opens details directly for guest, free, and Pro users", () => {
  assert.match(scanResultSource, /const isSampleScan = normalized\?\.isSampleVehicle === true \|\| normalized\?\.source === "sample_vehicle"/);
  assert.match(scanResultSource, /const hasFullAccess = isSampleScan\s*\?\s*true/s);
  assert.match(scanResultSource, /isSampleVehicle: isSampleScan \? "1" : "0"/);
  assert.match(scanResultSource, /source: isSampleScan \? "sample_vehicle"/);
  assert.match(scanResultSource, /unlockId: isSampleScan \? "" : buildVehicleUnlockId/);
  assert.match(scanResultSource, /if \(isSampleScan \|\| hasFullAccess\) \{\s*handleOpenFullDetail\(\);/s);

  const sampleBypassIndex = scanResultSource.indexOf("if (isSampleScan || hasFullAccess)");
  const unlockSpendIndex = scanResultSource.indexOf("useFreeUnlockForVehicle(bestMatch.id)");
  assert.ok(sampleBypassIndex > -1 && unlockSpendIndex > -1 && sampleBypassIndex < unlockSpendIndex);
});

test("sample vehicle detail renders from local data before backend lookup", () => {
  assert.match(detailSource, /const isSampleDetail =/);
  assert.match(detailSource, /vehicleService\.getSampleVehicleById\(id\)/);
  assert.match(detailSource, /SAMPLE_VEHICLE_LOCAL_RENDERED/);
  assert.match(detailSource, /backendLookupRequired:\s*false/);
  assert.match(detailSource, /unlockRequired:\s*false/);
  assert.match(detailSource, /providerCallsBlocked:\s*true/);
  assert.match(detailSource, /setError\(null\)/);

  const sampleBranchIndex = detailSource.indexOf("if (isSampleDetail)");
  const backendLookupIndex = detailSource.indexOf(".getVehicleById(id)");
  assert.ok(sampleBranchIndex > -1 && backendLookupIndex > -1 && sampleBranchIndex < backendLookupIndex);
});

test("sample vehicles show labeled demo value and listings without live refresh", () => {
  assert.match(vehicleServiceSource, /function buildSampleVehicleRecord/);
  assert.match(vehicleServiceSource, /sourceLabel:\s*"Sample value estimate"/);
  assert.match(vehicleServiceSource, /confidenceLabel:\s*"Demo data — not live market data\."/);
  assert.match(vehicleServiceSource, /valuationSource:\s*"sample_demo"/);
  assert.match(vehicleServiceSource, /sourceLabel:\s*"Sample listings"/);
  assert.match(vehicleServiceSource, /isSampleListing:\s*true/);
  assert.match(vehicleServiceSource, /backendLookupRequired:\s*false/);

  assert.match(detailSource, /Sample value estimate/);
  assert.match(detailSource, /Sample listings/);
  assert.match(detailSource, /Demo data — not live market data\./);
  assert.match(detailSource, /SAMPLE_VEHICLE_LIVE_REFRESH_BLOCKED/);
  assert.match(detailSource, /const canRequestLiveValue = !isSampleDetail/);
  assert.match(detailSource, /actionLabel=\{isSampleDetail \? null : "Load live market value"\}/);
});

test("sample vehicle For Sale tab renders demo listings as an enabled local experience", () => {
  assert.match(detailSource, /tab === "For Sale" \? \(\s*isSampleDetail \?/s);
  assert.match(detailSource, /These static showcase listings let you explore the For Sale experience/);
  assert.match(detailSource, /provider calls, or unlocks/);
  assert.match(detailSource, /vehicle\.listings\.map\(\(listing, index\) => \(/);
  assert.match(detailSource, /<ListingCard key=\{listing\.id\} listing=\{listing\} isBest=\{index === 0\} \/>/);
  assert.doesNotMatch(detailSource, /isSampleDetail[\s\S]{0,900}Load live listings/);

  const sampleForSaleIndex = detailSource.indexOf('tab === "For Sale" ? (');
  const lockedPreviewIndex = detailSource.indexOf("Nearby listings preview", sampleForSaleIndex);
  assert.ok(sampleForSaleIndex > -1 && lockedPreviewIndex > -1 && sampleForSaleIndex < lockedPreviewIndex);
  assert.match(listingCardSource, /listing\.sourceLabel/);
  assert.match(listingCardSource, /demo data, not live market data/);
});

test("all shipped sample vehicles have explicit demo listings", () => {
  assert.match(sampleSource, /id:\s*"2022-tesla-model-3-long-range"[\s\S]*demoListings:\s*\[[\s\S]*sample-listing-model3-1/);
  assert.match(sampleSource, /id:\s*"2019-ford-mustang-gt"[\s\S]*demoListings:\s*\[[\s\S]*sample-listing-mustang-1/);
  assert.match(sampleSource, /id:\s*"2023-harley-davidson-street-glide-special"[\s\S]*demoListings:\s*\[[\s\S]*sample-listing-street-glide-1/);
});

test("sample listings have safe fallback and render diagnostics", () => {
  assert.match(vehicleServiceSource, /function getSampleDemoListingSeeds/);
  assert.match(vehicleServiceSource, /SAMPLE_LISTINGS_RENDER_FALLBACK_USED/);
  assert.match(vehicleServiceSource, /missing_explicit_demo_listings/);
  assert.match(vehicleServiceSource, /formatSampleListingPrice/);
  assert.match(vehicleServiceSource, /formatSampleListingMileage/);
  assert.match(vehicleServiceSource, /formatSampleListingDistance/);

  assert.match(detailSource, /SAMPLE_LISTINGS_RENDER_START/);
  assert.match(detailSource, /SAMPLE_LISTINGS_RENDER_FALLBACK_USED/);
  assert.match(detailSource, /SAMPLE_LISTINGS_RENDER_ERROR/);
  assert.match(detailSource, /Sample listings unavailable/);
  assert.match(detailSource, /Demo data only — no live provider was called/);
});

test("listing cards tolerate missing sample listing fields", () => {
  assert.match(listingCardSource, /safeListingText\(listing\.title, "Sample vehicle listing"\)/);
  assert.match(listingCardSource, /safeListingText\(listing\.mileage, "Mileage unavailable"\)/);
  assert.match(listingCardSource, /safeListingText\(listing\.distance, "Distance unavailable"\)/);
  assert.match(listingCardSource, /safeListingText\(listing\.dealer, listing\.isSampleListing \? "Sample seller" : "Seller unavailable"\)/);
  assert.match(listingCardSource, /safeListingText\(listing\.location, "Location unavailable"\)/);
  assert.match(listingCardSource, /SILHOUETTE_IMAGES\.neutral_vehicle/);
});

test("sample For Sale keeps back navigation outside the listings branch", () => {
  const backButtonIndex = detailSource.indexOf("<BackButton fallbackHref=");
  const forSaleIndex = detailSource.indexOf('tab === "For Sale" ? (');
  assert.ok(backButtonIndex > -1 && forSaleIndex > -1 && backButtonIndex < forSaleIndex);
  assert.match(detailSource, /Back navigation and the rest of the sample vehicle tabs remain available/);
});
