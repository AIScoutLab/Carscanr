# CarScanr Handoff For ChatGPT

Update this file after meaningful product, auth, scan, environment, deployment, or TestFlight changes so the next session starts from the current truth.

## Project Summary

CarScanr contains two coordinated codebases in one repo:

- Expo + React Native mobile app at the repo root
- Node.js + TypeScript + Express backend in `backend/`

Product goal:

- User scans or uploads a photo of a car or motorcycle
- AI identifies the likely vehicle
- App shows a useful result immediately
- Full specs/value/listings/Garage are layered on top of that core flow
- Product direction is now explicitly guest-first for scanning
- Monetization truth now being enforced in app state:
  - scans are unlimited
  - free users get 5 free Pro unlocks
  - only premium detail access should lock after free unlocks are exhausted

## Current State Snapshot

### Mobile / Expo

- The app uses dynamic Expo config through [app.config.ts](/Users/mattbrillman/Car_Identifier/app.config.ts)
- EAS is linked to Expo project `@eus090474/carscanr`
- Active EAS project ID: `6e7cd5a8-7f65-44ce-88a8-3d1a3f589cc6`
- Expo Updates is configured manually for bare workflow
- `runtimeVersion` has been manually pinned and bumped during debugging to avoid stale OTA bundles overriding fresh TestFlight builds
- App scheme is `carscanr`
- Current icon source is [icon-1024.png](/Users/mattbrillman/Car_Identifier/icon-1024.png)

### Backend / Render

- Backend env parsing and startup guardrails are hardened in [backend/src/config/env.ts](/Users/mattbrillman/Car_Identifier/backend/src/config/env.ts)
- `/health` is used as a lightweight wake/check endpoint before heavy scan requests
- Hosted backend now has much more explicit scan-stage logging
- Guest scan support is implemented in backend code, but always verify the live Render deploy is on the newest backend before trusting behavior
- Standard scan is now being refactored onto a canonical vehicle catalog flow instead of depending on the tiny `vehicles` table

### Live Product State

- Standard scan flow now works end-to-end far enough to:
  - wake backend
  - call live vision provider
  - receive AI vision output
- Cache/schema failures are no longer supposed to block standard multipart scans
- Matching no longer hard-fails on `NO_VEHICLE_MATCH`; backend now returns a best-effort AI fallback candidate when catalog matching misses
- Canonical vehicle records are now the intended source of truth for scan-derived matches, specs, value/listings fetches, Garage resolution, and unlock resolution
- New active frontend issue: [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx) had a non-interactive result screen on device; result-screen touch handling has been hardened but still needs a fresh build/device validation

## Most Recent High-Signal Changes

### Guest-first scanning

Guest scan is now the intended product flow:

- Standard scan should work without sign-in
- Standard scan should not be blocked by scan-count limits at all
- Sign-in is still required for:
  - Garage save/list/delete
  - synced history
  - restore across devices
  - subscription/account management
  - premium unlock/account endpoints

Key files:

- [backend/src/middleware/auth.ts](/Users/mattbrillman/Car_Identifier/backend/src/middleware/auth.ts)
- [backend/src/routes/index.ts](/Users/mattbrillman/Car_Identifier/backend/src/routes/index.ts)
- [backend/src/controllers/scanController.ts](/Users/mattbrillman/Car_Identifier/backend/src/controllers/scanController.ts)
- [backend/src/controllers/usageController.ts](/Users/mattbrillman/Car_Identifier/backend/src/controllers/usageController.ts)
- [services/guestSessionService.ts](/Users/mattbrillman/Car_Identifier/services/guestSessionService.ts)
- [services/scanService.ts](/Users/mattbrillman/Car_Identifier/services/scanService.ts)

### Monetization / entitlement consistency

Current product truth:

- scanning is always allowed
- free users get 5 free Pro unlocks
- scanning alone must not consume free unlocks
- basic scan result identification remains visible without Pro
- only locked premium sections should depend on unlocks or Pro

Recent app-side fixes:

- [app/(tabs)/scan.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/scan.tsx)
  - removed hard free-scan blocking logic
  - upsell logic now keys off remaining free unlocks instead of scan counts
- [app/scan/camera.tsx](/Users/mattbrillman/Car_Identifier/app/scan/camera.tsx)
  - removed hard free-scan blocking logic
- [app/paywall.tsx](/Users/mattbrillman/Car_Identifier/app/paywall.tsx)
  - now shows unlock-based meter instead of scan-based meter
- [app/(tabs)/garage.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/garage.tsx)
  - now shows unlock-based meter instead of scan-based meter
- [app/(tabs)/profile.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/profile.tsx)
  - now shows explicit free unlock usage / remaining counts
- [components/PaywallCard.tsx](/Users/mattbrillman/Car_Identifier/components/PaywallCard.tsx)
  - now says free Pro unlocks left, not free scans left
- [constants/seedData.ts](/Users/mattbrillman/Car_Identifier/constants/seedData.ts)
  - default free status no longer implies a hard 5-scan cap
- [services/subscriptionService.ts](/Users/mattbrillman/Car_Identifier/services/subscriptionService.ts)
  - purchase/restore placeholder flow no longer throws sign-in-required immediately
  - debug logs added:
    - `PURCHASE_FLOW_START`
    - `PURCHASE_PRODUCTS_LOAD_START`
    - `PURCHASE_PRODUCTS_LOAD_SUCCESS`
    - `PURCHASE_PRODUCTS_LOAD_FAILURE`
    - `PURCHASE_FLOW_FAILURE`
    - `RESTORE_PURCHASES_START`
    - `RESTORE_PURCHASES_SUCCESS`
    - `RESTORE_PURCHASES_FAILURE`

Important diagnosis:

- counter mismatch was partly a UI truth mismatch, not only data:
  - scan/result/detail screens were using unlock counts from subscription context
  - paywall/garage/profile still showed old scan-count language or scan-based meter defaults
- purchase flow “Preparing purchase flow” issue was caused by placeholder purchase logic that still required auth and then surfaced sign-in/restore-style messaging even though real StoreKit purchase wiring is not implemented yet

### Paywall truthfulness / cleanup

Current truth:

- real in-app purchase is still not wired in this repo
- paywall should not pretend a real free trial or StoreKit purchase can start

Recent fixes:

- [app/paywall.tsx](/Users/mattbrillman/Car_Identifier/app/paywall.tsx)
  - cleaned up duplicated stacked paywall feel into:
    - one hero section
    - one detail section
    - one primary CTA
  - primary CTA is now disabled when `purchaseAvailable` is false
  - no more fake loading flash for a purchase path that cannot actually proceed
  - logs:
    - `PAYWALL_CTA_TAPPED`
- [components/PaywallCard.tsx](/Users/mattbrillman/Car_Identifier/components/PaywallCard.tsx)
  - no longer renders as a tappable dead surface
  - hero copy now says scans stay free and Pro unlocks premium details
- [services/subscriptionService.ts](/Users/mattbrillman/Car_Identifier/services/subscriptionService.ts)
  - current placeholder purchase flow is now explicit / honest
  - logs:
    - `PURCHASE_FLOW_START`
    - `PURCHASE_PRODUCTS_LOAD_START`
    - `PURCHASE_PRODUCTS_LOAD_SUCCESS`
    - `PURCHASE_PRODUCTS_LOAD_FAILURE`
    - `PURCHASE_ATTEMPT_START`
    - `PURCHASE_ATTEMPT_SUCCESS`
    - `PURCHASE_ATTEMPT_FAILURE`
    - `PURCHASE_FLOW_FAILURE`
    - `RESTORE_PURCHASES_START`
    - `RESTORE_PURCHASES_SUCCESS`
    - `RESTORE_PURCHASES_FAILURE`

Important diagnosis:

- top Pro card previously looked tappable because [components/PaywallCard.tsx](/Users/mattbrillman/Car_Identifier/components/PaywallCard.tsx) always rendered as a touchable, even when no action was attached
- bottom CTA flashed because placeholder purchase logic briefly entered a fake async path, then returned `not_configured` with no real purchase destination

### Dedicated in-app camera flow

