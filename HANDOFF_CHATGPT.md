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
  - free users get 3 free Pro unlocks
  - only premium detail access should lock after free Pro unlocks are exhausted

## Current State Snapshot

### Mobile / Expo

- The app uses dynamic Expo config through [app.config.ts](/Users/mattbrillman/Car_Identifier/app.config.ts)
- EAS is linked to Expo project `@eus090474/carscanr`
- Active EAS project ID: `6e7cd5a8-7f65-44ce-88a8-3d1a3f589cc6`
- Expo Updates is configured manually for bare workflow
- `runtimeVersion` has been manually pinned and bumped during debugging to avoid stale OTA bundles overriding fresh TestFlight builds
- App scheme is `carscanr`
- Current icon source is [icon-1024.png](/Users/mattbrillman/Car_Identifier/icon-1024.png)
- Mobile public env is now hardened in:
  - [app.config.ts](/Users/mattbrillman/Car_Identifier/app.config.ts)
  - [lib/env.ts](/Users/mattbrillman/Car_Identifier/lib/env.ts)
  - [lib/mobileEnvValidation.ts](/Users/mattbrillman/Car_Identifier/lib/mobileEnvValidation.ts)
- Preview/production builds now fail fast unless all of these are valid:
  - `EXPO_PUBLIC_API_BASE_URL`
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Preview/production API URLs must be HTTPS and must not point at:
  - `localhost`
  - `127.0.0.1`
  - `10.0.2.2`
  - private LAN IPs such as `10.x`, `192.168.x.x`, or `172.16-31.x.x`
- Production EAS config no longer enables QA debug by default
- Release-safe mobile diagnostics now log only:
  - `appEnv`
  - API host
  - Supabase host
  - whether QA debug is enabled

### Backend / Render

- Backend env parsing and startup guardrails are hardened in [backend/src/config/env.ts](/Users/mattbrillman/Car_Identifier/backend/src/config/env.ts)
- `/health` is used as a lightweight wake/check endpoint before heavy scan requests
- `/api/heartbeat` now runs a lightweight Supabase read for inactivity protection
- backend startup now triggers one best-effort Supabase heartbeat, and a daily scheduler runs it at `3:00 AM` server time
- Hosted backend now has much more explicit scan-stage logging
- Guest scan support is implemented in backend code, but always verify the live Render deploy is on the newest backend before trusting behavior
- Standard scan is now being refactored onto a canonical vehicle catalog flow instead of depending on the tiny `vehicles` table
- Hosted backend safety expectations remain:
  - `APP_ENV=preview` or `production`
  - `AUTH_DEV_BYPASS_ENABLED=false`
  - `ALLOW_MOCK_FALLBACKS=false`
  - real `SUPABASE_*` values
  - real provider keys
  - intentional `CORS_ORIGIN`

### Secret hygiene

- [`.gitignore`](/Users/mattbrillman/Car_Identifier/.gitignore) already ignores:
  - [`.env`](/Users/mattbrillman/Car_Identifier/.env)
  - [`backend/.env`](/Users/mattbrillman/Car_Identifier/backend/.env)
- Use [.env.example](/Users/mattbrillman/Car_Identifier/.env.example) and [backend/.env.example](/Users/mattbrillman/Car_Identifier/backend/.env.example) for placeholders only
- Use EAS env/dashboard values for preview/production mobile vars
- Use Render or your hosted backend dashboard for backend secrets
- If real keys were ever committed, rotate them immediately

### Live Product State

- Standard scan flow now works end-to-end far enough to:
  - wake backend
  - call live vision provider
  - receive AI vision output
- Cache/schema failures are no longer supposed to block standard multipart scans
- Matching no longer hard-fails on `NO_VEHICLE_MATCH`; backend now returns a best-effort AI fallback candidate when catalog matching misses
- Canonical vehicle records are now the intended source of truth for scan-derived matches, specs, value/listings fetches, Garage resolution, and unlock resolution
- Historical note:
  - [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx) previously had a non-interactive result-screen touch bug on device
  - that touch issue is no longer the primary active product blocker
  - keep it as a regression check during validation, not as current product truth

## Most Recent High-Signal Changes

### Specialty / exotic valuation guardrail

Generic fallback valuation is now disabled for specialty / exotic makes so the app does not show normal-car depreciation estimates for collector-market vehicles.

Protected makes:

- Ferrari
- Lamborghini
- McLaren
- Aston Martin
- Bentley
- Rolls-Royce
- Porsche
- Maserati
- Lotus
- Maybach
- Bugatti
- Pagani
- Koenigsegg

Current valuation policy:

- Scan flow and specs browsing still make `0` automatic MarketCheck calls by default
- Opening vehicle detail or specs does not auto-trigger live MarketCheck value/spec fetches
- MarketCheck live value should only happen on an explicit user-triggered value action
- For specialty/exotic vehicles:
  - do not use `estimated_depreciation`
  - do not use `estimated_family_model`
  - do not use generic MSRP/depreciation fallback pricing
  - do not accept stale exact/family cache rows if they are generic fallback valuations
  - if no trusted live/stored/derived market value exists, return:
    - `sourceLabel = Specialty market value unavailable`
    - `modelType = specialty_unavailable`
  - frontend should hide fake trade/private/retail numbers and show an explicit `Load live market value` CTA instead

Specialty explicit refresh cache rule:

- Production logs showed `2006 Ferrari F430` explicit refresh hitting:
  - `cacheKey = values:2006:ferrari:f430:family:<zip>:18400:good`
  - `modelType = estimated_depreciation`
  - `sourceLabel = Estimated from vehicle data`
- That generic family cache must be rejected for specialty vehicles
- On explicit `allowLive=true` + `fetchReason=user_requested_value_refresh` + `sourceScreen=valueScreen`:
  - bypass invalid generic cache
  - attempt one live MarketCheck value call
  - if live returns no trusted value, return `specialty_unavailable`
- explicit value refresh metadata contract:
  - frontend logs `VALUE_LIVE_REFRESH_BUTTON_PRESSED`
  - frontend request logs `VALUE_LIVE_REFRESH_REQUEST_SENT`
  - frontend sends:
    - `allowLive=true`
    - `fetchReason=user_requested_value_refresh`
    - `sourceScreen=valueScreen`
    - `action=valueRefresh`
    - `forceLive=true`
  - backend/controller logs:
    - `VALUE_API_REQUEST_RECEIVED`
    - `VALUE_LIVE_REFRESH_REQUESTED`
    - `VALUE_REFRESH_ACTION_METADATA`
  - backend/service treats the request as explicit even if `action` is missing when any of these are true:
    - `action === "valueRefresh"`
    - `fetchReason === "user_requested_value_refresh"`
    - `sourceScreen === "valueScreen" && allowLive === true`
    - `forceLive === true`
  - when `MARKETCHECK_DISABLE_EXTERNAL_CALLS=true`, specialty explicit refresh now short-circuits before any provider attempt and logs:
    - `VALUE_REFRESH_BLOCKED_DISABLE_EXTERNAL_CALLS`
- On passive value open:
  - do not call MarketCheck
  - return `specialty_unavailable`

Relevant logs:

- `SPECIALTY_GENERIC_VALUE_CACHE_REJECTED`
- `SPECIALTY_VALUE_REFRESH_BYPASSING_GENERIC_CACHE`
- `VALUE_REFRESH_LIVE_PROVIDER_ATTEMPTED`
- `SPECIALTY_VALUE_UNAVAILABLE_RETURNED`

Trusted value sources for specialty vehicles:

- `provider_range`
- `listing_derived`
- future curated specialty ranges if explicitly added later

Why this guard exists:

- Ferrari F430 and similar exotics were being valued like normal used cars when MarketCheck/live value was unavailable
- that produced obviously false low ranges and misleading generic copy
- the product now prefers `unavailable + explicit live CTA` over fabricated bargain pricing for specialty vehicles

Copy guard:

- specialty/exotic vehicles should not show generic lifestyle copy like `Practical vehicle with everyday usability.`
- specialty overview copy should instead stay in the lane of:
  - `High-performance specialty vehicle.`
  - `Exotic sports car with collector-market pricing.`
  - pricing variance by mileage, condition, options, service history, and provenance

### Result / detail pill cleanup

Low-value chip and badge cleanup has been applied across the scan result and vehicle detail experience.

What was removed or suppressed:

