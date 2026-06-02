import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const screenPath = path.join(process.cwd(), "app/vehicle/[id].tsx");
const cardPath = path.join(process.cwd(), "components/ValueEstimateCard.tsx");
const vehicleServicePath = path.join(process.cwd(), "services/vehicleService.ts");
const canonicalSpecCompletionPath = path.join(process.cwd(), "lib/canonicalSpecCompletion.ts");
const offlineCanonicalServicePath = path.join(process.cwd(), "services/offlineCanonicalService.ts");
const marketCheckProviderPath = path.join(process.cwd(), "backend/src/providers/marketcheck/marketCheckVehicleDataProvider.ts");

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
  const serviceSource = fs.readFileSync(vehicleServicePath, "utf8");

  assert.match(screenSource, /\.getListings\([\s\S]*fetchReason:\s*"user_requested_listings_refresh"/);
  assert.match(screenSource, /const MAX_VISIBLE_LIVE_LISTINGS = 12;/);
  assert.match(screenSource, /const INITIAL_VISIBLE_LIVE_LISTINGS = 6;/);
  assert.match(screenSource, /const priceListings = listings\.filter/);
  assert.match(screenSource, /badgeCount: displayListings\.length/);
  assert.match(screenSource, /rendererCount: visibleListings\.length/);
  assert.match(screenSource, /displayListings\.slice\(0, INITIAL_VISIBLE_LIVE_LISTINGS\)/);
  assert.match(screenSource, /Show More Listings/);
  assert.match(screenSource, /Listings UI v935c1bc/);
  assert.match(screenSource, /setShowAllListings\(\(current\) => !current\)/);
  assert.match(screenSource, /staleListingsClearedBeforeRequest: vehicle\.listings\.length/);
  assert.match(screenSource, /setVehicle\(\(current\) => \(current \? \{ \.\.\.current, listings: \[\] \} : current\)\)/);
  assert.match(screenSource, /pendingListingsRequestKeyRef/);
  assert.match(screenSource, /LISTINGS_DUPLICATE_REQUEST_BLOCKED/);
  assert.match(screenSource, /Linking\.openURL\(listingUrl\)/);
  assert.match(screenSource, /getOpenableListingUrl/);
  assert.match(serviceSource, /listingUrl: listing\.listingUrl \?\? listing\.url \?\? listing\.vdpUrl \?\? listing\.redirectUrl \?\? listing\.detailUrl \?\? null/);
  assert.match(screenSource, /buildListingsHydratedValuation/);
  assert.match(screenSource, /shouldReplaceValueFromListings/);
  assert.match(screenSource, /isModeledFallbackValuation/);
  assert.match(screenSource, /VALUE_COMP_SOURCE/);
  assert.match(screenSource, /VALUE_COMP_DERIVATION_STARTED/);
  assert.match(screenSource, /VALUE_COMP_DERIVATION_RESULT/);
  assert.match(screenSource, /VALUE_QUERY_INVALIDATED_FROM_LISTINGS/);
  assert.match(screenSource, /VALUE_REFRESH_TRIGGERED_FROM_LISTINGS/);
  assert.match(screenSource, /VALUE_UI_STATE_REPLACED_AFTER_LISTINGS/);
  assert.match(screenSource, /VALUE_STALE_MODELED_FALLBACK_REPLACED/);
  assert.match(screenSource, /acceptedListingsAvailable: true/);
  assert.match(screenSource, /listingCacheKeysChecked: \["shared_vehicle_listings"\]/);
  assert.match(screenSource, /strategy: "shared_listing_comps"/);
  assert.match(screenSource, /providerCall: false/);
});

test("explicit live listings can collect broader comps without flooding the UI", () => {
  const backendServiceSource = fs.readFileSync(path.join(process.cwd(), "backend/src/services/vehicleService.ts"), "utf8");
  const marketCheckSource = fs.readFileSync(marketCheckProviderPath, "utf8");

  assert.match(marketCheckSource, /const MARKETCHECK_LISTINGS_ROWS = 20;/);
  assert.match(marketCheckSource, /const MARKETCHECK_VALUE_ROWS = 20;/);
  assert.match(backendServiceSource, /const MIN_BELIEVABLE_LIVE_LISTINGS = 5;/);
  assert.match(backendServiceSource, /const MAX_LIVE_LISTING_ATTEMPTS = 2;/);
  assert.match(backendServiceSource, /const MAX_DISPLAY_LIVE_LISTINGS = 12;/);
  assert.match(backendServiceSource, /effectiveForceLiveListings/);
  assert.match(backendServiceSource, /configuredMaxLiveListingAttempts/);
  assert.match(marketCheckSource, /attemptNumber: input\.requestMeta\?\.attemptNumber/);
  assert.match(backendServiceSource, /"adjacent-year-previous"[\s\S]*"adjacent-year-next"[\s\S]*"wider-radius-250"/);
  assert.match(backendServiceSource, /acceptedLiveListings\.length >= MIN_BELIEVABLE_LIVE_LISTINGS/);
});