`Scan Vehicle` no longer depends on `launchCameraAsync`.

Current camera flow:

- Scan tab routes to [app/scan/camera.tsx](/Users/mattbrillman/Car_Identifier/app/scan/camera.tsx)
- Camera screen uses `expo-camera`
- Photo library still uses `expo-image-picker`
- Captured/selected images are resized/compressed before upload
- UI shows visible scan stage text during the flow
- Camera screen now supports pinch-to-zoom in [app/scan/camera.tsx](/Users/mattbrillman/Car_Identifier/app/scan/camera.tsx)
  - logs:
    - `CAMERA_ZOOM_START`
    - `CAMERA_ZOOM_CHANGE`
    - `CAMERA_ZOOM_END`
    - `CAMERA_CAPTURE_WITH_ZOOM`
    - `CAMERA_ZOOM_CLAMPED`
    - `CAMERA_ZOOM_APPLIED`
    - `CAMERA_CAPTURE_FOCUS_STATE`
  - current implementation uses `CameraView.zoom`
  - this is digital zoom, not explicit multi-lens switching
  - zoom has been tuned to be more conservative:
    - lower max zoom
    - threshold before pinch movement changes zoom
    - gentler non-linear zoom curve so early zoom stays cleaner
  - autofocus is explicitly kept on for capture
- Photo-library flow had a real app-side bug on device:
  - repeated `/api/usage/today` fetches could flood before identify ever started
  - the strongest cause was unstable `refreshStatus` callbacks inside [features/subscription/SubscriptionProvider.tsx](/Users/mattbrillman/Car_Identifier/features/subscription/SubscriptionProvider.tsx), combined with scan-tab `useFocusEffect`
  - fix applied:
    - subscription actions are now `useCallback`-stable
    - scan-tab focus refresh is throttled
    - [services/scanService.ts](/Users/mattbrillman/Car_Identifier/services/scanService.ts) now dedupes in-flight `getUsage()` requests
    - client logs added:
      - `PHOTO_PICK_START`
      - `PHOTO_PICK_SUCCESS`
      - `USAGE_FETCH_START`
      - `USAGE_FETCH_SUCCESS`
      - `USAGE_FETCH_FAILURE`
      - `IDENTIFY_REQUEST_START`
      - `IDENTIFY_REQUEST_SUCCESS`
      - `IDENTIFY_REQUEST_FAILURE`
  - important nuance:
    - the scan spinner is tied to `isBusy` in [app/(tabs)/scan.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/scan.tsx), not directly to subscription `isLoading`
    - the dead/spinning behavior was likely caused by the usage refresh loop starving the photo-library flow before identify started, while `isBusy` remained true from scan start
- Product rule correction applied:
  - unlimited basic scans are now the intended rule
  - the 5-count is for premium unlocks only
  - root cause of the lingering `Free scan limit reached` failure:
    - [backend/src/services/usageService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/usageService.ts) still threw `SCAN_LIMIT_REACHED` inside `assertScanAllowed(...)`
    - that old backend gate was still hit by the normal camera identify path even when the UI correctly showed unlock-based messaging
  - fix applied:
    - normal identify no longer blocks after 5 lifetime scans
    - only abuse-rate protection remains in `assertScanAllowed(...)`

### Identification stability / badge-text dominance

The scan matcher now leans much harder on readable badge and model text:

- [backend/src/providers/openai/openAIVisionProvider.ts](/Users/mattbrillman/Car_Identifier/backend/src/providers/openai/openAIVisionProvider.ts)
  - vision prompt now explicitly extracts:
    - `visible_badge_text`
    - `visible_make_text`
    - `visible_model_text`
    - `visible_trim_text`
    - `emblem_logo_clues`
  - prompt instructs the model to anchor on readable badging before body-shape guessing
- [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts)
  - logs:
    - `VISIBLE_TEXT_EVIDENCE`
    - `BADGE_HARD_FILTER_APPLIED`
    - `CANDIDATE_REMOVED_CONTRADICTS_TEXT`
    - `BADGE_FILTER_FALLBACK_TRIGGERED`
    - `BADGE_MATCH_BOOST_APPLIED`
    - `IDENTIFY_RESULT_STABILITY_DECISION`
    - `SCAN_STABILITY_CACHE_HIT`
    - `SCAN_STABILITY_CACHE_WRITE`
    - `CANONICAL_PROMOTED_FROM_PROVIDER`
  - matching behavior:
    - visible make/model text is now used as a hard candidate filter before ranking when confidence is strong enough
    - conflicting candidates are removed instead of merely penalized
    - model-family normalization now helps compare text like `M3 Competition` vs `M3`
  - stability behavior:
    - recent results are cached in-process by `visualHash`
    - exact or prefix visual-hash matches can reuse a previous high-confidence normalized result and resolved vehicle selection
    - this is intended to reduce repeated-scan drift without adding a heavy OCR or database dependency

### Scan camera zoom clarity hint

- [app/scan/camera.tsx](/Users/mattbrillman/Car_Identifier/app/scan/camera.tsx)
  - still uses conservative digital pinch zoom
  - now shows a subtle inline hint when zoom gets high enough to risk softness:
    - `Zoom may reduce clarity`
  - log added:
    - `CAMERA_ZOOM_WARNING_SHOWN`

### Canonical auto-learning / popularity tracking

CarScanr now has a lightweight self-learning path for popular vehicles:

- new migration:
  - [backend/supabase/migrations/012_vehicle_scan_popularity.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/012_vehicle_scan_popularity.sql)
  - creates `public.vehicle_scan_popularity`
- new repository support:
  - [backend/src/repositories/interfaces.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/interfaces.ts)
  - [backend/src/repositories/supabaseRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/supabaseRepositories.ts)
  - [backend/src/repositories/mockRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/mockRepositories.ts)
  - [backend/src/lib/repositoryRegistry.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/repositoryRegistry.ts)
- scan behavior in [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts):
  - every successful identify increments a popularity row keyed by normalized year/make/model/trim
  - logs:
    - `VEHICLE_POPULARITY_INCREMENTED`
    - `CANONICAL_AUTO_PROMOTED`
    - `CANONICAL_PROMOTION_SKIPPED_LOW_CONFIDENCE`
    - `CANONICAL_PROMOTION_CONFLICT_DETECTED`
    - `POPULARITY_RANKING_BOOST_APPLIED`
    - `CANONICAL_BACKGROUND_ENRICH_QUEUED`
  - auto-promotion threshold is currently `5`
  - if the result is already canonical-backed, it still increments popularity but does not need auto-promotion
  - if the result is AI-only and confidence is at least `0.85`, repeated agreement can promote a lightweight `ai_learned` canonical record
  - if conflicting popularity rows exist for the same year/make with a different model family, promotion is delayed
- canonical helper:
  - [backend/src/lib/canonicalVehicleCatalog.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/canonicalVehicleCatalog.ts)
  - now supports creating a lightweight promoted canonical record from AI-learned results using synthetic baseline specs so future scans can reuse it immediately

Important current flow truth:

1. canonical exact/ranked lookup still happens before provider
2. provider enrichment still only runs for the primary candidate
3. successful provider enrich still upserts canonical immediately
4. popularity learning is additive and should not slow the live user-facing identify path materially

### Global trending / proactive canonical pre-seeding

CarScanr now has a proactive trend layer in addition to per-scan learning:

- new migration:
  - [backend/supabase/migrations/013_vehicle_global_trending.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/013_vehicle_global_trending.sql)
  - creates `public.vehicle_global_trending`
- new background service:
  - [backend/src/services/trendingVehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/trendingVehicleService.ts)
  - scheduler starts from [backend/src/server.ts](/Users/mattbrillman/Car_Identifier/backend/src/server.ts)
- schedule:
  - every `15` minutes
- current trend formula:
  - `trend_score = (recent_scan_count * 2) + global_scan_count + priority_boost`
  - current `recent_scan_count` is a recency heuristic based on `last_seen_at`:
    - seen within 24h: full scan count
    - seen within 72h: half scan count
    - older: `0`
  - current priority boost:
    - popular brands: `+5`
    - high-volume model/category hints: `+4`
