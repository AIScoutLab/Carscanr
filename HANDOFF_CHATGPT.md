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

### Dedicated in-app camera flow

`Scan Vehicle` no longer depends on `launchCameraAsync`.

Current camera flow:

- Scan tab routes to [app/scan/camera.tsx](/Users/mattbrillman/Car_Identifier/app/scan/camera.tsx)
- Camera screen uses `expo-camera`
- Photo library still uses `expo-image-picker`
- Captured/selected images are resized/compressed before upload
- UI shows visible scan stage text during the flow

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