test("believable listings replace stale modeled fallback without tab navigation", () => {
  const screenSource = fs.readFileSync(screenPath, "utf8");

  assert.match(screenSource, /function shouldReplaceValueFromListings/);
  assert.match(screenSource, /isModeledFallbackValuation\(result\)/);
  assert.match(screenSource, /result\.valuationSource === "listing_comps" \|\| result\.modelType === "listing_derived"/);
  assert.match(screenSource, /believableListings\.length > 0 && normalizedMileage && normalizedCondition/);
  assert.match(screenSource, /shouldReplaceStaleValue = shouldReplaceValueFromListings\(displayValuation\)/);
  assert.match(screenSource, /derivedValue && shouldReplaceStaleValue/);
  assert.match(screenSource, /applyValuationUpdate\(derivedValue, "listings-cache-sync", \{\s*allowReplacement: true/s);
  assert.match(screenSource, /setVehicle\(\(current\) => \(current \? \{ \.\.\.current, valuation: derivedValue \} : current\)\)/);
  assert.doesNotMatch(screenSource, /VALUE_REFRESH_TRIGGERED_FROM_LISTINGS[\s\S]*\.getValue\(/);
});

test("vehicle detail tabs keep shared vertical spacing around cards and bottom actions", () => {
  const screenSource = fs.readFileSync(screenPath, "utf8");

  assert.match(screenSource, /<Animated\.View style=\{\[styles\.contentStack,/);
  assert.match(screenSource, /contentStack:\s*\{\s*gap:\s*18\s*\}/);
  assert.match(screenSource, /bottomActionStack:\s*\{[^}]*marginTop:\s*6[^}]*paddingTop:\s*10/);
});

test("modeled fallback value maps through the frontend as limited value, not unavailable copy", () => {
  const serviceSource = fs.readFileSync(vehicleServicePath, "utf8");
  const screenSource = fs.readFileSync(screenPath, "utf8");

  assert.match(serviceSource, /valuationSource\?: "provider" \| "cache" \| "listing_comps" \| "modeled_fallback" \| "sample_demo" \| "unavailable" \| null;/);
  assert.match(serviceSource, /valuationSource: valuation\.valuationSource \?\? "provider"/);
  assert.match(serviceSource, /VALUE_RESPONSE_MAPPED/);
  assert.match(serviceSource, /valuationSource: mapped\.valuationSource \?\? null/);
  assert.match(screenSource, /valuationSource: displayValuation\.valuationSource \?\? null/);
  assert.match(screenSource, /unavailableReason: displayValuation\.unavailableReason \?\? displayValuation\.reason \?\? null/);
  assert.match(screenSource, /VALUE_REFRESH_BUTTON_TAPPED/);
  assert.match(screenSource, /VALUE_REFRESH_REQUEST_PAYLOAD/);
  assert.match(screenSource, /VALUE_REFRESH_RESPONSE_RECEIVED/);
  assert.match(serviceSource, /VALUE_REQUEST_STARTED/);
  assert.match(serviceSource, /VALUE_REQUEST_PAYLOAD/);
  assert.match(serviceSource, /VALUE_REQUEST_FAILED/);
  assert.match(serviceSource, /VALUE_REQUEST_RESPONSE/);
  assert.match(screenSource, /VALUE_RENDER_STATE/);
  assert.match(screenSource, /buildDetailLookupDescriptor\(vehicle\)/);
  assert.match(screenSource, /bodyStyle: normalizedIdentity\.bodyStyle \?\? normalizeDetailLookupBodyStyle\(vehicle\)/);
  assert.match(screenSource, /Pickup Truck/);
});

test("no safe baseline unavailable copy is distinct from no live comps", () => {
  const screenSource = fs.readFileSync(screenPath, "utf8");
  const serviceSource = fs.readFileSync(vehicleServicePath, "utf8");

  assert.match(serviceSource, /unavailableReason: valuation\.unavailableReason \?\? valuation\.reason \?\? null/);
  assert.match(screenSource, /No safe baseline data available/);
  assert.match(screenSource, /unavailableReason === "no_safe_baseline_data"/);
  assert.match(screenSource, /missing_required_vehicle_identity/);
  assert.match(screenSource, /missing_zip_or_mileage/);
});

test("vehicle detail title and specs do not leak family ranges or provider CTAs", () => {
  const screenSource = fs.readFileSync(screenPath, "utf8");
  const completionSource = fs.readFileSync(canonicalSpecCompletionPath, "utf8");
  const offlineSource = fs.readFileSync(offlineCanonicalServicePath, "utf8");
  const marketCheckSource = fs.readFileSync(marketCheckProviderPath, "utf8");

  assert.match(screenSource, /buildProductionDisplayTitle/);
  assert.match(screenSource, /isOverbroadYearRangeLabel/);
  assert.match(screenSource, /formatCanonicalModelName/);
  assert.match(completionSource, /"toyota\|4runner", "4Runner"/);
  assert.match(completionSource, /horsepower:\s*270/);
  assert.match(completionSource, /horsepower:\s*236/);
  assert.match(screenSource, /sanitizeSpecValue/);
  assert.match(offlineSource, /completeCanonicalSpecs/);
  assert.doesNotMatch(screenSource, /Performance Intelligence Summary/);
  assert.doesNotMatch(screenSource, /See live listing/);
  assert.doesNotMatch(marketCheckSource, /torque:\s*"See live listing"/);
  assert.doesNotMatch(marketCheckSource, /mpgOrRange:\s*"See live listing"/);
});