- current pre-seed threshold:
  - `20`
- preload batch:
  - top `50` trending vehicles per run
  - logs:
    - `CANONICAL_PRELOAD_BATCH_STARTED`
    - `CANONICAL_PRELOAD_BATCH_COMPLETED`
- preseed behavior:
  - if canonical already exists, skip
  - otherwise try provider candidate enrichment first:
    - `CANONICAL_PRESEEDED_FROM_TREND`
  - if provider fails, use lightweight AI-learned canonical fallback:
    - `CANONICAL_PRESEEDED_AI_FALLBACK`
  - if provider returns `429`, stop the run immediately:
    - `PRESEED_RATE_LIMIT_BACKOFF`
- matching behavior:
  - canonical still resolves before provider
  - scan ranking can now get a trend-based confidence boost:
    - `TRENDING_MATCH_BOOST_APPLIED`
  - trend data is advisory and should not override canonical-first behavior

### Offline-first canonical bundle

CarScanr now ships a small bundled offline canonical dataset for fast local hydration:

- export pipeline:
  - [backend/scripts/exportOfflineCanonical.ts](/Users/mattbrillman/Car_Identifier/backend/scripts/exportOfflineCanonical.ts)
  - npm script:
    - `npm run export:offline-canonical` in [backend/package.json](/Users/mattbrillman/Car_Identifier/backend/package.json)
  - current behavior:
    - prefers live `canonical_vehicles` when Supabase is configured
    - falls back to seed vehicle data when canonical DB is unavailable
    - writes [assets/data/offline_canonical.json](/Users/mattbrillman/Car_Identifier/assets/data/offline_canonical.json)
    - logs:
      - `OFFLINE_CANONICAL_EXPORT_COMPLETED`
- app loader:
  - [services/offlineCanonicalService.ts](/Users/mattbrillman/Car_Identifier/services/offlineCanonicalService.ts)
  - startup preload from [app/_layout.tsx](/Users/mattbrillman/Car_Identifier/app/_layout.tsx)
  - logs:
    - `OFFLINE_CANONICAL_LOADED`
    - `OFFLINE_DATASET_UPDATE_AVAILABLE`
    - `OFFLINE_DATASET_UPDATED`
  - current dataset is bundled + AsyncStorage-synced, with version field `offline_canonical_version`
- current bundled dataset:
  - [assets/data/offline_canonical.json](/Users/mattbrillman/Car_Identifier/assets/data/offline_canonical.json)
  - currently 7 vehicles
  - current size is about 6.5 KB
- current practical behavior:
  - the app does **not** yet have an on-device vision model, so brand-new photos still need backend identify to produce year/make/model/trim
  - however:
    - repeat scans of the same local image can now short-circuit to cached local scan results before backend
    - detail pages can render instantly from bundled offline canonical data before backend enhancement finishes
  - logs:
    - `OFFLINE_MATCH_HIT`
    - `OFFLINE_MATCH_MISS`
    - `OFFLINE_RESULT_RENDERED`
    - `OFFLINE_RESULT_ENHANCED`
- scan path nuance:
  - [services/scanService.ts](/Users/mattbrillman/Car_Identifier/services/scanService.ts)
  - local repeat-scan cache uses image fingerprinting to return a previously known result without network
  - once backend identify returns, the app attempts an offline canonical match and marks the result as a quick result if found