- [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
  - removed the generic `AI Identified` pill from the best-match header
  - kept the `Sample vehicle` pill only for curated demo/sample flows where it adds real context
  - badge-text evidence still renders in plain language:
    - `Read badge text: ...`
    - `Matched using visible badge text.`
- [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
  - removed the default `Availability` badge from approximate/unavailable helper cards
  - suppressed generic body-style-only labels when they are too broad to help:
    - examples: `SUV`, `Sedan`, `Car`, `Vehicle`
  - trim/body style rows now hide instead of rendering fallback filler like `Unavailable` or generic placeholders
- [components/VehicleCard.tsx](/Users/mattbrillman/Car_Identifier/components/VehicleCard.tsx)
  - removed the low-value `Garage vehicle` chip
  - shared card metadata now filters filler values such as:
    - `base`
    - `unknown`
    - `n/a`
    - `null`
    - `undefined`
- [components/CandidateMatchCard.tsx](/Users/mattbrillman/Car_Identifier/components/CandidateMatchCard.tsx)
  - candidate subtitle no longer shows `base` / `unknown` trim labels

Current UI rule:

- keep pills only when they communicate a meaningful user-facing fact
- do not show technical/internal status chips if the same information is already obvious from the screen structure
- do not render generic or placeholder values as trim/body-style facts

### Subscription plan schema alignment

The subscription plan model now supports both legacy and explicit billed Pro values.

Current supported plan values:

- `free`
- `pro`
- `pro_monthly`
- `pro_yearly`

Why `pro` still exists:

- the live Supabase schema historically only allowed `free` and `pro`
- some manually upgraded / admin-granted accounts already use `plan = 'pro'`
- do not remove support for `pro` yet

Which values unlock Pro entitlement:

- `pro`
- `pro_monthly`
- `pro_yearly`

Key implementation details:

- frontend helper in [lib/subscription.ts](/Users/mattbrillman/Car_Identifier/lib/subscription.ts)
  - `normalizePlan(plan)`
  - `isProPlan(plan)`
  - `planHasProEntitlement(plan)`
- backend helper in [backend/src/lib/subscription.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/subscription.ts)
  - `normalizePlan(plan)`
  - `isProPlan(plan)`
  - `planHasProEntitlement(plan)`
- app and backend logic should rely on those helpers instead of duplicating string checks

Migration added:

- [backend/supabase/migrations/025_subscription_plan_values.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/025_subscription_plan_values.sql)

What that migration does:

- drops the old `subscriptions_plan_check`
- recreates it to allow:
  - `free`
  - `pro`
  - `pro_monthly`
  - `pro_yearly`

Important product consequence:

- monthly and yearly products should map to:
  - `pro_monthly`
  - `pro_yearly`
- both still unlock the same Pro entitlement
- legacy/manual `pro` remains valid for entitlement and UI recognition

### OCR text dominance + focus crop for scan accuracy

Recent scan accuracy work now treats readable badge/model text as a first-class identity constraint instead of a weak clue.

Key product motivation:

- A real rear photo of a Cadillac Lyriq with visible `LYRIQ 600` badging was incorrectly identified as a `2023 Cadillac Escalade`
- The fix is meant to stop silhouette/popularity bias from overriding strong readable text

Current backend behavior:

- OpenAI vision extraction now returns structured `visible_text_evidence`
  - `raw_text`
  - `make_text`
  - `model_text`
  - `trim_text`
  - `badge_text`
  - `text_confidence`
  - `evidence_regions`
- The identify flow now creates a second AI-only image input:
  - original full image
  - heuristic center vehicle focus crop for badge/model reading
- Focus crop is for AI analysis only
  - the UI still shows the original photo
  - the original image is never permanently replaced

Hard dominance rules now implemented in [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts):

- If `visible model text` exists and `text_confidence >= 0.75`
  - candidate pool is hard-filtered to matching model family
- If `visible make text` exists and `text_confidence >= 0.75`
  - candidate pool is hard-filtered to matching make
- If `visible trim/badge text` exists
  - trim-compatible candidates are boosted
- If hard OCR filtering removes all catalog/provider candidates
  - backend must not silently fall back to an unrelated vehicle
  - it now returns an AI-only text-dominant result instead

Important safety rule:

- if readable text says `Lyriq`, do not allow fallback to `Escalade`
- if provider/canonical data lacks a Lyriq row, return a text-dominant AI-only Lyriq result instead of an unrelated Cadillac SUV

Special normalization:

- `lyriq`
- `lyriq 600`
- `lyriq 600e`
- `600` near Cadillac context

now normalize to Lyriq family with trim/badge preserved when possible.

Primary logs to inspect after the next live scan:

- `VISIBLE_TEXT_EVIDENCE_EXTRACTED`
- `OCR_MODEL_HARD_FILTER_APPLIED`
- `OCR_MAKE_HARD_FILTER_APPLIED`
- `OCR_TRIM_BOOST_APPLIED`
- `OCR_CANDIDATE_REJECTED_TEXT_CONFLICT`
- `OCR_HARD_FILTER_NO_MATCH_AI_TEXT_RESULT`
- `IDENTIFY_RESULT_TEXT_DOMINANCE_DECISION`
- `VEHICLE_FOCUS_CROP_START`
- `VEHICLE_FOCUS_CROP_CREATED`
- `VEHICLE_FOCUS_CROP_FAILED`
- `VISION_DUAL_IMAGE_REQUEST_START`
- `VISION_DUAL_IMAGE_TEXT_EVIDENCE_USED`

Files involved:

- [backend/src/providers/openai/openAIVisionProvider.ts](/Users/mattbrillman/Car_Identifier/backend/src/providers/openai/openAIVisionProvider.ts)
- [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts)
- [backend/src/lib/vehicleImageCrop.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/vehicleImageCrop.ts)
- [backend/src/controllers/scanController.ts](/Users/mattbrillman/Car_Identifier/backend/src/controllers/scanController.ts)
- [backend/src/types/domain.ts](/Users/mattbrillman/Car_Identifier/backend/src/types/domain.ts)

Known limitations:

- focus crop is still heuristic, not detector-driven
- low-resolution or motion-blurred badge text may still fall below the `0.75` hard-dominance threshold
- text dominance is intentionally conservative below that threshold, where text acts as a boost instead of a hard filter

### Fullscreen zoomable result/detail image viewer

Scan result and vehicle detail hero images now support fullscreen viewing.

Current behavior:

- tapping the top image on [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx) opens a fullscreen dark modal
- tapping the hero image on [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx) does the same
- modal supports pinch zoom + pan
- image opens in contain mode and keeps the original uncropped asset

Files involved:

- [components/ZoomableImageModal.tsx](/Users/mattbrillman/Car_Identifier/components/ZoomableImageModal.tsx)
- [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
- [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)

Viewer logs:

- `RESULT_IMAGE_VIEWER_OPENED`
- `RESULT_IMAGE_VIEWER_CLOSED`
- `VEHICLE_DETAIL_IMAGE_VIEWER_OPENED`
- `VEHICLE_DETAIL_IMAGE_VIEWER_CLOSED`

### Guest-first scanning

Guest scan is now the intended product flow:

- Standard scan should work without sign-in
- Standard scan should not be blocked by scan-count limits at all
- Sign-in is still required for:
  - backend/synced Garage items
  - synced history
  - restore across devices
  - subscription/account management
  - backend premium unlock/account endpoints
- Sign-in is not required for:
  - scanning
  - guest unlock usage on the same device
  - local estimate-backed Garage items on the same device

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
- free users get 3 free Pro unlocks
- scanning alone must not consume free Pro unlocks
- basic scan result identification remains visible without Pro
- only locked premium sections should depend on unlocks or Pro

Recent app-side fixes:

- [app/(tabs)/scan.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/scan.tsx)
  - removed hard free-scan blocking logic
  - upsell logic now keys off remaining free Pro unlocks instead of scan counts
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
- no production-ready StoreKit or RevenueCat purchase path is wired yet
- purchase UI can explain Pro and route to paywall, but monetization infrastructure is still an open item

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

### Bulk canonical seed import

CarScanr now has a direct bulk seed/import path for `canonical_vehicles`, so coverage can be expanded without manually scanning vehicles first.

- seed file location:
  - [backend/data/canonical_seed/starter_demo_seed.json](/Users/mattbrillman/Car_Identifier/backend/data/canonical_seed/starter_demo_seed.json)
  - larger files like a Top 100 seed should live in the same folder
- importer:
  - [backend/scripts/importCanonicalSeed.ts](/Users/mattbrillman/Car_Identifier/backend/scripts/importCanonicalSeed.ts)
  - npm scripts in [backend/package.json](/Users/mattbrillman/Car_Identifier/backend/package.json):
    - `npm run import:canonical-seed`
    - `npm run validate:canonical`
    - `npm run seed:canonical-and-export`
- supported input:
  - JSON only right now
  - either a top-level array of rows or an object with `vehicles: [...]`
- important fields for usable scan/detail coverage:
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
  - `specs_json`
  - importer behavior:
  - validates required fields and canonical key consistency
  - normalizes make/model/trim/canonical key using the same backend helpers as the live scan path
  - upserts by `canonical_key`
  - never deletes rows
  - preserves richer existing records when an incoming seed row is weaker
  - logs inserted / updated / skipped totals
  - default workflow rule:
    - when modifying canonical vehicle data, CarAPI raw/source data, seed generation, import logic, vehicle aliasing, model normalization, or scan matching, always run `npm run validate:canonical` before reporting completion
  - validation command:
    - `npm run validate:canonical`
    - runs:
      - `npm run check:canonical-coverage`
      - `npm run audit:canonical-lookup`
- intended refresh flow:
  1. put the seed JSON in `backend/data/canonical_seed/`
  2. run `cd backend && npm run import:canonical-seed -- --file data/canonical_seed/top100.json`
  3. `npm run import:canonical-seed` now runs canonical validation automatically after import
  4. run `cd backend && npm run export:offline-canonical`
  5. or run one command: `cd backend && npm run seed:canonical-and-export -- --file data/canonical_seed/top100.json`
  6. the app then consumes the refreshed [assets/data/offline_canonical.json](/Users/mattbrillman/Car_Identifier/assets/data/offline_canonical.json)

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

#### Legacy estimate-detail note

This section is historical context only.

Older estimate-detail behavior used explicit conservative labels and stricter `showApproximate*` gating such as:

- `Estimated vehicle detail`
- `Photo-based estimate`
- `Approximate Specs`
- `Similar Market Range`
- `Similar Listings`

That is not the current global product truth anymore.

Current truth is defined in the later section:

- [Current product truth: trusted high-confidence results, unified unlocks, and Garage reopen](/Users/mattbrillman/Car_Identifier/HANDOFF_CHATGPT.md#L1045)

Use the legacy note only to understand why older code paths or older commits may still mention:

- `showApproximateSpecs`
- `showApproximateMarket`
- `showApproximateListings`
- conservative estimate-only copy

Current distinction to keep in mind:

- locked or non-trusted estimate-backed results may still use a more conservative presentation
- trusted high-confidence unlocked results should not be described by the old estimate-only wording or old conservative post-unlock holdbacks
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

### Historical result-screen touch fix

This is a historical debugging note, not a current primary product issue.

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

Current trusted unlocked product truth:

- trusted result means:
  - confidence `>= 0.90`
  - and not extreme-risk
- once that vehicle is unlocked:
  - it should behave as fully unlocked for that vehicle
  - no second unlock ask
  - no premium overlay
  - no old estimate/family/grounding holdback language
  - best available specs/value/listings/photos should be shown whenever any usable fallback exists

Current conservative estimate behavior is now narrower:

- it applies to:
  - locked estimate-backed results
  - or non-trusted estimate-backed results
- it should not override trusted unlocked behavior

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
  - `value_unavailable`
- For Sale:
  - `listings_available`
  - `listings_unavailable`

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

Garage/auth truth:

- there are now two distinct Garage modes:
  - backend/synced Garage
    - auth required
    - real backend `vehicleId` records
    - cross-device restore/sync capable
  - local estimate Garage
    - same-device only
    - guest-usable
    - estimate-backed / visual-override saves stored locally in AsyncStorage

Do not describe Garage as globally auth-required anymore.
Only backend/synced Garage is auth-required.

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

Estimate Garage limitation:

- estimate-backed Garage items are currently same-device only
- storage is local AsyncStorage only
- they are not synced cross-device
- they are not automatically migrated into backend/synced Garage if the user signs in later

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

Unlock identity limitation:

- estimate unlock ids are much more stable than before
- same inferred `year + make + model + family` now reliably stays unlocked on the same device
- the same real-world vehicle can still split into different unlock identities if separate scans resolve to materially different identities
  - example:
    - one scan resolves as `2026 Honda CR-V`
    - another resolves as `2025 Honda CR-V`
- keep this limitation documented here once; do not restate it throughout the doc

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

- Confirm the standard scan path on live backend now:
  - degrades through cache
  - reaches live vision
  - returns either catalog match or AI-only best-effort result
- Verify fallback AI-only results behave acceptably in the result screen UX on device
- RevenueCat / StoreKit purchase flow still is not launch-grade
- Production crash reporting / monitoring is still missing

Historical / regression checks:

- result-screen touch behavior was a real bug earlier; keep it as a regression check during device/TestFlight validation, not as the main active product blocker

## IMPLEMENTATION_NOTES

- free users now start with 3 free Pro unlocks, not 5
- standard scans remain unlimited and are still separate from Pro unlock usage
- value now has a zero-cost estimated path before any live market fetch
- live value and live listings are now on-demand and cache-first instead of auto-loading on initial detail open
- listings can render a cached/on-demand summary state without forcing MarketCheck
- bootstrap-safe preseed tuning now defaults trending preload to a more conservative profile
- canonical seed import now supports bulk starter/Top-100 style seeding into `canonical_vehicles`
- offline canonical export can now be chained directly after seed import
- new backend query flags used by the app:
  - `allowLive`
  - `fetchReason`
- new verification logs include:
  - `VALUE_LIVE_FETCH_GATE_EVALUATED`
  - `VALUE_LIVE_FETCH_SKIPPED`
  - `VALUE_LIVE_FETCH_ALLOWED`
  - `LISTINGS_LIVE_FETCH_GATE_EVALUATED`
  - `LISTINGS_LIVE_FETCH_SKIPPED`
  - `LISTINGS_LIVE_FETCH_ALLOWED`
  - `PROVIDER_CALL_SKIPPED_CACHE_HIT`
  - `PROVIDER_CALL_SKIPPED_NOT_UNLOCKED`
  - `PROVIDER_CALL_SKIPPED_ESTIMATE_GUARD`
  - `PROVIDER_CALL_SKIPPED_INITIAL_LOAD`

## Current Backend Truth

### Standard identify behavior

- `POST /api/scan/identify` is now intended to be:
  - cache-aware
  - canonical-first
  - mock-fallback-disabled in live mode after OpenAI vision refusal
- In `FORCE_PROVIDER_MODE=live`:
  - OpenAI vision refusal or failure must not fall back to fake mock vehicle identity
  - unknown-result fallback is preferred over fake make/model/year output
  - exact image-key / analysis-cache reuse is allowed
  - near-match stability reuse is not allowed; near matches force fresh identify
- Key logs around this path:
  - `SCAN_FORCE_FRESH_IDENTIFY`
  - `SCAN_STABILITY_CACHE_HIT_EXACT`
  - `SCAN_STABILITY_CACHE_SKIPPED_NEAR_MATCH`
  - `LIVE_VISION_REFUSAL_NO_MOCK_FALLBACK`
  - `SCAN_RESULT_UNKNOWN_AFTER_VISION_FAILURE`

### Analysis cache status

- Cached analysis reserve/complete flow is working again
- The connected Supabase project previously missed `cached_analysis.analysis_type`; repair migration was added and runtime logging now shows:
  - `ANALYSIS_CACHE_OPERATION`
  - `ANALYSIS_CACHE_BEGIN_RESULT`
  - `ANALYSIS_CACHE_COMPLETE_RESULT`
- Expected healthy sequence:
  - `get -> miss`
  - `begin -> reserved`
  - live vision
  - `complete -> completed`

### Mercedes SL-Class normalization / grounding

- Mercedes SL badge normalization is now a shared runtime rule, not a one-off patch
- Required invariant:
  - `SL500`, `SL 500`, `SL-500` -> `model: SL-Class`, `trim: SL500`
  - `SL600`, `SL 600`, `SL-600` -> `model: SL-Class`, `trim: SL600`
  - `SL320`, `SL 320`, `SL-320` -> `model: SL-Class`, `trim: SL320`
- This is applied across:
  - normalized AI output
  - alternate candidates
  - badge/model text handling
  - canonical lookup
  - enrichment candidates
  - popularity/stability keys
- Key logs:
  - `MERCEDES_SL_NORMALIZATION`
  - `MERCEDES_SL_PRE_CANONICAL_LOOKUP`
  - `MERCEDES_SL_POST_BADGE_FILTER`
  - `MERCEDES_SL_ENRICHMENT_CANDIDATE`
  - `MERCEDES_SL_CANONICAL_YEAR_PREFERENCE`
- Important truth:
  - do not regress to canonical keys shaped like `mercedes-benz:sl500:sl500`
  - correct runtime keys must stay in `mercedes-benz:sl-class:sl500`

### Canonical lookup fallback behavior

- Canonical lookup order now matters:
  1. exact canonical key
  2. trim-relaxed same-year base canonical key, when a non-base trim was guessed
  3. broader canonical promoted/family fallback
  4. live provider rescue only after canonical miss paths fail
- New trim-relaxed lookup logs:
  - `CANONICAL_TRIM_RELAXED_LOOKUP_START`
  - `CANONICAL_TRIM_RELAXED_LOOKUP_HIT`
  - `CANONICAL_TRIM_RELAXED_LOOKUP_MISS`
- This is intentionally generic and not PT Cruiser-only

### Chrysler PT Cruiser canonical support

- Added durable seed file:
  - `backend/data/canonical_seed/chrysler_ptcruiser_expansion.json`
- Coverage:
  - Chrysler PT Cruiser years `2001` through `2010`
  - canonical keys use `:base:unknown`
- Runtime intent:
  - if OpenAI identifies `2006 Chrysler PT Cruiser Limited`
  - and exact `limited` canonical key misses
  - same-year `base` canonical row should resolve before provider rescue
- Important live-state caveat:
  - direct probe against the connected Supabase project returned:
    - `canonical:2006:chrysler:pt-cruiser:base:unknown -> data: null`
  - that means the seed file exists in repo, but the connected project still needs the import run

### Live canonical-miss provider rescue

- Provider rescue is still intended as a fallback, not a default path
- Rescue conditions:
  - `FORCE_PROVIDER_MODE=live`
  - canonical miss
  - primary candidate only
  - high confidence
  - not already rate-limited
- Rescue logging now has a dedicated decision helper and must emit one of:
  - `LIVE_CANONICAL_MISS_PROVIDER_RESCUE_STARTED`
  - `LIVE_CANONICAL_MISS_PROVIDER_RESCUE_SKIPPED`
- Dev/test tripwire:
  - `LIVE_CANONICAL_MISS_PROVIDER_RESCUE_MISSING_GATE`
- Important truth:
  - if bootstrap skip logs appear without rescue STARTED/SKIPPED first, that is a regression

### Provider log severity cleanup

- Normal provider-attempt lifecycle logs should not read like hard failures
- Current intended severity:
  - `CANONICAL_PROVIDER_ENRICH_START` -> `INFO`
  - `PROVIDER_ENRICH_SKIPPED_AFTER_429` -> `WARN`
  - graceful `CANONICAL_PROVIDER_ENRICH_FAILURE` fallback cases -> `WARN`
  - true unexpected provider exceptions -> `ERROR`

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

### Source-First Canonical Ingestion

```bash
cd backend
npm run fetch:source-data -- --targets data/source_ingestion/targets.example.json
npm run transform:source-cache -- --cache-dir data/source_cache --output data/canonical_seed/source_ingestion_seed.json
npm run import:canonical-seed -- --file data/canonical_seed/source_ingestion_seed.json
npm run export:offline-canonical:top100
```

Notes:
- authoritative-source adapters live in `backend/src/lib/sourceIngestion.ts`
- alias normalization lives in `backend/src/lib/vehicleAliases.ts`
- field-level provenance is stored in canonical `overview_json.fieldProvenance`
- starter target packs:
  - `backend/data/source_ingestion/top_common_targets.json`
  - `backend/data/source_ingestion/older_specialty_targets.json`
  - `backend/data/source_ingestion/mercedes_older_targets.json`
- popularity-focused export packs:
  - `npm run export:offline-canonical:top100`
  - `npm run export:offline-canonical:top500`
  - `npm run export:offline-canonical:older-specialty`
- older Mercedes SL manual seed import:
  - `npm run import:canonical-seed -- --file data/canonical_seed/mercedes_sl_older_expansion.json`
  - `npm run export:offline-canonical:older-specialty`

### EAS build / submit

```bash
eas build -p ios
eas submit -p ios
```

### Canonical gap queue + seed pipeline

- Added `backend/supabase/migrations/019_canonical_gap_queue.sql`
  - creates `public.canonical_gap_queue`
  - adds duplicate-safe `public.upsert_canonical_gap_queue(...)`
- Scan-time canonical misses now record durable gap rows when:
  - `canonicalHit === false`
  - and `finalResultType === "ai_only"` or `payloadStrength === "empty"`
- New logs:
  - `CANONICAL_GAP_RECORDED`
  - `CANONICAL_GAP_INCREMENTED`
  - `CANONICAL_SEED_GENERATED`
  - `CANONICAL_SEED_IMPORT_SUMMARY`
  - `CANONICAL_SEED_SKIPPED_EXISTING_STRONGER`

Commands:

```bash
cd backend
npm run export:canonical-gaps -- --limit 100
npm run generate:canonical-seed -- --file data/canonical_source/common_vehicles_starter.json --output data/canonical_seed/generated_from_source.json
npm run import:canonical-seed -- --file data/canonical_seed/generated_from_source.json
npm run import:canonical-seed -- --dir data/canonical_seed
npm run export:offline-canonical
```

Starter conservative source packs:

- `backend/data/canonical_source/common_vehicles_starter.json`
- `backend/data/canonical_source/older_specialty_starter.json`

### Workbook-backed CarAPI canonical pipeline

- canonical generation now supports the workbook:
  - [backend/data/carapi_raw/v2-carapi-datafeed.xlsx](/Users/mattbrillman/Car_Identifier/backend/data/carapi_raw/v2-carapi-datafeed.xlsx)
- generator entrypoint:
  - [backend/scripts/generateCanonicalSeedFromCarApi.ts](/Users/mattbrillman/Car_Identifier/backend/scripts/generateCanonicalSeedFromCarApi.ts)
- current behavior:
  - prefers `v2-carapi-datafeed.xlsx` when it exists in `backend/data/carapi_raw`
  - falls back to the legacy CSV set:
    - `makes.csv`
    - `models.csv`
    - `submodels.csv`
    - `trims.csv`
    - `engines.csv`
    - `bodies.csv`
- workbook support was added using the `xlsx` package in:
  - [backend/package.json](/Users/mattbrillman/Car_Identifier/backend/package.json)
- important workbook field mapping:
  - `Trims` sheet
  - `Trim MSRP` -> canonical `msrp`
  - `Trim Invoice` is available for future use but is not currently surfaced in the app
- generator verification completed:
  - source type logged as `workbook`
  - source path logged as:
    - `/Users/mattbrillman/Car_Identifier/backend/data/carapi_raw/v2-carapi-datafeed.xlsx`
- canonical validation after workbook regeneration:
  - `npm run validate:canonical`
  - coverage passed
  - alias audit passed

Commands run successfully:

```bash
cd backend
node --import tsx scripts/generateCanonicalSeedFromCarApi.ts
npm run validate:canonical
node --import tsx scripts/importCanonicalSeed.ts --file data/canonical_seed/carapi_generated.json --export-offline
```

Results from the real import/export run:

- Supabase canonical import summary:
  - file: `backend/data/canonical_seed/carapi_generated.json`
  - rowCount: `13228`
  - updated: `13228`
  - failed: `0`
- offline export completed:
  - [assets/data/offline_canonical.json](/Users/mattbrillman/Car_Identifier/assets/data/offline_canonical.json)
  - historical default top-pack export was later expanded beyond this

### Offline canonical bundle status

- the current default offline canonical export is no longer the old `top200`
- current default behavior:
  - `npm run export:offline-canonical`
  - now exports the default `top500` pack
- exporter:
  - [backend/scripts/exportOfflineCanonical.ts](/Users/mattbrillman/Car_Identifier/backend/scripts/exportOfflineCanonical.ts)
- current bundle size decision:
  - `top500` was accepted because the real bundle size increase was still small enough for mobile use
- current default bundled file:
  - [assets/data/offline_canonical.json](/Users/mattbrillman/Car_Identifier/assets/data/offline_canonical.json)
- current exported vehicle count is intentionally `503`, not `500`, because the bundle now force-includes required sample/demo vehicles on top of the default popularity pack

Required sample/demo vehicles now always included in the offline bundle:

- `2022-tesla-model-3-long-range`
- `2019-ford-mustang-gt`
- `2023-harley-davidson-street-glide-special`

Why this was added:

- the sample scan flow was using the offline/local canonical layer for locked/local spec hydration
- those sample vehicles were missing from the popularity-based offline export
- result: sample vehicles could show no local specs even though rich seed data existed elsewhere in the repo
- fix:
  - the exporter now force-merges those required sample vehicle IDs into every offline export

Verified sample vehicle spec presence in the current exported bundle:

- Tesla Model 3 Long Range:
  - MSRP `50990`
  - HP `449`
  - engine `Dual Motor Electric`
  - drivetrain `AWD`
  - transmission `Single-speed`
  - body style `Sedan`
- Ford Mustang GT:
  - MSRP `35995`
  - HP `460`
  - engine `5.0L V8`
  - drivetrain `RWD`
  - transmission `6-speed Manual`
  - body style `Coupe`
- Harley-Davidson Street Glide Special:
  - MSRP `30399`
  - HP `95`
  - engine `Milwaukee-Eight 114 V-Twin`
  - drivetrain `Belt`
  - transmission `6-speed Manual`
  - body style `Touring Motorcycle`

Important caveat for older MSRP coverage:

- the workbook is now the active preferred CarAPI source going forward
- however, some older exact-year rows in the workbook still contain zero MSRP values
- confirmed example:
  - `1992-1997 Ford Ranger`
  - `Trims` sheet rows show:
    - `Trim MSRP = 0`
    - `Trim Invoice = 0`
- so updating the pipeline/Supabase/offline bundle does **not** magically restore real MSRP for those exact Ranger rows
- in those cases, exact MSRP is absent from the source workbook itself
- if real MSRP is needed for those older families, a second trusted source or a targeted backfill seed is still required

### Locked Vehicle Specs preview status

- active screen:
  - [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
- current product rule:
  - free scan result shows identification only
  - specs are rendered as a locked premium preview until the vehicle/report is unlocked
- critical guardrails:
  - do not remove or break the real spec data path
  - keep:
    - `freeDisplaySpecs`
    - `freeSpecRows`
    - `freeSpecLookup`
    - `performanceSnapshot`
  - unlocked state must still render readable real values normally
- current locked-preview implementation:
  - labels remain readable
  - values render as obscured/blurred previews on the right
  - centered lock overlay remains above the panel
  - `Unlock Specs` remains the CTA
- current MSRP-specific behavior:
  - if real MSRP is available through canonical/backend/local fallback, it should render as a blurred preview like the other rows
  - if exact-year MSRP is missing at the source, do not assume the app lost it by bug
  - first verify whether the canonical/workbook row actually contains a nonzero MSRP
- current row-inclusion behavior for locked preview:
  - if a real raw spec value exists, render the row with an obscured/blurred preview
  - if a real raw spec value does not exist, omit the row entirely
  - do not render `Hidden`, dashes, or empty placeholder rows in the locked preview
- current known caveat:
  - the Ford Ranger `1992-1997` example still lacks true exact-year MSRP in the workbook-backed canonical source, so MSRP restoration for that family is a data problem, not just a UI problem

### Sample vehicle unlock rules

- built-in sample vehicles must be fully viewable without consuming a free Pro unlock
- current sample list lives in:
  - [features/scan/samplePhotos.ts](/Users/mattbrillman/Car_Identifier/features/scan/samplePhotos.ts)
- current sample IDs:
  - `2022-tesla-model-3-long-range`
  - `2019-ford-mustang-gt`
  - `2023-harley-davidson-street-glide-special`
- current behavior:
  - sample vehicles are treated as `already_unlocked`
  - sample vehicles do not decrement `freeUnlocksUsed`
  - sample vehicles are recognized as unlocked by both:
    - [services/subscriptionService.ts](/Users/mattbrillman/Car_Identifier/services/subscriptionService.ts)
    - [features/subscription/SubscriptionProvider.tsx](/Users/mattbrillman/Car_Identifier/features/subscription/SubscriptionProvider.tsx)
- product intent:
  - demo/sample cars should behave like built-in showcases
  - users should not have to spend a free unlock just to inspect the bundled examples

### Unlock reset/testing notes

- the unlock counter is not stored in just one place
- current test-device/user reset requires clearing both:
  - backend unlock balance/history
  - local simulator AsyncStorage cache
- signed-in users:
  - backend source of truth uses:
    - `user_unlock_balances`
    - `user_vehicle_unlocks`
- local device cache:
  - `carscanr.freeUnlocks.v1:<userId>`
- helper script added for backend-side reset:
  - [backend/scripts/resetUserUnlocks.ts](/Users/mattbrillman/Car_Identifier/backend/scripts/resetUserUnlocks.ts)
- current usage:

```bash
cd /Users/mattbrillman/Car_Identifier/backend
node --import tsx scripts/resetUserUnlocks.ts <email>
```

- important nuance:
  - resetting the backend alone is not enough if the simulator still has stale local unlock cache
  - the app merges backend unlock state with local persisted unlock state

### Vehicle detail UI guardrails

- unlocked vehicle detail screen:
  - [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
  - [components/ValueEstimateCard.tsx](/Users/mattbrillman/Car_Identifier/components/ValueEstimateCard.tsx)
- current product rules for the unlocked `Value` tab:
  - the condition selector is intentionally simplified to exactly `Fair`, `Good`, and `Excellent`
  - condition choices must stay on one line and must not wrap into multiple rows
  - when market value fields are unavailable, do not render the trade/private/retail mini cards with `Unavailable`
  - instead render one intentional unavailable state:
    - title: `Market value unavailable`
    - body: `We couldn’t load a live value for this vehicle yet. Specs are still available.`
    - action: `Refresh live market value` when eligible
  - only show trade/private/retail metric cards when real numeric/range values exist
  - do not expose provider names, quota/rate-limit messages, route params, or QA/debug labels in the user-facing vehicle detail UI
- logging added for value refresh behavior:
  - `VALUE_REFRESH_ATTEMPT`
  - `VALUE_REFRESH_SUCCESS`
  - `VALUE_REFRESH_UNAVAILABLE`
  - `VALUE_REFRESH_PROVIDER_LIMITED`
- when editing unlocked vehicle detail UI, preserve:
  - no visible QA/debug cards
  - no wrapped tab labels
  - no distorted hero vehicle image

### Shared premium UI styling system

- shared styling primitives now live in:
  - [design/tokens.ts](/Users/mattbrillman/Car_Identifier/design/tokens.ts)
  - [design/patterns.ts](/Users/mattbrillman/Car_Identifier/design/patterns.ts)
  - [constants/theme.ts](/Users/mattbrillman/Car_Identifier/constants/theme.ts)
  - [components/AppContainer.tsx](/Users/mattbrillman/Car_Identifier/components/AppContainer.tsx)
- locked premium style constants now exposed from [constants/theme.ts](/Users/mattbrillman/Car_Identifier/constants/theme.ts):
  - `PremiumGradients`
  - `PremiumCard`
  - extended `Spacing`
  - extended `Radius`
- when adding new user-facing screens or cards, prefer shared theme exports over inline hex values whenever the design should match the unlocked report screen
- current app-wide visual direction:
  - layered dark navy backgrounds
  - subtle depth between page, primary cards, and secondary cards
  - restrained cyan/blue accents only
  - no glow-heavy or gaming-style treatment
- base palette in use:
  - page background: `#050B14`
  - page alt: `#08131F`
  - primary card surface: `#0F2236`
  - secondary card surface: `#0A1A2A`
  - supporting panel surface: `#0B1A2A`
  - input/control surface: `#13243A`
  - border: `rgba(255,255,255,0.06)`
  - accent border: `rgba(59,130,246,0.35)`
  - primary text: `#E6EDF3`
  - secondary text: `#9FB3C8`
  - muted text: `#7890A8`
  - accent cyan: `#5EEBFF`
  - accent blue: `#1688FF`
- card rules:
  - primary cards use the shared `cardStyles.primary`
  - secondary/helper cards use `cardStyles.standard` or `cardStyles.secondary`
  - cards should keep:
    - radius around `16`
    - subtle border
    - no heavy shadow
    - padding `16-18`
- container spacing rules:
  - default horizontal screen padding: `16`
  - default bottom padding: `28`
  - major card spacing: about `18`
  - bottom CTA spacing: about `14-18`
- inputs:
  - use `Colors.cardAlt` for input backgrounds
  - keep the subtle border
  - do not invent brighter fills for forms
- buttons:
  - keep the current blue primary button hierarchy
  - secondary buttons should stay darker and restrained
- explicit regression guards for styling-only passes:
  - do not change vehicle image sizing, aspect ratio, or fit policy
  - do not change tab count or tab behavior
  - do not introduce horizontal overflow
  - do not add visible QA/debug/dev panels to user-facing UI
  - do not expose route params, provider labels, cache keys, or internal source wording in visible text
- unlocked vehicle detail visual rules now also include:
  - the main vehicle image should sit inside a primary-card-style frame, not directly on the page
  - image frame treatment:
    - same radius family as primary cards
    - same subtle border
    - subtle navy gradient shell
    - `6-8` points of padding around the image
  - the vehicle image itself must keep the existing fit behavior and must never be stretched
  - the unlocked vehicle header card can use a slightly stronger visual emphasis than secondary cards
    - acceptable: accent border around `rgba(59,130,246,0.25)`
    - not acceptable: larger size, glow-heavy effect, or extra pills
  - tab/content separation on the unlocked detail screen should keep a small breathing gap:
    - about `10-12` points below the tab control before content starts
  - the segmented tab control background can be slightly darker than the surrounding cards
    - current target: `#081521`
  - the app-wide page gradient should remain extremely subtle:
    - slightly lighter navy at the top
    - fading into the base background
    - should be barely noticeable, not a hero effect
- screens/components specifically updated to follow this system:
  - [app/(tabs)/scan.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/scan.tsx)
  - [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
  - [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
  - [app/(tabs)/garage.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/garage.tsx)
  - [app/(tabs)/search.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/search.tsx)
  - [app/(tabs)/profile.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/profile.tsx)
  - [app/auth.tsx](/Users/mattbrillman/Car_Identifier/app/auth.tsx)
  - [app/paywall.tsx](/Users/mattbrillman/Car_Identifier/app/paywall.tsx)
  - [app/reset-password.tsx](/Users/mattbrillman/Car_Identifier/app/reset-password.tsx)
  - [app/index.tsx](/Users/mattbrillman/Car_Identifier/app/index.tsx)
  - [components/EmptyState.tsx](/Users/mattbrillman/Car_Identifier/components/EmptyState.tsx)
  - [components/PaywallCard.tsx](/Users/mattbrillman/Car_Identifier/components/PaywallCard.tsx)
  - [components/UpgradePromptCard.tsx](/Users/mattbrillman/Car_Identifier/components/UpgradePromptCard.tsx)
  - [components/ValueEstimateCard.tsx](/Users/mattbrillman/Car_Identifier/components/ValueEstimateCard.tsx)

### MarketCheck hard guard status

- MarketCheck is now supposed to be locked behind explicit intent only
- centralized outbound MarketCheck logging, cache, dedupe, and safety guards now live in:
  - [backend/src/providers/marketcheck/marketCheckVehicleDataProvider.ts](/Users/mattbrillman/Car_Identifier/backend/src/providers/marketcheck/marketCheckVehicleDataProvider.ts)
  - [backend/src/lib/providerCache.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/providerCache.ts)
  - [backend/src/services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/vehicleService.ts)
- current provider-level request logs:
  - `MARKETCHECK_API_REQUEST_START`
  - `MARKETCHECK_API_RESPONSE`
  - `MARKETCHECK_API_CACHE_HIT`
  - `MARKETCHECK_API_INFLIGHT_DEDUPE`
  - `MARKETCHECK_API_SKIPPED_RATE_GUARD`
  - `MARKETCHECK_API_FALLBACK_ATTEMPT`
  - `MARKETCHECK_USAGE_SUMMARY`
- old guard logs still matter where present:
  - `MARKETCHECK_CALL_START`
  - `MARKETCHECK_DISABLED_SKIP`
- explicit guard rules now in effect:
  - value calls require:
    - `allowLive === true`
    - `fetchReason === "user_requested_value_refresh"`
  - listings calls require:
    - `allowLive === true`
    - `fetchReason === "user_requested_listings_refresh"`
  - initial detail load must not call MarketCheck
  - tab switches must not call MarketCheck
  - unlocking specs must not call MarketCheck
  - local/dev background trending MarketCheck must stay disabled unless:
    - `ENABLE_BACKGROUND_MARKETCHECK=true`
- new provider safety env vars:
  - `MARKETCHECK_MONTHLY_CALL_LIMIT`
  - `MARKETCHECK_WARN_AT`
  - `MARKETCHECK_DISABLE_EXTERNAL_CALLS`
- new stricter action-policy env vars:
  - `MARKETCHECK_ENABLE_SCAN_ENRICHMENT`
  - `MARKETCHECK_ENABLE_AUTO_SPECS`
  - `MARKETCHECK_ENABLE_AUTO_LISTINGS`
  - `MARKETCHECK_ENABLE_BACKGROUND_REFRESH`
- current frontend explicit refresh reasons live in:
  - [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
- current backend guard files:
  - [backend/src/services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/vehicleService.ts)
  - [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts)
  - [backend/src/services/trendingVehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/trendingVehicleService.ts)
- frontend duplicate-request guard files:
  - [services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/services/vehicleService.ts)
  - [lib/vehicleDetailMarket.ts](/Users/mattbrillman/Car_Identifier/lib/vehicleDetailMarket.ts)
  - [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
- current cache TTLs:
  - specs lookup cache: `7d`
  - value lookup cache: `24h`
  - listings lookup cache: `6h`
  - empty listings cache: `1h`
- provider-level in-flight dedupe now exists:
  - identical concurrent MarketCheck requests share one outbound promise instead of creating parallel provider calls
- frontend in-flight dedupe now exists:
  - identical repeated `getValue(...)` requests share one promise
  - identical repeated `getListings(...)` requests share one promise
- likely cause of the observed `+6` usage spike from one Value open:
  - the vehicle detail screen could re-arm value/listings requests after state changes
  - the client had no request-level in-flight dedupe
  - the provider had DB cache support but did not collapse identical concurrent outbound calls early enough
  - result: one screen open could fan out into multiple backend requests, and more than one could escape to MarketCheck before cache state settled
- likely cause of the later `+16` spike from `3 scans + specs opens + one value click`:
  - scan identify still had a provider-enrichment rescue path that could call MarketCheck specs/searchCandidates
  - passive `getSpecs()` still allowed live MarketCheck specs fetches on detail/specs open
  - background/trending code still needed an explicit second guard so hosted refresh/preload logic could not spend MarketCheck by accident
  - result: even without explicit Value refreshes, MarketCheck could still be consumed by non-Value flows
- likely cause of the later `+2` spike from `1 scan + no taps after scan`:
  - the scan identify flow still had two MarketCheck-backed specs rescue branches in [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts):
    - `providers.specsProvider.searchCandidates(...)`
    - `providers.specsProvider.getVehicleSpecs(...)`
  - both were tagged as:
    - `reason: "scan_identify_provider_enrichment"`
    - `sourceScreen: "scan"`
    - `stackTag: "scan-identify"`
  - the expected outbound type for both calls was `specs`
  - provider-level source-screen guarding now blocks those requests even if env drift or permissive flags would otherwise allow them
- if production/TestFlight still shows MarketCheck movement after that backend fix, the most likely explanations are:
  - Render is not actually running the fixed backend commit
  - a hidden background/preload/trending path is still live in the deployed env
  - a request is arriving without expected source tagging and needs to be identified from production logs
- final MarketCheck policy by action:
  - scan action:
    - max `0` MarketCheck calls by default
    - MarketCheck scan enrichment is blocked unless `MARKETCHECK_ENABLE_SCAN_ENRICHMENT=true`
  - vehicle detail open:
    - max `0` MarketCheck calls by default
    - internal/canonical/stored specs only
  - specs open:
    - max `0` MarketCheck calls by default
    - live MarketCheck specs require explicit opt-in via `allowLive` + `fetchReason=user_requested_specs_refresh` and `MARKETCHECK_ENABLE_AUTO_SPECS=true`
  - value click:
    - passive Value tab open still makes `0` MarketCheck calls by default
    - explicit live refresh is allowed when any of these metadata signals identify a user-requested value refresh:
      - `action=valueRefresh`
      - `fetchReason=user_requested_value_refresh`
      - `sourceScreen=valueScreen` with `allowLive=true`
      - `forceLive=true`
    - max `1` MarketCheck value call for the same cache key
    - repeats should hit cache or in-flight dedupe
  - listings open:
    - max `0` MarketCheck calls by default
    - only explicit `sourceScreen=listingsScreen` + `action=listingsRefresh` may call live MarketCheck
    - `MARKETCHECK_ENABLE_AUTO_LISTINGS=false` must block automatic listings hydration only, not explicit user refresh
  - trending / preload / bootstrap / background hydration:
    - max `0` MarketCheck calls by default
    - requires `ENABLE_BACKGROUND_MARKETCHECK=true` and `MARKETCHECK_ENABLE_BACKGROUND_REFRESH=true`
- current remaining call paths that can still reach MarketCheck when explicitly enabled:
  - [backend/src/services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/vehicleService.ts)
    - `getValue(...)`
    - `getListings(...)`
    - `getSpecs(...)`
  - [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts)
    - provider enrichment rescue path, now disabled by default behind `MARKETCHECK_ENABLE_SCAN_ENRICHMENT=false`
  - [backend/src/services/trendingVehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/trendingVehicleService.ts)
    - background preload path, now disabled by default behind dual flags
- new policy/guard logs to watch:
  - `MARKETCHECK_ACTION_BUDGET_EXCEEDED`
  - `MARKETCHECK_DISABLED_SKIP`
  - `MARKETCHECK_API_SKIPPED_RATE_GUARD`
  - `BACKEND_BUILD_COMMIT`
  - `MARKETCHECK_USAGE_SUMMARY`
- new production-proof startup log:
  - `BACKEND_BUILD_COMMIT`
  - includes:
    - `backendBuildCommit`
    - `marketCheckDisableExternalCalls`
    - `marketCheckEnableScanEnrichment`
    - `marketCheckEnableAutoSpecs`
    - `marketCheckEnableAutoListings`
    - `marketCheckEnableBackgroundRefresh`
- new debug endpoint:
  - `GET /api/debug/marketcheck`
  - returns:
    - current env flag values
    - current startup diagnostics
    - recent MarketCheck usage logs for the last 10 minutes
    - grouped counts by:
      - endpoint
      - sourceScreen
      - route
      - cacheKey
      - event type
- expected behavior after this fix:
  - scans should consume `0` MarketCheck calls by default
  - opening vehicle detail or Specs should consume `0` MarketCheck calls by default
  - first valid explicit live value fetch may consume one MarketCheck call
  - first valid explicit live listings fetch may consume one MarketCheck call
  - repeated opens of the same Value screen should reuse cached/stored data
  - repeated opens of the same Listings screen should reuse cached/stored data
  - concurrent identical opens or repeated state-triggered fetches should dedupe instead of multiplying calls
- validation that passed for this work:
  - `npm run typecheck`
  - `cd /Users/mattbrillman/Car_Identifier/backend && npm run typecheck`
  - `cd /Users/mattbrillman/Car_Identifier/backend && npm run build`
  - `cd /Users/mattbrillman/Car_Identifier/backend && node --import tsx --test tests/marketCheckProvider.test.ts tests/bootstrapCostControl.test.ts`
  - `cd /Users/mattbrillman/Car_Identifier && node --import ./backend/node_modules/tsx/dist/loader.mjs --test tests/vehicleDetailMarket.test.ts`

How to verify after the next live deploy:

- scan 3 different vehicles
- inspect logs and confirm:
  - no `MARKETCHECK_API_REQUEST_START` from `sourceScreen: "scan"`
  - any blocked scan attempt logs `MARKETCHECK_DISABLED_SKIP` and `MARKETCHECK_ACTION_BUDGET_EXCEEDED`
- open a vehicle detail screen and Specs
- confirm:
  - no `MARKETCHECK_API_REQUEST_START` from `sourceScreen: "vehicleDetail"` or `sourceScreen: "specsScreen"`
- trigger `Refresh live market value` once
- inspect logs for exactly one `MARKETCHECK_API_REQUEST_START` for `endpointType: "value"` for that cache key
- confirm logs include:
  - `VALUE_LIVE_REFRESH_REQUESTED`
  - `MARKETCHECK_EXPLICIT_ACTION_ALLOWED`
- reopen the same Value screen without changing the descriptor
- expected result:
  - `MARKETCHECK_API_CACHE_HIT` or `MARKETCHECK_API_INFLIGHT_DEDUPE`
  - no additional outbound MarketCheck request
  - if multiple `MARKETCHECK_API_REQUEST_START` logs appear for the same value cache key during one user action, that is a regression
- trigger `Load live listings` once
- inspect logs for exactly one `MARKETCHECK_API_REQUEST_START` for `endpointType: "listings"` for that cache key
- confirm logs include:
  - `LISTINGS_LIVE_REFRESH_REQUESTED`
  - `MARKETCHECK_EXPLICIT_ACTION_ALLOWED`
- reopen the same Listings tab without changing the descriptor
- expected result:
  - `MARKETCHECK_API_CACHE_HIT` or `MARKETCHECK_API_INFLIGHT_DEDUPE`
  - no additional outbound MarketCheck request
  - for scan-only verification after deploy:
    - scan one car
    - inspect Render logs and confirm:
      - the startup log shows the expected `BACKEND_BUILD_COMMIT`
      - no `MARKETCHECK_API_REQUEST_START` appears with:
        - `sourceScreen: "scan"`
        - `reason: "scan_identify_provider_enrichment"`
      - if anything attempts to escape:
        - `MARKETCHECK_ACTION_BUDGET_EXCEEDED`
        - `MARKETCHECK_API_SKIPPED_RATE_GUARD`
    - query `/api/debug/marketcheck` and inspect the last 10 minutes grouped totals

### For Sale listing open behavior

- listing cards should open only from already-loaded listing URLs
- tapping a listing card must never:
  - call MarketCheck
  - hit backend listing refresh endpoints
  - refresh cache
  - trigger any listing reload action
- current tap implementation lives in:
  - [components/ListingCard.tsx](/Users/mattbrillman/Car_Identifier/components/ListingCard.tsx)
- current behavior:
  - validate existing loaded URL
  - log tap
  - open inside the app with `expo-web-browser`
  - fall back to `Linking.openURL(...)` only if the in-app browser fails
- current URL normalization path:
  - frontend uses `listing.listingUrl`
  - aliases preserved/mapped from:
    - `listingUrl`
    - `url`
    - `vdpUrl`
    - `dealerUrl`
    - `sourceUrl`
- current backend URL-preservation files:
  - [backend/src/providers/marketcheck/marketCheckVehicleDataProvider.ts](/Users/mattbrillman/Car_Identifier/backend/src/providers/marketcheck/marketCheckVehicleDataProvider.ts)
  - [backend/src/repositories/supabaseRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/supabaseRepositories.ts)
  - [services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/services/vehicleService.ts)
- current product/UI rule:
  - if a card has a real listing URL, it should show `View listing`
  - do not fall back to generic Google search anymore
  - stale/no-URL listing rows should not be presented as openable dealer listings

### Affiliate click tracking

- affiliate click tracking endpoint now exists:
  - `POST /api/click/listing`
- route/controller/service files:
  - [backend/src/routes/index.ts](/Users/mattbrillman/Car_Identifier/backend/src/routes/index.ts)
  - [backend/src/controllers/clickController.ts](/Users/mattbrillman/Car_Identifier/backend/src/controllers/clickController.ts)
  - [backend/src/services/listingClickService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/listingClickService.ts)
- repository wiring:
  - [backend/src/repositories/interfaces.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/interfaces.ts)
  - [backend/src/repositories/mockRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/mockRepositories.ts)
  - [backend/src/repositories/supabaseRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/supabaseRepositories.ts)
  - [backend/src/lib/repositoryRegistry.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/repositoryRegistry.ts)
- request body:
  - `listingId?: string`
  - `vehicle?: string`
  - `url: string`
  - `sessionId?: string`
- Supabase destination table:
  - `listing_clicks`
- auth behavior:
  - guests allowed
  - store `user_id` when authenticated
  - otherwise store `session_id` when available
- critical product rule:
  - click tracking must be fire-and-forget
  - logging failure must never block browser open
  - logging must not trigger MarketCheck or listing refresh
- frontend fire-and-forget helper lives in:
  - [services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/services/vehicleService.ts)
- current frontend tap logs:
  - `LISTING_CARD_TAPPED`
  - `LISTING_AFFILIATE_CLICK_TRACK_START`
  - `LISTING_AFFILIATE_CLICK_TRACK_SUCCESS`
  - `LISTING_AFFILIATE_CLICK_TRACK_FAILURE`
  - `LISTING_AFFILIATE_CLICK`
  - `LISTING_URL_OPENED`
  - `LISTING_URL_OPEN_FAILED`
  - `LISTING_URL_MISSING`
  - `LISTING_URL_INVALID`
- `LISTING_AFFILIATE_CLICK` payload now includes:
  - `listingId`
  - `vehicle`
  - `timestamp`
  - `url`
- backend smoke test already passed for this endpoint:

```bash
curl -s http://127.0.0.1:4000/api/click/listing \
  -H 'Content-Type: application/json' \
  -d '{"listingId":"test-listing","vehicle":"Test Vehicle","url":"https://example.com/listing","sessionId":"test-session"}'
```

- expected success response:
  - `{"success":true,"data":{"success":true}, ...}`

### In-app browser requirement

- listing pages should open inside the app, not jump straight to Safari/Chrome in the normal success path
- current implementation uses:
  - `expo-web-browser`
- file:
  - [components/ListingCard.tsx](/Users/mattbrillman/Car_Identifier/components/ListingCard.tsx)
- important native-module note:
  - after adding `expo-web-browser`, the app needed a fresh native rebuild/reinstall
  - if the simulator still opens an external browser after code changes, confirm the app was rebuilt with:

```bash
cd /Users/mattbrillman/Car_Identifier
npx expo run:ios
```

### Condition selector / local-only value recalc rule

- changing `Fair / Good / Excellent` must not hit backend
- changing condition must not trigger MarketCheck
- non-refresh changes now recalculate from already-loaded seeded valuation only
- only explicit `Refresh live market value` is allowed to call:
  - [services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/services/vehicleService.ts) `getValue(...)`
- current frontend logs:
  - `VALUE_LOCAL_RECALC_APPLIED`
  - `VALUE_BACKEND_REQUEST_SKIPPED_LOCAL_ONLY`
- if MarketCheck logs appear while just changing condition, that is a regression

### Simulator unlock reset procedure that actually worked

- current signed-in simulator user discovered in AsyncStorage:
  - email: `eus090474@gmail.com`
  - user id: `08cb4e24-99b5-405e-bc2a-c95cd8d8bc1c`
- backend reset script succeeded with:

```bash
cd /Users/mattbrillman/Car_Identifier/backend
npx tsx scripts/resetUserUnlocks.ts eus090474@gmail.com
```

- successful reset result returned:
  - `freeUnlocksTotal: 3`
  - `freeUnlocksUsed: 0`
  - `unlockCredits: 0`
  - `clearedVehicleUnlocks: true`
- local simulator unlock cache also had to be reset
- relevant simulator AsyncStorage path at the time of reset:
  - `/Users/mattbrillman/Library/Developer/CoreSimulator/Devices/310ABD5C-5486-4A98-959F-1CD7013A20B7/data/Containers/Data/Application/3C702B06-CAB2-4434-A112-DEC7DB74355B/Library/Application Support/com.mattbrillman.carscanr/RCTAsyncLocalStorage_V1/manifest.json`
- key reset locally:
  - `carscanr.freeUnlocks.v1:08cb4e24-99b5-405e-bc2a-c95cd8d8bc1c`
- important nuance:
  - editing that manifest with malformed JSON causes the app to redbox with:
    - `Failed to parse manifest - creating a new one`
  - if local reset is done manually, keep manifest JSON valid
- current verified post-reset simulator state:
  - `0 of 3 free Pro unlocks used`
  - `3 free Pro unlocks remaining for premium access.`

### Current backend runtime state

- backend was restarted after affiliate-click tracking changes
- active startup state at last verification:
  - `appEnv: "local"`
  - `nodeEnv: "development"`
  - `marketCheckEnabled: true`
  - `enableBackgroundMarketCheck: false`
  - provider mode: `live`
- health/click endpoint was confirmed live after restart

### Manual Search selector status

- Search no longer uses free-text year/make/model entry
- current Search flow is structured:
  - `Year`
  - `Make`
  - `Model`
  - `Trim`
- current canonical selector endpoints:
  - `GET /api/vehicle/search-options/years`
  - `GET /api/vehicle/search-options/makes?year=...`
  - `GET /api/vehicle/search-options/models?year=...&make=...`
  - `GET /api/vehicle/search-options/trims?year=...&make=...&model=...`
- frontend selector screen:
  - [app/(tabs)/search.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/search.tsx)
- backend selector stack:
  - [backend/src/routes/index.ts](/Users/mattbrillman/Car_Identifier/backend/src/routes/index.ts)
  - [backend/src/controllers/vehicleController.ts](/Users/mattbrillman/Car_Identifier/backend/src/controllers/vehicleController.ts)
  - [backend/src/services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/vehicleService.ts)
  - [backend/src/repositories/supabaseRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/supabaseRepositories.ts)
- important year-picker bug that was fixed:
  - the years endpoint had been returning only `2027`, `2026`, `2025`, `2024`
  - root cause: year options were being derived from a bad recent duplicate-heavy slice of canonical rows
  - fix: year options now derive from the full promoted canonical year span
  - last live verification:
    - endpoint returned years down through `1936`
    - simulator year picker showed a long list instead of only four years
- manual Search must not trigger MarketCheck:
  - selector endpoints query canonical data only
  - opening a selected vehicle must not auto-fetch value/listings

### Manual Search detail-image fallback policy

- manual Search / canonical-detail pages must never fall back to the generic Camaro/showroom image
- current fallback resolver file:
  - [assets/data/vehicle_image_fallbacks.ts](/Users/mattbrillman/Car_Identifier/assets/data/vehicle_image_fallbacks.ts)
- image support fields now present on `VehicleRecord`:
  - `imageUrl?: string | null`
  - `heroImageUrl?: string | null`
  - `fallbackImageUrl?: string | null`
- current image priority on the vehicle detail screen:
  1. route scanned image
  2. Garage durable image passed through the route
  3. trusted canonical/exact image
  4. curated make/model fallback
  5. body-style fallback
  6. clean neutral placeholder
- this priority is implemented across:
  - [services/offlineCanonicalService.ts](/Users/mattbrillman/Car_Identifier/services/offlineCanonicalService.ts)
  - [services/vehicleService.ts](/Users/mattbrillman/Car_Identifier/services/vehicleService.ts)
  - [app/vehicle/[id].tsx](/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx)
- current curated make/model fallbacks include:
  - `Honda CR-V`
  - `Toyota Highlander`
  - `Toyota Corolla`
  - `Ford Ranger`
  - `Mercedes-Benz S-Class`
  - `Mercedes-Benz SL-Class`
  - plus a few other mainstream entries
- current body-style fallbacks include:
  - `SUV`
  - `truck`
  - `sedan`
  - `coupe`
  - `convertible`
  - `hatchback`
  - `wagon`
  - `van`
  - `motorcycle`
- critical rule:
  - do not use provider/listing image drift for manual Search fallback imagery
  - no `listings[0].imageUrl` fallback for manual detail pages
  - no MarketCheck or paid image source should be introduced for this
- current detail log:
  - `VEHICLE_IMAGE_SOURCE_SELECTED`
- expected source values:
  - `scanned_image`
  - `garage_durable_image`
  - `canonical_image`
  - `curated_model_fallback`
  - `body_style_fallback`
  - `neutral_placeholder`
- expected behavior after this work:
  - `2015 Honda CR-V` must not show Camaro/showroom imagery
  - `Toyota Highlander` must not show Camaro/Porsche/showroom imagery
  - `Ford Ranger` should use the truck fallback if no exact image exists

### Canonical vehicle image safety system

- shared canonical vehicle imagery now has a dedicated storage/review path
- migration added:
  - [backend/supabase/migrations/024_canonical_vehicle_images.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/024_canonical_vehicle_images.sql)
- table:
  - `public.canonical_vehicle_images`
- key rules:
  - user scan images are never globally shared by default
  - `user_scan` image candidates start as:
    - `status = 'pending'`
    - `safety_status = 'unreviewed'` or `manual_review`
    - `is_primary = false`
  - only images with:
    - `status = 'approved'`
    - `safety_status = 'passed'`
    can be exported or shown cross-user as canonical/shared images
  - pending/rejected/quarantined user images must not be shown to other users
  - if in doubt, show curated fallback or neutral placeholder instead

- repository support added in:
  - [backend/src/repositories/interfaces.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/interfaces.ts)
  - [backend/src/repositories/supabaseRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/supabaseRepositories.ts)
  - [backend/src/repositories/mockRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/mockRepositories.ts)
  - [backend/src/repositories/mockDatabase.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/mockDatabase.ts)
  - [backend/src/lib/repositoryRegistry.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/repositoryRegistry.ts)

- safety helper:
  - [backend/src/lib/vehicleImageSafety.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/vehicleImageSafety.ts)
- env flag:
  - `ENABLE_USER_IMAGE_AUTO_APPROVAL`
  - default is effectively `false`
  - if false, user scan candidates stay pending/manual-review even when clustering/confidence is strong

- conservative auto-approval rules:
  - successful scan context only
  - confidence `>= 0.90`
  - no badge/make/model conflict
  - cluster support:
    - `scan_count >= 3` or
    - `unique_user_count >= 2`
  - image dimensions must be reasonable
  - source must be `user_scan` or `curated`
  - without `ENABLE_USER_IMAGE_AUTO_APPROVAL=true`, `user_scan` images should not auto-promote globally

- v1 image quality score helper is also in:
  - [backend/src/lib/vehicleImageSafety.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/vehicleImageSafety.ts)
- rough scoring inputs:
  - scanned source present
  - high confidence
  - badge text support
  - cluster support
  - reasonable aspect ratio/dimensions
  - penalties for tiny images or badge conflict

- clustering now saves image candidates when safe to record:
  - [backend/src/services/photoClusterService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/photoClusterService.ts)
- current candidate image logs:
  - `CANONICAL_IMAGE_CANDIDATE_SAVED`
  - `CANONICAL_IMAGE_PENDING_REVIEW`
  - `CANONICAL_IMAGE_AUTO_APPROVED`
  - `CANONICAL_IMAGE_QUARANTINED`

- offline canonical export support:
  - [backend/scripts/exportOfflineCanonical.ts](/Users/mattbrillman/Car_Identifier/backend/scripts/exportOfflineCanonical.ts)
  - only exports canonical image metadata when:
    - `status = 'approved'`
    - `safety_status = 'passed'`
  - pending user images must never be exported into the bundled offline dataset

- current hero image priority on detail pages:
  1. route scanned image from the current scan
  2. Garage durable / recent user image
  3. approved canonical image from offline/canonical data
  4. curated local fallback
  5. neutral body-style placeholder
  6. `Vehicle image unavailable`

- explicit exclusion rule:
  - MarketCheck/provider/listing images must not be used for manual/offline/detail hero image fallback
  - frontend detail resolution now avoids provider/live vehicle `imageUrl` as a shared hero source
  - provider/listing images may still exist in listing cards, but not in the manual/offline hero path

- current detail image logs:
  - `VEHICLE_IMAGE_SOURCE_SELECTED`
  - `VEHICLE_IMAGE_LOAD_FAILED`
  - `VEHICLE_IMAGE_FALLBACK_ADVANCED`
  - `VEHICLE_IMAGE_PLACEHOLDER_RENDERED`

- future admin review path:
  - admin/ops should review pending `canonical_vehicle_images`
  - approved images can then be marked primary for a `canonical_key`
  - only one approved primary per canonical key should exist at a time

### v1 photo clustering / dedupe

- lightweight photo clustering now exists for repeat-scan stability and duplicate-noise reduction
- this is intentionally conservative v1:
  - perceptual hash only
  - no embeddings
  - no multi-angle re-identification
  - false merges are treated as worse than duplicate clusters
- schema migration added:
  - [backend/supabase/migrations/023_vehicle_photo_clusters.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/023_vehicle_photo_clusters.sql)
- new tables:
  - `public.vehicle_photo_clusters`
  - `public.vehicle_photo_cluster_members`
- current schema shape is intentionally based on the existing shipped v1 implementation, not a renamed rewrite:
  - cluster row keeps `cluster_key` + `representative_visual_hash`
  - hardening columns now also include:
    - `canonical_scan_id`
    - `canonical_photo_hash`
    - `canonical_make`
    - `canonical_model`
    - `canonical_badge`
    - `canonical_year`
    - `canonical_match_strength`
    - `canonical_hamming_distance`
    - `member_count`
  - member row now also includes:
    - `badge`
    - `hamming_distance`
    - `match_strength`
- safety constraints/indexes now include:
  - exact-hash uniqueness on `representative_visual_hash`
  - unique `(cluster_id, scan_id)` membership
  - non-negative count / hamming checks
  - hash-length checks
  - `match_strength in ('exact','strong','possible')`
  - RLS enabled, with no public write policy added
  - service-role backend path is still the intended writer
- stored data is privacy-conscious:
  - visual hashes
  - scan id
  - image key
  - coarse vehicle identity
  - dimensions
  - user id only in the same internal sense already used elsewhere
  - no raw image bytes are stored

- hash helper file:
  - [backend/src/lib/photoClusterHash.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/photoClusterHash.ts)
- thresholds:
  - exact match: Hamming distance `0`
  - strong similar: distance `<= 6` for 16-char hex hashes
  - possible similar: distance `<= 10` only when normalized make/model already agree
  - anything broader should create a new cluster, not merge
  - note:
    - distance `7-10` is intentionally rejected unless make/model already normalize the same
    - missing badge is not treated as a conflict
    - explicit make/model conflict always wins over hash similarity

- clustering service:
  - [backend/src/services/photoClusterService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/photoClusterService.ts)
- repository plumbing added in:
  - [backend/src/repositories/interfaces.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/interfaces.ts)
  - [backend/src/repositories/supabaseRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/supabaseRepositories.ts)
  - [backend/src/repositories/mockRepositories.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/mockRepositories.ts)
  - [backend/src/repositories/mockDatabase.ts](/Users/mattbrillman/Car_Identifier/backend/src/repositories/mockDatabase.ts)
  - [backend/src/lib/repositoryRegistry.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/repositoryRegistry.ts)

- current scan-flow behavior:
  - after normalized AI result exists, scan flow checks cluster candidates by `visualHash`
  - if a strong cluster match exists with canonical identity, scan flow can bias the normalized identity before catalog matching
  - if cluster identity conflicts with readable badge/model text, the hint is rejected
  - clustering must never call providers and must never block scan result delivery
  - after successful scan persistence, the cluster write runs fire-and-forget
  - clustering failures are swallowed and logged, not thrown to the user path
  - hint ordering is intentionally conservative:
    1. normalize identity
    2. fetch recent DB-only candidates
    3. compute Hamming distance
    4. reject identity/badge conflicts first
    5. apply exact/strong/possible thresholds
    6. use the result only as a hint before catalog resolution

- race / idempotency protections:
  - `createCluster(...)`
    - idempotent on exact representative hash
    - returns existing cluster on conflict instead of forking
  - `addMember(...)`
    - duplicate-safe on `(cluster_id, scan_id)`
    - duplicate insert attempts must not throw
  - cluster stats increment only after a new membership is actually recorded
  - canonical identity updates are deterministic and never intentionally downgrade:
    - exact > strong > possible
    - lower Hamming distance wins inside the same class
    - richer metadata wins next
    - newer scan timestamp is only the last tiebreaker

- clustering logs:
  - `PHOTO_CLUSTER_LOOKUP_START`
  - `PHOTO_CLUSTER_CANDIDATE_FOUND`
  - `PHOTO_CLUSTER_MATCH_CONFIRMED`
  - `PHOTO_CLUSTER_MATCH_REJECTED`
  - `PHOTO_CLUSTER_CREATED`
  - `PHOTO_CLUSTER_MEMBER_ADDED`
  - `PHOTO_CLUSTER_CANONICAL_UPDATED`
  - `PHOTO_CLUSTER_SKIPPED`
  - `PHOTO_CLUSTER_FAILURE`
  - `PHOTO_CLUSTER_IDENTITY_HINT_USED`
  - `PHOTO_CLUSTER_HINT_REJECTED_BADGE_CONFLICT`
- current log payload improvements:
  - lookup:
    - `scanId`
    - `phase`
    - `hashPrefix`
    - `candidateCount`
  - candidate:
    - `clusterId`
    - `distance`
    - `similarity`
    - `matchStrength`
  - rejection:
    - `reason`
    - normalized source/candidate identities
  - failure:
    - `operation`
    - safe serialized error

- what v1 clustering does:
  - groups very similar repeated scan photos
  - preserves a representative visual hash and coarse canonical identity
  - provides a conservative identity hint for future repeat scans
  - increments scan/user counters on clusters

- what v1 clustering does not do yet:
  - no ML embeddings
  - no robust multi-angle vehicle re-ID
  - no public API exposure
  - no user-facing cluster UI
  - no SQL-side Hamming-distance search yet
  - no prefix-hash narrowing in SQL yet
  - no cluster split / merge admin tooling yet

- next likely future upgrade:
  - SQL Hamming-distance / prefix-hash candidate narrowing
  - improved indexing strategy as volume grows
  - hybrid perceptual-hash + embedding scoring (`pgvector`) once cost/ops justify it
  - multi-angle vehicle re-identification
  - cluster split / merge and debugging tools