- vehicle detail path:
  - [services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/services/vehicleService.ts)
  - [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
  - loads bundled offline specs/value first when possible, then silently upgrades from backend when live data arrives

### Scan-result trust model: generation-first, conservative year display, safer estimate detail

This is the current product truth for result accuracy and trustworthiness:

- CarScanr should prefer being broadly right over precisely wrong
- family and generation/body-style are more trustworthy than exact year in most scans
- exact year should now be rare
- estimate-detail should stay useful, but must remain obviously approximate

Recent high-signal frontend work:

- [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
- [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
- [components/CandidateMatchCard.tsx](/Users/mattbrillman/Car_Identifier/components/CandidateMatchCard.tsx)
- [services/offlineCanonicalService.ts](/Users/mattbrillman/Car_Identifier/services/offlineCanonicalService.ts)
- [types/index.ts](/Users/mattbrillman/Car_Identifier/types/index.ts)

#### Result-card / candidate-card clickability

Current rule:

- if a real grounded catalog id exists:
  - result card opens normal vehicle detail
- if no grounded id exists, but make/model confidence is still strong enough:
  - result card opens estimate-detail mode through the same vehicle route
- only very weak/unusable results remain non-tappable

Important current behavior:

- main result card and `Open Full Vehicle Detail` / `Open Estimated Detail` button now share the same target resolution logic
- candidate cards follow the same rule
- `CandidateMatchCard` no longer silently depends on a real id to be tappable if an estimated-detail route is valid
- vague detail CTAs were cleaned up:
  - `Continue Browsing` / `Continue Exploring` on vehicle detail were replaced with `Scan Another Vehicle`
  - those CTAs now intentionally route back to [app/(tabs)/scan.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/scan.tsx)

#### Estimate-detail routing semantics

Estimate detail and grounded detail now have explicit separation:

- grounded detail uses the real vehicle id
- estimate detail uses an `estimate:` id prefix
- [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx) treats either:
  - `estimate=1`
  - or `id.startsWith("estimate:")`
  as estimate mode

This prevents estimate pages from being mistaken for real catalog records.

#### Estimate-detail quality / approximation safeguards

Estimate-detail is intentionally useful, but conservative.

Current top-of-screen behavior in [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx):

- estimate page gets a stronger visual distinction:
  - `Estimated vehicle detail` eyebrow
  - `Photo-based estimate` badge
  - `Approximate detail, not a verified catalog record` notice
- section titles in estimate mode are explicit:
  - `Estimated Identification`
  - `Approximate Specs`
  - `Similar Market Range`
  - `Similar Listings`

Estimate-detail can now show:

- likely year range
- estimated make/model
- possible trim only when very well supported
- approximate specs from a nearby grounded family
- similar-market value context
- similar listings

But those are now gated more aggressively.

Current fallback gates:

- `Approximate Specs`
  - allowed when:
    - match type is `id` or `exact`, or
    - `model-family-range` is strong enough
  - strong enough currently means:
    - risky families (`Wrangler`, trucks, muscle cars, classics, motorcycles):
      - exactly 1 family candidate
      - year delta <= 1 when year exists
    - non-risky families:
      - up to 2 family candidates
      - year delta <= 2 when year exists
- `Similar Market Range`
  - stricter than specs
  - allowed only when:
    - match type is `id` or `exact`, or
    - exactly 1 family candidate
    - non-risky families year delta <= 1
    - risky families exact year match
- `Similar Listings`
  - now uses its own gate instead of piggybacking loosely on market fallback
  - allowed only when:
    - match type is `id` or `exact`, or
    - exactly 1 family candidate
    - non-risky families year delta <= 1
    - risky families exact year match
  - estimate listings are capped to 2 items

Important runtime safety:

- estimate-mode live value refresh is now blocked unless `showApproximateMarket` is true
- estimate-mode listings fetch is now blocked unless `showApproximateListings` is true
- this keeps runtime behavior aligned with the UI promises

Trim leakage safeguards:

- estimate-mode trim is now much stricter
- risky families:
  - trim only appears if confidence >= `0.98`
  - and grounding is `id` or `exact`
- other families:
  - trim only appears if confidence >= `0.93`
  - and grounding is still strong
- otherwise the UI says:
  - `Not confidently supported`

#### Wrangler generation-first behavior

Wrangler remains the most explicitly guarded family.

Current generation buckets:

- `TJ` = `1997-2006`
- `JK` = `2007-2018`
- `JL` = `2018-present`

Current logic in [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx):

- Wrangler generation is resolved before exact year / trim display
- broad family grounding is checked for generation compatibility before it can help with display
- if broad Wrangler grounding conflicts with the likely generation:
  - it cannot supply the effective year range
  - it cannot supply a hard detail id
  - it cannot push the wrong trim into display

Current Wrangler display behavior:

- exact year requires very strong support
- otherwise result title prefers:
  - `Jeep Wrangler (likely JK, 2007-2018)`
  - `Jeep Wrangler (likely JL, 2018-present)`
  - `Jeep Wrangler (likely TJ, 1997-2006)`
- Wrangler trim stays conservative:
  - `Willys` needs stronger support
  - `Rubicon` needs even stronger support
  - if uncertain, trim is omitted

Current Wrangler ranking behavior:

- generation-compatible Wrangler candidates are ranked ahead of generation-conflicting ones
- a broad grounded TJ family match should no longer outrank a more plausible JK/JL candidate just because it has stronger catalog coverage

#### Exact-year tightening / generation-first year logic

The app now uses a derived year-decision layer instead of treating overall match confidence as exact-year confidence.

Current derived concepts:

- family confidence:
  - still mostly reflected by overall candidate confidence plus grounding
- generation/body-style confidence:
  - derived from family sensitivity, grounded year range shape, candidate count, and special-family rules
- year confidence:
  - derived separately from:
    - canonical agreement
    - grounding strength
    - nearby range conflict
    - generation support
- trim confidence:
  - handled separately and more conservatively

Current year display rules in [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx):

- exact year:
  - only if:
    - exact canonical agreement
    - strong grounding (`id` or `exact`)
    - strong generation support
    - no nearby year conflict
    - very high confidence
- year range:
  - preferred when family/generation grounding is stronger than exact-year evidence
  - this is now the default for many families when the photo supports the general generation more than the exact model year
- estimated year:
  - only when:
    - exact year is still plausible
    - range support is weak or absent
    - confidence is high enough
- omitted year:
  - if even estimated-year precision would be too risky

Recent tuning:

- exact-year display was relaxed slightly for clearly supported non-risky modern mainstream vehicles
- this is meant to stop obvious clean scans like a modern Corolla from falling into `(est.)` too often
- the looser path only applies when:
  - the family is not one of the risky families
  - the vehicle is modern mainstream
  - canonical agreement is strong
  - nearby year conflict is low
  - confidence is still high

Generation-sensitive families currently include:

- Wrangler
- trucks
- muscle cars
- classics

Current ranking effect:

- result ranking now prefers generation/range-safe candidates over weak exact-year-looking candidates
- a generation-correct range result can beat a wrong exact-year result

#### Consistency between result screen and detail screen

Current consistency behavior:

- result cards can carry `displayTitleLabel`
- estimate-detail route now receives `titleLabel`
- [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx) uses that safer label for estimated detail headers

This prevents a conservative result card from opening into a more overly precise detail header.

#### Production UI debug cleanup

Visible internal diagnostics are now being removed or gated behind `__DEV__`.

Current user-facing cleanup:

- [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
  - removed visible debug banners such as `RESULT SCREEN LOADED`
- [app/scan/camera.tsx](/Users/mattbrillman/Car_Identifier/app/scan/camera.tsx)
  - keeps user-visible scan status
  - auth/session/timeout/detail diagnostics are now `__DEV__` only
- [app/(tabs)/scan.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/scan.tsx)
  - keeps meaningful busy/error status
  - detailed permission/auth/timeout traces are now `__DEV__` only
- [app/auth.tsx](/Users/mattbrillman/Car_Identifier/app/auth.tsx)
  - debug banner is now `__DEV__` only
- [app/onboarding.tsx](/Users/mattbrillman/Car_Identifier/app/onboarding.tsx)
  - debug banner is now `__DEV__` only
- [app/reset-password.tsx](/Users/mattbrillman/Car_Identifier/app/reset-password.tsx)
  - diagnostics block is now `__DEV__` only
- [app/(tabs)/profile.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/profile.tsx)
  - auth/session/API debug block is now `__DEV__` only

Console logs remain for debugging, but TestFlight / production UI should no longer render those internal traces.

### TestFlight env/runtime fix

Recent production/TestFlight issue:

- users could hit:
  - `Configuration error - missing API settings`
- likely root cause:
  - app runtime validation was depending too heavily on raw `process.env.EXPO_PUBLIC_*`
  - in TestFlight / EAS production builds, those values can be less reliable at runtime than Expo `extra`

Fix applied:

- [app.config.ts](/Users/mattbrillman/Car_Identifier/app.config.ts)
  - now mirrors public runtime config into `extra.publicEnv`:
    - `apiBaseUrl`
    - `supabaseUrl`
    - `supabaseAnonKey`
    - `planOverride`
- [lib/env.ts](/Users/mattbrillman/Car_Identifier/lib/env.ts)
  - now reads runtime config from a broader release-safe chain:
    - `expo-updates` manifest `extra.publicEnv`
    - `expo-updates` manifest `extra.expoClient.extra.publicEnv`
    - `Constants.expoConfig.extra.publicEnv`
    - `Constants.manifest2.extra.publicEnv`
    - `Constants.manifest.extra.publicEnv`
    - then `process.env.EXPO_PUBLIC_*`
  - diagnostics now also report whether a value came from:
    - specific Expo runtime source(s)
    - `process-env`
    - `missing`
- [eas.json](/Users/mattbrillman/Car_Identifier/eas.json)
  - production build profile explicitly sets:
    - `"environment": "production"`
- [app/_layout.tsx](/Users/mattbrillman/Car_Identifier/app/_layout.tsx)
  - startup logs now emit clearer EXPO_PUBLIC diagnostics before showing the config error UI
- [components/ErrorBoundary.tsx](/Users/mattbrillman/Car_Identifier/components/ErrorBoundary.tsx)
  - root render crashes no longer show the misleading “missing API settings” title
  - fallback now shows a generic app error plus the actual render error message inline

Important current truth:

- app-side env reads are still all `EXPO_PUBLIC_*`
- no secrets are hardcoded
- runtime config validation remains strict, but now uses a more reliable TestFlight-safe source
- if TestFlight still fails after this build, the next screen should expose whether it is:
  - a real missing-config problem
  - or an unrelated render crash that was previously being mislabeled
    - backend usage summaries now report unlock-based access without a remaining-scan cap
  - new logs added across the active scan path:
    - `CAMERA_SCAN_GATE_CHECK`
    - `LIBRARY_SCAN_GATE_CHECK`
    - `IDENTIFY_ENTITLEMENT_DECISION`
    - `PREMIUM_UNLOCK_GATE_CHECK`
    - `SCAN_ALLOWED_BASIC_RESULT`
    - `SCAN_BLOCKED_REASON`
  - client wording cleanup:
    - scan UI copy now says `Upgrade for unlimited Pro details...`
    - onboarding copy now says free users get unlimited basic scans plus 5 Pro unlocks
  - defensive compatibility:
    - [app/scan/camera.tsx](/Users/mattbrillman/Car_Identifier/app/scan/camera.tsx)
    - [app/(tabs)/scan.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/scan.tsx)
    - still remap any stray `SCAN_LIMIT_REACHED` error into a non-product-rule message so an old backend deploy cannot mislead users

Key files:

- [app/scan/camera.tsx](/Users/mattbrillman/Car_Identifier/app/scan/camera.tsx)
- [app/(tabs)/scan.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/scan.tsx)
- [features/scan/useScanActions.ts](/Users/mattbrillman/Car_Identifier/features/scan/useScanActions.ts)
- [services/scanService.ts](/Users/mattbrillman/Car_Identifier/services/scanService.ts)
- [services/apiClient.ts](/Users/mattbrillman/Car_Identifier/services/apiClient.ts)

Timing model for identify requests:

- backend wake-up and identify fetch now use separate timeout budgets
- `/health` wake-up happens before the real `/api/scan/identify` request starts
- the identify timeout budget does not start until wake-up succeeds
- if wake-up is slow (15s+), identify timeout is extended so Render cold starts do not consume the full request budget
- visible UI progression is now:
  - `Waking backend, please wait...`
  - `Identifying vehicle...`
  - `Waiting for identification`

### Cache lookup no longer allowed to block standard scan

This was the major backend debugging area.

Current intended behavior:

- Standard multipart upload is the source of truth
- `image_cache` failures should log and degrade
- `cached_analysis` failures should log and degrade
- live provider lookup should still run when multipart image bytes are present

Key files:

- [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts)
- [backend/src/services/analysisCacheService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/analysisCacheService.ts)
- [backend/src/repositories/supabaseRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/supabaseRepositories.ts)

Important logs now present:

- `CACHE_LOOKUP_DEGRADED_TO_LIVE_VISION`
- `LIVE_VISION_REQUEST_START`
- `IDENTIFY_STAGE`
- `IDENTIFY_PIPELINE_ERROR`
- `IMAGE_CACHE_QUERY_THROW`

### Canonical vehicle catalog

The six-row `vehicles` table is not enough to support live scan matching. The backend already had a partial `canonical_vehicles` system, and it has now been promoted into the live scan path.

Current intended behavior:

- Normalize AI output into a deterministic canonical key
- Check `canonical_vehicles` first
- If canonical lookup misses, search promoted canonical vehicles broadly by normalized make/model/year
- If canonical still misses, fetch live structured vehicle details from the specs provider
- Upsert/promote a canonical vehicle record from provider data
- Return the canonical vehicle id in scan candidates
- If provider enrichment still fails, return an AI-only best-effort candidate instead of fatal `NO_VEHICLE_MATCH`

Canonical schema:

- table: `public.canonical_vehicles`
- original migration: [backend/supabase/migrations/004_canonical_vehicles.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/004_canonical_vehicles.sql)
- follow-up migration adding direct catalog columns: [backend/supabase/migrations/009_canonical_vehicle_catalog_columns.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/009_canonical_vehicle_catalog_columns.sql)
- direct fields now include:
  - `canonical_key`
  - `year`
  - `make`
  - `model`
  - `trim`
  - `body_type`
  - `vehicle_type`
  - `engine`
  - `drivetrain`
  - `transmission`
  - `fuel_type`
  - `horsepower`
  - `torque`
  - `msrp`
  - `source_provider`
  - `source_vehicle_id`
  - timestamps/popularity/promotion fields
- `specs_json` is still retained as the rich persisted structured payload

Canonical creation diagnostics now present:

- `CANONICAL_LOOKUP_START`
- `CANONICAL_LOOKUP_HIT`
- `CANONICAL_LOOKUP_MISS`
- `CANONICAL_PROVIDER_ENRICH_START`
- `CANONICAL_PROVIDER_ENRICH_SUCCESS`
- `CANONICAL_PROVIDER_ENRICH_FAILURE`
- `CANONICAL_UPSERT_START`
- `CANONICAL_UPSERT_SUCCESS`
- `CANONICAL_UPSERT_FAILURE`
- `CANONICAL_SELECTED`

Important debugging note:

- standard scan no longer silently falls back to AI-only when canonical creation misses
- if `canonical_vehicles` stays empty after scan attempts, check these logs first to see whether the failing stage is:
  - canonical lookup never reached
  - provider enrichment returned no vehicles
  - provider enrichment threw
  - canonical upsert failed against Supabase
- provider enrichment root cause for common enthusiast models like BMW M3/M4:
  - the live scan matcher was fanning out too aggressively
  - one scan could call:
    - `provider-search-candidates`
    - `provider-search-vehicles`
    - `provider-direct-specs`
    - then repeat similar attempts across alternate AI candidates
  - that could burn through MarketCheck budget and trigger `429`, after which the scan still kept trying more provider branches
- fix applied in [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts):
  - canonical lookup still runs first
  - provider enrichment is now capped per scan
  - provider enrichment now runs only for the primary normalized candidate
  - alternate candidates still get canonical lookup, but they no longer trigger provider enrichment
  - once any MarketCheck call returns `429`, the scan short-circuits remaining provider enrichment for that scan
  - alternate candidates are skipped after the first `429`
  - the active provider order is now:
    1. canonical lookup
    2. one provider search path
    3. one optional direct-specs attempt only for a strong primary candidate
    4. only then AI-only fallback
  - new logs:
    - `PROVIDER_RATE_LIMIT_SHORT_CIRCUIT`
    - `PROVIDER_ENRICH_SKIPPED_AFTER_429`
    - `PROVIDER_ENRICH_PRIMARY_ONLY`
    - `CANONICAL_CACHE_HIT`
    - `CANONICAL_CACHE_MISS`
    - `VEHICLE_MATCH_FINAL_SUMMARY`
  - `VEHICLE_MATCH_FINAL_SUMMARY` records:
    - canonical hit/miss
    - whether provider was attempted
    - whether provider was skipped
    - whether `429` occurred
    - final result type (`canonical` vs `ai_only`)
- [backend/src/providers/marketcheck/marketCheckVehicleDataProvider.ts](/Users/mattbrillman/Car_Identifier/backend/src/providers/marketcheck/marketCheckVehicleDataProvider.ts)
  - now throws a real `AppError(429, "MARKETCHECK_RATE_LIMITED", ...)` on rate limit instead of a generic `Error`, so scan-level short-circuiting can work reliably

Key files:

- [backend/src/lib/canonicalVehicleCatalog.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/canonicalVehicleCatalog.ts)
- [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts)
- [backend/src/services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/vehicleService.ts)
- [backend/src/services/garageService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/garageService.ts)
- [backend/src/services/unlockService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/unlockService.ts)
- [backend/src/repositories/interfaces.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/interfaces.ts)
- [backend/src/repositories/supabaseRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/supabaseRepositories.ts)

Important matching logs:

- `VEHICLE_MATCH_INPUT`
- `VEHICLE_MATCH_STRATEGY`
- `VEHICLE_MATCH_CANDIDATE_COUNT`
- `VEHICLE_MATCH_SELECTED`
- `VEHICLE_MATCH_FALLBACK_RESULT`
- text-evidence logs:
  - `VISIBLE_TEXT_EVIDENCE`
  - `BADGE_MATCH_BOOST_APPLIED`
  - `CANDIDATE_CONTRADICTS_VISIBLE_TEXT`
  - `IDENTIFY_RESULT_STABILITY_DECISION`
  - visible text now carries through the normalized result:
    - `visible_badge_text`
    - `visible_make_text`
    - `visible_model_text`
    - `visible_trim_text`
    - `emblem_logo_clues`
  - OpenAI vision prompt now explicitly asks for badge/model/make/trim text extraction first and tells the model to anchor on readable badge text before body-shape guessing
  - ranking now strongly boosts candidates whose make/model/trim agree with visible text and penalizes candidates that contradict readable text
  - if evidence is weak or contradictory, alternate candidate confidence is reduced instead of drifting confidently to unrelated vehicles

Important diagnosis:

- The live `vehicles` table count of 6 confirmed that static catalog coverage was the real systemic blocker
- Standard scan no longer depends on the legacy `vehicles` table in the live multipart scan path
- Legacy `vehicles` table still exists for older seeded/fallback records, but scan matching is now intended to be canonical/provider-driven

Open reality check:

- If common cars still land in AI-only mode after the canonical flow is deployed, the next likely blocker is provider enrichment/selection rather than catalog size alone

### Result screen touch fix

Most recent frontend fix was on the result page.

Symptoms:

- result page loaded
- cards/buttons appeared
- nothing felt tappable on device

Changes made:

- reduced noisy render-time logging in [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
- switched the main best-match card from `Pressable` to `TouchableOpacity`
- added explicit tap helpers and tap logs for result actions
- fallback AI-only results now show a clear explanation instead of silently doing nothing
- AI-only fallback should no longer look like a paywall issue on the result screen:
  - [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
  - if the scan result has no catalog/canonical `vehicleId`:
    - Pro lock / unlock CTA is hidden
    - no premium-preview paywall copy is shown
    - the blocking fallback popup has been removed entirely
    - user now sees a stronger inline state:
      - badge: `Estimated match`
      - body: `We identified this vehicle from the photo with high confidence, but full catalog specs are still being linked.`
      - secondary line: `This is not a purchase issue. Try another scan angle, or check again after the catalog refreshes.`
    - if confidence is at least `0.85`, result screen also renders lightweight quick facts derived from photo analysis:
      - year
      - make
      - model
      - trim if present
      - vehicle type
    - fallback logs now include:
      - `FALLBACK_RESULT_RENDERED`
      - `FALLBACK_INLINE_STATE_SHOWN`
      - `FALLBACK_QUICK_FACTS_RENDERED`
      - `FALLBACK_CARD_TAPPED`
- scanned image presentation has been softened too:
  - [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
  - [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
  - scanned/uploaded user photos now prefer `contain`-style presentation instead of aggressive crop-heavy `cover`
  - provider/generic images can still use `cover`
  - image layout logs:
    - `RESULT_IMAGE_SOURCE_SELECTED`
    - `RESULT_IMAGE_LAYOUT_SELECTED`
    - `RESULT_IMAGE_FIT_MODE`
  - vehicle detail debug-only image-source text is now hidden outside `__DEV__`
- locked preview overlay now uses `pointerEvents="none"` so it cannot steal touches

Key files:

- [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
- [components/LockedContentPreview.tsx](/Users/mattbrillman/Car_Identifier/components/LockedContentPreview.tsx)

This still needs a fresh build/device confirmation.

### Canonical detail follow-up

Vehicle detail for canonical matches now has three important product fixes in progress:

- Value lookup:
  - [backend/src/services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/vehicleService.ts) now logs:
    - `VALUE_LOOKUP_START`
    - `VALUE_LOOKUP_QUERY`
    - `VALUE_LOOKUP_SUCCESS`
    - `VALUE_LOOKUP_EMPTY`
    - `VALUE_LOOKUP_FAILURE`
  - canonical valuation lookup now retries with broader vehicle variants:
    - exact canonical fields
    - trim stripped
    - model family fallback
    - nearby year fallback
  - current value bug root cause was not just UI:
    - app was sending changed condition values correctly
    - cache keys already varied by condition
    - but the MarketCheck valuation provider was not actually applying condition to the returned price math
  - fix applied:
    - [backend/src/providers/marketcheck/marketCheckVehicleDataProvider.ts](/Users/mattbrillman/Car_Identifier/backend/src/providers/marketcheck/marketCheckVehicleDataProvider.ts) now applies condition multipliers to the live valuation anchor
    - the value model has now been upgraded from a single synthetic number to a market-style range response
    - MarketCheck fields currently used when present:
      - `price.min`
      - `price.median`
      - `price.max`
      - `price.mean`
    - backend now shapes value output with:
      - low estimate
      - midpoint / best estimate
      - high estimate
      - separate `tradeIn`, `privateParty`, and `dealerRetail` ranges
    - when provider range fields are missing, backend applies dynamic modeled spreads instead of a fixed-width spread
      - narrower for cheaper/economy vehicles
      - medium for SUVs/trucks
      - wider for luxury / performance / high-price vehicles
    - backend logs added for the valuation model:
      - `VALUE_MODEL_TYPE_SELECTED`
      - `VALUE_PROVIDER_RANGE_USED`
      - `VALUE_DYNAMIC_RANGE_APPLIED`
      - `VALUE_CONFIDENCE_COMPUTED`
      - `VALUE_SOURCE_LABEL_SELECTED`
      - `VALUE_RESPONSE_SHAPED`
    - source/confidence labeling is now intended to stay honest:
      - provider-rich response => `Based on market data`
      - modeled fallback => `Modeled estimate`
      - confidence is lowered when trim specificity or provider richness is weaker
    - client/detail logs added:
      - `VALUE_INPUT_CHANGED`
      - `VALUE_REQUEST_TRIGGERED`
      - `VALUE_REQUEST_PARAMS`
      - `VALUE_RESPONSE_RECEIVED`
      - `VALUE_RENDERED`
      - `VALUE_CONDITION_COMPARISON`
    - backend logs now include cache key and source on value lookup success/cache hit
    - app UI now renders midpoint plus visible low-high range in:
      - [components/ValueEstimateCard.tsx](/Users/mattbrillman/Car_Identifier/components/ValueEstimateCard.tsx)
      - [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
    - client shaping now carries:
      - `tradeInRange`
      - `privatePartyRange`
      - `dealerRetailRange`
      - `sourceLabel`
      - `modelType`
- Listings lookup:
  - [backend/src/services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/vehicleService.ts) now logs:
    - `LISTINGS_LOOKUP_START`
    - `LISTINGS_LOOKUP_QUERY`
    - `LISTINGS_LOOKUP_SUCCESS`
    - `LISTINGS_LOOKUP_EMPTY`
    - `LISTINGS_LOOKUP_FAILURE`
  - [backend/src/controllers/vehicleController.ts](/Users/mattbrillman/Car_Identifier/backend/src/controllers/vehicleController.ts) now also wraps `/api/vehicle/value` and `/api/vehicle/listings` in shared-logger `try/catch` so Render should log the real failure even if the crash happens before provider request logging
  - full service pipelines are now wrapped, not just the provider loop
  - `requestId` is now passed from controller into value/listings services so service-level logs can be correlated directly with the HTTP 500 request
  - guaranteed `VALUE_LOOKUP_QUERY` / `LISTINGS_LOOKUP_QUERY` logs now happen for cache-read setup as well as provider-request execution
  - repository-level cache read failures now log with:
    - `VALUE_CACHE_QUERY_FAILURE`
    - `LISTINGS_CACHE_QUERY_FAILURE`
  - live root cause identified:
    - production was missing `public.provider_vehicle_values_cache`
    - production was missing `public.provider_vehicle_listings_cache`
    - production is also likely missing `public.provider_api_usage_logs`
  - production-safe bootstrap migration added:
    - [backend/supabase/migrations/011_provider_cache_bootstrap.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/011_provider_cache_bootstrap.sql)
  - likely previous pre-query crash area was before `*_LOOKUP_QUERY`, especially cache access / descriptor generation in:
    - `getValue()` around the cache read path in [backend/src/services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/vehicleService.ts)
    - `getListings()` around the cache read path in [backend/src/services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/vehicleService.ts)
  - listings lookup now also retries broader variants:
    - exact canonical fields
    - trim stripped
    - model family fallback
    - nearby year fallback
  - canonical listings lookup now retries with the same broader vehicle variants before returning empty
- Detail image priority:
  - [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx) now passes `imageUri` and `scanId` into the vehicle detail route
  - [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx) now prefers image sources in this order:
    1. scanned/uploaded image from route param
    2. recent saved scan image by `scanId`
    3. provider/generic fallback image
  - detail screen temporarily shows visible image-source debug text

### Current product truth: trusted high-confidence results, unified unlocks, and Garage reopen

This is the current source of truth for the scan/result/detail/Garage flow.

- the premium redesign is already in place
- the current work is about trust, consistency, and unlock behavior
- high-confidence trusted results are now treated much more directly in the product

#### OCR and visible-result enforcement

Current backend truth:

- Google Vision OCR exists as a real backend layer
- OCR still runs backend-only through `@google-cloud/vision`
- credentials still use `GOOGLE_APPLICATION_CREDENTIALS`
- no Google credentials are exposed to the app

Key files:

- [backend/src/services/googleVisionOcrService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/googleVisionOcrService.ts)
- [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts)
- [backend/src/controllers/scanController.ts](/Users/mattbrillman/Car_Identifier/backend/src/controllers/scanController.ts)

Current live override behavior:

- runtime version marker:
  - `ocr-visual-fallback-enforce-v3`
- if OCR confirms structured year/make/model:
  - `normalizedResult.source = "ocr_override"`
- if OCR is unavailable but the visual result is still strong enough:
  - `normalizedResult.source = "visual_override"`
- final response now pins the visible top candidate to the same year/make/model as `normalizedResult` for those override cases
- the original bad production case:
  - `normalizedResult = 2026 Honda CR-V`
  - `candidates[0] = 2024 Honda CR-V`
  is now fixed in production

Important product takeaway:

- the visible app result is no longer allowed to be overwritten by a weaker canonical fallback after the final override step

#### Trusted high-confidence rule

Current product rule:

- if confidence is `>= 0.90`
- and the vehicle is not an extreme-risk case
- then the app treats the result as trusted for the purposes of opening useful detail after unlock

Extreme-risk cases still stay conservative:

- classics
- motorcycles
- rare exotics

This confidence-first rule now applies instead of the older “mainstream-safe families only” whitelist.

Key files:

- [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
- [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)

#### Unified unlock identity

This was the key architectural cleanup.

There is now one canonical unlock identity helper:

- [services/subscriptionService.ts](/Users/mattbrillman/Car_Identifier/services/subscriptionService.ts)
- `buildVehicleUnlockId(...)`

Current unlock identity rules:

- grounded/catalog vehicle:
  - unlock id = real `vehicleId`
- estimate-backed / visual-override vehicle:
  - unlock id = stable synthetic id
  - current format:
    - `estimate:<year>:<make>:<model>:family`

Important stability changes:

- `scanId` was removed from synthetic unlock ids
- trim is no longer used by default in synthetic unlock ids
- old stored scan-based estimate unlock ids are normalized on load into the newer stable format
- nearby-year normalization is now guarded by an explicit helper:
  - `resolveStableEstimateUnlockYear(...)`
  - it only snaps the synthetic unlock year to a nearby grounded year when:
    - make/model normalize to the same family bucket
    - grounded match type is `id` or `exact`
    - year drift is at most `1`
    - the family is not generation-sensitive
    - there is no strong generation-sensitive trim signal
- if those guardrails do not pass, the unlock id keeps the originally identified year

Current families/cases excluded from year snapping:

- motorcycles
- truck families
- Wrangler-like / explicit-generation families
- muscle/exotic generation-sensitive families
- examples currently blocked by rule:
  - Wrangler
  - F-150
  - Silverado
  - Mustang
  - Camaro
  - Charger / Challenger
  - Sierra / Ram truck families
  - 911

Current trim/generation-sensitive signals that also block snapping:

- `rubicon`
- `shelby`
- `raptor`
- `z06`
- `trx`
- `hellcat`
- `392`
- `scat pack`
- `mach 1`
- `gt500`
- `zl1`
- `ss`
- `denali`
- `platinum`
- `king ranch`

Why this matters:

- rescanning the same high-confidence estimate-backed vehicle should no longer create a fresh unlock identity just because it came from a different scan
- but nearby-year vehicles are much less likely to collapse into the same synthetic unlock id by accident

#### Unified access model

Current detail access model:

- one final derived access state:
  - `locked`
  - `unlocked`

This is now resolved in [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx) from:

- `isPro`
- or `isVehicleUnlocked(resolvedUnlockId)`

Important cleanup:

- estimate-backed detail is no longer implicitly treated as unlocked just because it is estimate mode
- result, detail, and Garage reopen now all use the same unlock identity strategy

Temporary verification logs currently present:

- `VEHICLE_UNLOCK_RESOLUTION`
- `VEHICLE_UNLOCK_PERSISTENCE`
- `VEHICLE_TAB_DATA_RESOLUTION`

These are temporary QA/debug logs for verifying the unified unlock behavior.

#### Result-screen promise and detail behavior

Current trusted high-confidence result behavior:

- CTA now says:
  - `Open Vehicle Details`
- it no longer promises pricing specifically
- this was changed because pricing/value hydration and identification confidence are not the same thing

Current trusted detail behavior:

- high-confidence trusted detail avoids old mixed-state copy like:
  - `Trusted family detail`
  - `Photo-based confidence layer`
  - pricing promises in the unlock CTA
- title/chips/header were cleaned up so the same final identified year/make/model drives the visible detail state

Important bug that was fixed:

- hero chips were previously able to show nearby grounded year/range data while the title used the final identified year
- example: title could say `2026 Honda CR-V` while a chip still showed `2020`
- trusted high-confidence chips now prefer the final identified year instead of the fallback grounded year range

#### Post-unlock data policy

Current product rule:

- once a vehicle is unlocked, the experience should feel like full access for that vehicle

What that means in code:

- no secondary lock decision per tab
- no second unlock ask for that same unlock id
- no premium overlay for that same unlock id
- no conservative “hold back useful data” rule after unlock when best-available fallback exists

Current best-available post-unlock behavior in [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx):

- if unlocked and a nearby grounded vehicle exists:
  - `strongFamilyFallback = true`
  - `strongMarketFallback = true`
  - `strongListingsFallback = true`

So after unlock:

- Specs tab:
  - exact data if available
  - otherwise best available nearby/family-safe fallback
- Value tab:
  - exact pricing if available
  - otherwise best nearby pricing/range when any fallback exists
- For Sale tab:
  - exact listings if available
  - otherwise best nearby comparables when any fallback exists
- Photos tab:
  - scan photo / route image / whatever image support exists

Only if there is truly no usable fallback at all should a concise unavailable state appear.

Guardrails that still remain:

- the vehicle still has to resolve to a nearby grounded make/model family
- family support still comes from `resolveApproximateFamilySupport(...)`
- shared spec fields still come from trusted family aggregation, not random single-record copy
- horsepower still preserves the existing exact/typical/range safeguards
- extreme-risk families still stay conservative

#### Value / For Sale final-state cleanup

Trusted unlocked Value and For Sale tabs now resolve through one final state per tab instead of multiple overlapping fallback branches.

Current derived tab states:

- Value:
  - `value_available`
  - `value_unavailable_trusted`
- For Sale:
  - `listings_available`
  - `listings_unavailable_trusted`

Current trusted unavailable copy:

- Value:
  - `Pricing data isn't available yet`
  - `We'll show nearby pricing here as soon as comparable market data is available.`
- For Sale:
  - `Comparable listings aren't available yet`
  - `We'll show nearby listings here as soon as comparable inventory is available.`

Current product intent:

- no duplicate unavailable cards
- no duplicate `Scan Another Vehicle` CTAs
- no `GROUNDING LIMIT`
- no old pre-card fallback explanation stack

#### Startup / guest flow

Current startup behavior:

- onboarding is shown only once
- returning users are not forced through auth on launch
- guest usage continues silently

Key files:

- [app/index.tsx](/Users/mattbrillman/Car_Identifier/app/index.tsx)
- [services/startupPreferences.ts](/Users/mattbrillman/Car_Identifier/services/startupPreferences.ts)
- [services/guestSessionService.ts](/Users/mattbrillman/Car_Identifier/services/guestSessionService.ts)

Current storage:

- onboarding flag:
  - `hasSeenOnboarding`
- guest id:
  - `carscanr.guest-id.v1`

#### Garage support for estimate-backed / visual-override vehicles

This is now supported on the same device.

Current storage model:

- catalog-backed Garage items:
  - existing backend Garage path remains unchanged
- estimate-backed / visual-override Garage items:
  - explicit local-first Garage storage in AsyncStorage
  - key:
    - `carscanr.localEstimateGarage.v1`

Current local estimate Garage item shape in [services/garageService.ts](/Users/mattbrillman/Car_Identifier/services/garageService.ts):

- `id`
- `vehicleId`
- `unlockId`
- `sourceType`
- `imageUrl`
- `notes`
- `favorite`
- `createdAt`
- `confidence`
- `estimateMeta`
- `vehicle`

Important identity rule:

- for estimate-backed Garage items:
  - `vehicleId` is the same stable synthetic unlock id
  - `unlockId` is also that same stable synthetic unlock id

Current save behavior:

- [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
  - grounded/catalog vehicle:
    - still uses backend Garage save
  - unlocked high-confidence estimate-backed / visual-override vehicle:
    - now uses `garageService.saveEstimate(...)`

Current reopen behavior:

- [app/(tabs)/garage.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/garage.tsx)
  - estimate-backed Garage items reopen into:
    - detail route with `estimate=1`
    - the same `unlockId`
    - saved identity/meta
    - `garageSource=1`
    - `reopenedSource=1`

Current detail behavior on reopen:

- [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
  - resolves the same unlock id
  - resolves the same unlocked access state
  - rehydrates estimate detail from saved meta + current fallback logic
  - does not depend on a backend catalog `vehicleId` to open

Current dedupe behavior:

- estimate-backed Garage saves dedupe by the same stable synthetic unlock id
- saving the same estimate-backed vehicle again replaces the prior local estimate item instead of creating duplicates

Current important limitation:

- estimate-backed Garage items are currently same-device only
- they are not synced cross-device because they are not stored in the backend Garage model yet

#### Cross-session and sign-in behavior

Current guarantees:

- guest unlocks persist on the same device
- app relaunch restores them
- estimate-backed Garage items persist on the same device
- estimate-backed Garage reopen stays unlocked on the same device

Current non-guarantees:

- guest unlocks do not automatically sync to another device
- estimate-backed Garage items do not currently sync to another device
- signing in later does not automatically migrate local estimate-backed Garage items into backend Garage storage

#### Manual search

Manual search remains the intended deterministic path when the user wants exactness.

Current behavior:

- [app/(tabs)/search.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/search.tsx)
  - trim narrowing is explicit when multiple trims exist
  - “all trims” escape hatch was removed in that state
  - exact-detail open is blocked until a trim is selected when multiple trims exist
- [services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/services/vehicleService.ts)
  - exact manual-search detail prefers exact live/provider/canonical imagery before generic fallback

Current limitation:

- still not a full structured `Year -> Make -> Model -> Trim` selector flow

#### Horsepower and spec fallback truth

Current horsepower priority:

1. exact provider/backend horsepower
2. parsed exact horsepower from real horsepower-like fields
3. exact canonical/offline horsepower
4. family-level fallback when support is strong enough
5. `Unknown`

UI labels that should remain true:

- `Horsepower`
- `Typical horsepower`
- `Horsepower varies by trim`

Safeguards that should remain true:

- never treat `0 hp` as real
- never parse displacement like `4.0L` into `4 hp`
- stay unknown rather than inventing fake precision when fallback is too weak

## Important Files

### Mobile

- [app.config.ts](/Users/mattbrillman/Car_Identifier/app.config.ts)
- [eas.json](/Users/mattbrillman/Car_Identifier/eas.json)
- [app/_layout.tsx](/Users/mattbrillman/Car_Identifier/app/_layout.tsx)
- [app/index.tsx](/Users/mattbrillman/Car_Identifier/app/index.tsx)
- [app/onboarding.tsx](/Users/mattbrillman/Car_Identifier/app/onboarding.tsx)
- [app/auth.tsx](/Users/mattbrillman/Car_Identifier/app/auth.tsx)
- [app/reset-password.tsx](/Users/mattbrillman/Car_Identifier/app/reset-password.tsx)
- [app/(tabs)/scan.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/scan.tsx)
- [app/scan/camera.tsx](/Users/mattbrillman/Car_Identifier/app/scan/camera.tsx)
- [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
- [app/(tabs)/profile.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/profile.tsx)
- [components/AppContainer.tsx](/Users/mattbrillman/Car_Identifier/components/AppContainer.tsx)
- [components/PrimaryButton.tsx](/Users/mattbrillman/Car_Identifier/components/PrimaryButton.tsx)
- [components/BackButton.tsx](/Users/mattbrillman/Car_Identifier/components/BackButton.tsx)
- [components/CandidateMatchCard.tsx](/Users/mattbrillman/Car_Identifier/components/CandidateMatchCard.tsx)
- [components/LockedContentPreview.tsx](/Users/mattbrillman/Car_Identifier/components/LockedContentPreview.tsx)
- [components/ProLockCard.tsx](/Users/mattbrillman/Car_Identifier/components/ProLockCard.tsx)
- [lib/env.ts](/Users/mattbrillman/Car_Identifier/lib/env.ts)
- [lib/supabase.ts](/Users/mattbrillman/Car_Identifier/lib/supabase.ts)
- [services/authService.ts](/Users/mattbrillman/Car_Identifier/services/authService.ts)
- [services/apiClient.ts](/Users/mattbrillman/Car_Identifier/services/apiClient.ts)
- [services/scanService.ts](/Users/mattbrillman/Car_Identifier/services/scanService.ts)
- [services/guestSessionService.ts](/Users/mattbrillman/Car_Identifier/services/guestSessionService.ts)
- [features/subscription/SubscriptionProvider.tsx](/Users/mattbrillman/Car_Identifier/features/subscription/SubscriptionProvider.tsx)

### Backend

- [backend/src/config/env.ts](/Users/mattbrillman/Car_Identifier/backend/src/config/env.ts)
- [backend/src/app.ts](/Users/mattbrillman/Car_Identifier/backend/src/app.ts)
- [backend/src/server.ts](/Users/mattbrillman/Car_Identifier/backend/src/server.ts)
- [backend/src/routes/index.ts](/Users/mattbrillman/Car_Identifier/backend/src/routes/index.ts)
- [backend/src/middleware/auth.ts](/Users/mattbrillman/Car_Identifier/backend/src/middleware/auth.ts)
- [backend/src/middleware/errorHandler.ts](/Users/mattbrillman/Car_Identifier/backend/src/middleware/errorHandler.ts)
- [backend/src/lib/repositoryRegistry.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/repositoryRegistry.ts)
- [backend/src/lib/providerRegistry.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/providerRegistry.ts)
- [backend/src/repositories/supabaseRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/supabaseRepositories.ts)
- [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts)
- [backend/src/services/usageService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/usageService.ts)
- [backend/src/services/analysisCacheService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/analysisCacheService.ts)
- [backend/supabase/migrations/008_usage_counters_compat.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/008_usage_counters_compat.sql)

## Environment Model

### Mobile required envs for preview/production

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Important:

- local [`.env`](/Users/mattbrillman/Car_Identifier/.env) is not enough for TestFlight
- EAS envs must be set for preview/production
- production/preview API base URL must be public HTTPS

### Backend required hosted envs

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `OPENAI_API_KEY`
- `MARKETCHECK_API_KEY`

Hosted guardrails now fail startup if unsafe or missing hosted values are used.

## Auth / Deep Link Status

### Mobile auth

- Supabase auth is used directly from the app
- session persistence uses AsyncStorage-backed Supabase storage
- `getSession()` is the source of truth for token/session restore

### Deep links implemented

- `carscanr://auth`
- `carscanr://reset-password`

Key files:

- [app/_layout.tsx](/Users/mattbrillman/Car_Identifier/app/_layout.tsx)
- [services/authService.ts](/Users/mattbrillman/Car_Identifier/services/authService.ts)
- [app/reset-password.tsx](/Users/mattbrillman/Car_Identifier/app/reset-password.tsx)

### Supabase-side assumptions still required

Supabase dashboard must be configured correctly for email flows:

- Site URL must not be localhost for production mobile flow
- Redirect URLs must include:
  - `carscanr://auth`
  - `carscanr://reset-password`
- email confirmation/reset settings must be enabled as intended
- SMTP should be configured for reliable real delivery

## Supabase Schema Notes

### usage_counters

Backend expects `public.usage_counters` to have:

- `id`
- `user_id`
- `date`
- `scan_count`
- `total_scans`
- `last_scan_at`
- `recent_attempt_timestamps`

Migration added for compatibility:

- [backend/supabase/migrations/008_usage_counters_compat.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/008_usage_counters_compat.sql)

### image_cache / cached_analysis

Production issues previously came from missing columns such as:

- `image_cache.updated_at`
- `cached_analysis.analysis_key`

Current backend intent is that cache schema drift should not block standard scan anymore.

## Current Open Items

- Rebuild and validate the latest result-screen touch fix on device/TestFlight
- Confirm the standard scan path on live backend now:
  - degrades through cache
  - reaches live vision
  - returns either catalog match or AI-only best-effort result
- Verify fallback AI-only results behave acceptably in the result screen UX on device
- RevenueCat / StoreKit purchase flow still is not launch-grade
- Production crash reporting / monitoring is still missing

## Useful Commands

### Mobile

```bash
npx expo run:ios
```

### Backend

```bash
cd backend
npm run dev
```

### Typechecks

```bash
npx tsc --noEmit
cd backend && npm run typecheck
```

### Backend build

```bash
cd backend && npm run build
```

### EAS build / submit

```bash
eas build -p ios
eas submit -p ios
```
