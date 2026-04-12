# CarScanr Handoff For ChatGPT

Update this file after meaningful product, auth, environment, deployment, or TestFlight changes so the next session starts from the current truth.

## Project Summary

CarScanr contains two coordinated codebases in one repo:

- Expo + React Native mobile app at the repo root
- Node.js + TypeScript + Express backend in `backend/`

Product goal:

- User takes or uploads a photo of a car or motorcycle
- AI identifies likely year, make, and model
- App shows specs, value, listings, and Garage history
- Free vs Pro subscription model gates premium access

## Current State Snapshot

### Mobile / Expo

- The app uses dynamic Expo config through [app.config.ts](/Users/mattbrillman/Car_Identifier/app.config.ts)
- EAS is linked to the existing Expo project `@eus090474/carscanr`
- The active EAS project ID is `6e7cd5a8-7f65-44ce-88a8-3d1a3f589cc6`
- Expo Updates is configured manually for bare workflow
- `runtimeVersion` is manually pinned to `"1.0.0"` because bare workflow cannot use runtime policy objects
- The app icon is currently sourced from [icon-1024.png](/Users/mattbrillman/Car_Identifier/icon-1024.png)
- The iOS native icon asset at [ios/CarIdentifier/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png](/Users/mattbrillman/Car_Identifier/ios/CarIdentifier/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png) has been replaced with that same file

### Backend / Render

- Backend env parsing was hardened in [backend/src/config/env.ts](/Users/mattbrillman/Car_Identifier/backend/src/config/env.ts)
- Render preview config is defined in [render.yaml](/Users/mattbrillman/Car_Identifier/render.yaml)
- Hosted preview/production deploys now fail fast when unsafe env values are set
- Startup logs include non-secret env diagnostics for hosted verification

### Release / TestFlight

- TestFlight builds were previously white-screening because production env values were not present in EAS and startup/session errors were being swallowed
- Root startup config validation and visible fallback UI are now in place
- Startup route restoration no longer fails silently to `null`
- The onboarding screen still has an unresolved production/TestFlight issue: `Start Free` and `Sign In` were reported as visually present but non-functional on device even after multiple tap hardening passes
- The latest attempted fix for onboarding moved the CTAs outside the main scroll area and changed navigation to explicit top-level `/auth` routing

## Important Files

### Mobile

- [app.config.ts](/Users/mattbrillman/Car_Identifier/app.config.ts)
- [eas.json](/Users/mattbrillman/Car_Identifier/eas.json)
- [app/_layout.tsx](/Users/mattbrillman/Car_Identifier/app/_layout.tsx)
- [app/index.tsx](/Users/mattbrillman/Car_Identifier/app/index.tsx)
- [app/(onboarding)/index.tsx](/Users/mattbrillman/Car_Identifier/app/(onboarding)/index.tsx)
- [app/(auth)/index.tsx](/Users/mattbrillman/Car_Identifier/app/(auth)/index.tsx)
- [app/auth.tsx](/Users/mattbrillman/Car_Identifier/app/auth.tsx)
- [app/onboarding.tsx](/Users/mattbrillman/Car_Identifier/app/onboarding.tsx)
- [app/(tabs)/profile.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/profile.tsx)
- [app/(tabs)/scan.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/scan.tsx)
- [app/paywall.tsx](/Users/mattbrillman/Car_Identifier/app/paywall.tsx)
- [app/scan/result.tsx](/Users/mattbrillman/Car_Identifier/app/scan/result.tsx)
- [components/AppContainer.tsx](/Users/mattbrillman/Car_Identifier/components/AppContainer.tsx)
- [components/PrimaryButton.tsx](/Users/mattbrillman/Car_Identifier/components/PrimaryButton.tsx)
- [components/BackButton.tsx](/Users/mattbrillman/Car_Identifier/components/BackButton.tsx)
- [components/CandidateMatchCard.tsx](/Users/mattbrillman/Car_Identifier/components/CandidateMatchCard.tsx)
- [components/ListingCard.tsx](/Users/mattbrillman/Car_Identifier/components/ListingCard.tsx)
- [components/PaywallCard.tsx](/Users/mattbrillman/Car_Identifier/components/PaywallCard.tsx)
- [components/ProLockCard.tsx](/Users/mattbrillman/Car_Identifier/components/ProLockCard.tsx)
- [components/SamplePhotoPickerSheet.tsx](/Users/mattbrillman/Car_Identifier/components/SamplePhotoPickerSheet.tsx)
- [components/ScanUsageMeter.tsx](/Users/mattbrillman/Car_Identifier/components/ScanUsageMeter.tsx)
- [components/SegmentedTabBar.tsx](/Users/mattbrillman/Car_Identifier/components/SegmentedTabBar.tsx)
- [components/VehicleCard.tsx](/Users/mattbrillman/Car_Identifier/components/VehicleCard.tsx)
- [lib/env.ts](/Users/mattbrillman/Car_Identifier/lib/env.ts)
- [lib/supabase.ts](/Users/mattbrillman/Car_Identifier/lib/supabase.ts)
- [services/authService.ts](/Users/mattbrillman/Car_Identifier/services/authService.ts)
- [services/apiClient.ts](/Users/mattbrillman/Car_Identifier/services/apiClient.ts)
- [.env.example](/Users/mattbrillman/Car_Identifier/.env.example)

### Backend

- [backend/src/config/env.ts](/Users/mattbrillman/Car_Identifier/backend/src/config/env.ts)
- [backend/src/server.ts](/Users/mattbrillman/Car_Identifier/backend/src/server.ts)
- [backend/src/app.ts](/Users/mattbrillman/Car_Identifier/backend/src/app.ts)
- [backend/src/middleware/auth.ts](/Users/mattbrillman/Car_Identifier/backend/src/middleware/auth.ts)
- [backend/src/lib/auth.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/auth.ts)
- [backend/src/lib/providerRegistry.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/providerRegistry.ts)
- [backend/src/lib/repositoryRegistry.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/repositoryRegistry.ts)
- [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts)
- [backend/Dockerfile](/Users/mattbrillman/Car_Identifier/backend/Dockerfile)
- [backend/.env.example](/Users/mattbrillman/Car_Identifier/backend/.env.example)
- [render.yaml](/Users/mattbrillman/Car_Identifier/render.yaml)

## Environment Model

### Local

Use when developing against your laptop:

- Mobile: `EXPO_PUBLIC_APP_ENV=local`
- Backend: `APP_ENV=local`
- `EXPO_PUBLIC_API_BASE_URL` may be local HTTP
- `ALLOW_MOCK_FALLBACKS=true` is allowed if needed
- `AUTH_DEV_BYPASS_ENABLED=true` is allowed only here
- `EXPO_PUBLIC_PLAN_OVERRIDE` may be used only here

### Preview

Use when testing a public backend with a preview app build:

- Mobile: `EXPO_PUBLIC_APP_ENV=preview`
- Backend: `APP_ENV=preview`
- `EXPO_PUBLIC_API_BASE_URL` must be public HTTPS
- Real Supabase mobile auth is required
- `ALLOW_MOCK_FALLBACKS=false`
- `AUTH_DEV_BYPASS_ENABLED=false`
- Mock providers are not allowed

### Production

Use for launch-ready hosted behavior:

- Mobile: `EXPO_PUBLIC_APP_ENV=production`
- Backend: `APP_ENV=production`
- Same hosted assumptions as preview, but with production credentials and release app metadata

## Mobile Config Truth

### Current Expo config

[app.config.ts](/Users/mattbrillman/Car_Identifier/app.config.ts) currently resolves:

- `slug: "carscanr"`
- `scheme: "carscanr"`
- `version: "1.0.0"`
- `icon: "./icon-1024.png"`
- `runtimeVersion: "1.0.0"`
- `updates.url: https://u.expo.dev/6e7cd5a8-7f65-44ce-88a8-3d1a3f589cc6`
- `extra.eas.projectId = 6e7cd5a8-7f65-44ce-88a8-3d1a3f589cc6`

It also varies:

- app name between local/preview via `EXPO_PUBLIC_APP_ENV`
- iOS bundle identifier between preview and non-preview
- iOS build number via `EXPO_PUBLIC_IOS_BUILD_NUMBER`

### EAS config

[eas.json](/Users/mattbrillman/Car_Identifier/eas.json) currently:

- uses remote app version source
- sets `EXPO_PUBLIC_APP_ENV=local` for `development`
- sets `EXPO_PUBLIC_APP_ENV=preview` for `preview`
- sets `EXPO_PUBLIC_APP_ENV=production` for `production`
- no longer includes empty `EXPO_PUBLIC_PLAN_OVERRIDE` values

### Bare workflow updates config

Because the app is in bare workflow:

- `runtimeVersion` must stay a manual string
- policy-based `runtimeVersion` objects are not valid here
- [ios/CarIdentifier/Supporting/Expo.plist](/Users/mattbrillman/Car_Identifier/ios/CarIdentifier/Supporting/Expo.plist) was updated by `eas update:configure`

## Production Env Handling

### Required mobile env vars

The app now expects these public env vars to exist for preview/production builds:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Important:

- Local [`.env`](/Users/mattbrillman/Car_Identifier/.env) is not enough for TestFlight or EAS production builds
- These must be set in the Expo/EAS environment for the relevant build environment

### Mobile startup validation

[lib/env.ts](/Users/mattbrillman/Car_Identifier/lib/env.ts) now:

- normalizes `EXPO_PUBLIC_APP_ENV`
- validates API base URL format
- requires HTTPS for preview/production builds
- validates that Supabase mobile config is not placeholder data
- throws a visible startup error instead of failing silently

[app/_layout.tsx](/Users/mattbrillman/Car_Identifier/app/_layout.tsx) now:

- logs `ENV CHECK` with non-secret values
- throws if `EXPO_PUBLIC_API_BASE_URL` is missing
- calls `assertMobileStartupConfig()`
- renders a visible `Configuration error - missing API settings` screen if config is invalid
- wraps the app in [ErrorBoundary](/Users/mattbrillman/Car_Identifier/components/ErrorBoundary.tsx)

[app/index.tsx](/Users/mattbrillman/Car_Identifier/app/index.tsx) now:

- restores onboarding/session state asynchronously
- shows a visible loading card while restoring
- shows a visible `Startup error` card if initialization fails
- logs startup route restore failures
- routes to explicit top-level `/auth` or `/onboarding` instead of grouped route paths

## Auth And Routing State

### Current auth behavior

- Mobile auth uses the real Supabase client
- Sign in uses `supabase.auth.signInWithPassword`
- Sign up uses `supabase.auth.signUp`
- Session restore uses `supabase.auth.getSession`
- Sign out uses `supabase.auth.signOut`
- Auth state is persisted via AsyncStorage-backed Supabase storage

### Explicit route aliases

Two top-level alias routes now exist:

- [app/auth.tsx](/Users/mattbrillman/Car_Identifier/app/auth.tsx)
- [app/onboarding.tsx](/Users/mattbrillman/Car_Identifier/app/onboarding.tsx)

These were added because grouped route navigation such as `/(auth)` and `/(onboarding)` was suspected to be flaky in release/TestFlight flows when routing from startup or onboarding.

## Onboarding Status

### Current onboarding implementation

[app/(onboarding)/index.tsx](/Users/mattbrillman/Car_Identifier/app/(onboarding)/index.tsx) currently:

- uses `AppContainer scroll={false}`
- renders the feature cards in a dedicated `ScrollView`
- renders the CTA area outside that `ScrollView`
- uses local `TouchableOpacity` controls for `Start Free` and `Sign In`
- sets the small top label to `CarScanr Pro`
- keeps the footer in a separate wrapper with `pointerEvents="none"`
- logs each CTA tap plus pre-navigation events
- writes `hasSeenOnboarding=true` to AsyncStorage before routing
- navigates to `/auth` with `mode=sign-up` or `mode=sign-in`

### Exact CTA tap path

`Start Free`:

- logs `[tap] onboarding-start-free-button`
- logs `[tap] onboarding-start-free`
- attempts to persist `hasSeenOnboarding`
- logs `[onboarding] navigating to auth`
- calls `router.replace({ pathname: "/auth", params: { mode: "sign-up" } })`

`Sign In`:

- logs `[tap] onboarding-sign-in-button`
- logs `[tap] onboarding-sign-in`
- attempts to persist `hasSeenOnboarding`
- logs `[onboarding] navigating to auth`
- calls `router.replace({ pathname: "/auth", params: { mode: "sign-in" } })`

### Current unresolved issue

Despite multiple fixes, the user still reported that `Start Free` and `Sign In` did nothing in TestFlight on a real iPhone.

Work already attempted:

- shared button component hardened from `Pressable` to `TouchableOpacity`
- onboarding CTAs moved out of the main scroll area
- CTA section isolated with explicit spacing and z-order
- footer made non-interactive via `pointerEvents="none"`
- grouped auth route replaced with explicit top-level `/auth`
- tap logging added before async work and before navigation

This issue is still considered open until a fresh release build confirms the new explicit-route version works on device.

## Tap Audit State

A broad tap audit was done across the app.

### Hardened components

These components were changed from `Pressable` to `TouchableOpacity` or equivalent safer tap handling:

- [components/PrimaryButton.tsx](/Users/mattbrillman/Car_Identifier/components/PrimaryButton.tsx)
- [components/BackButton.tsx](/Users/mattbrillman/Car_Identifier/components/BackButton.tsx)
- [components/CandidateMatchCard.tsx](/Users/mattbrillman/Car_Identifier/components/CandidateMatchCard.tsx)
- [components/VehicleCard.tsx](/Users/mattbrillman/Car_Identifier/components/VehicleCard.tsx)
- [components/PaywallCard.tsx](/Users/mattbrillman/Car_Identifier/components/PaywallCard.tsx)
- [components/ProLockCard.tsx](/Users/mattbrillman/Car_Identifier/components/ProLockCard.tsx)
- [components/ScanUsageMeter.tsx](/Users/mattbrillman/Car_Identifier/components/ScanUsageMeter.tsx)
- [components/SegmentedTabBar.tsx](/Users/mattbrillman/Car_Identifier/components/SegmentedTabBar.tsx)
- [components/SamplePhotoPickerSheet.tsx](/Users/mattbrillman/Car_Identifier/components/SamplePhotoPickerSheet.tsx)

### Other tap fixes

- [components/AppContainer.tsx](/Users/mattbrillman/Car_Identifier/components/AppContainer.tsx) now uses `keyboardShouldPersistTaps="handled"` when scrollable
- [app/(auth)/index.tsx](/Users/mattbrillman/Car_Identifier/app/(auth)/index.tsx) moved fragile text taps to explicit touchables
- [app/(tabs)/profile.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/profile.tsx) moved fragile text taps to explicit touchables
- [components/ListingCard.tsx](/Users/mattbrillman/Car_Identifier/components/ListingCard.tsx) was changed from a dead tappable card to a plain `View` because it had no `onPress`

### Remaining lower-risk tap surfaces

Some controls still use `Pressable` in less critical paths, including local-state toggles and non-launch actions. Those were not the primary reported TestFlight failure.

## Backend Config Truth

### Render config

[render.yaml](/Users/mattbrillman/Car_Identifier/render.yaml) currently defines preview-style hosted values:

- `APP_ENV=preview`
- `NODE_ENV=production`
- `ALLOW_MOCK_FALLBACKS="false"`
- `AUTH_DEV_BYPASS_ENABLED="false"`
- `VISION_PROVIDER=openai`
- all vehicle providers set to `marketcheck`

### Boolean env parsing fix

[backend/src/config/env.ts](/Users/mattbrillman/Car_Identifier/backend/src/config/env.ts) no longer uses `z.coerce.boolean()` for critical booleans.

Instead it uses a custom parser so:

- `"false"` parses to `false`
- `"0"` parses to `false`
- unset values do not accidentally become `true`

This fixed the earlier Render startup bug where string env values such as `"false"` were being treated as truthy.

### Backend startup diagnostics

Backend startup now logs:

- `APP_ENV`
- `NODE_ENV`
- parsed `AUTH_DEV_BYPASS_ENABLED`
- parsed `ALLOW_MOCK_FALLBACKS`

No secrets are logged.

### Hosted guardrails

Preview/production-style backend startup now fails if:

- `AUTH_DEV_BYPASS_ENABLED=true`
- `ALLOW_MOCK_FALLBACKS=true`
- `SUPABASE_URL` is missing
- `SUPABASE_SERVICE_ROLE_KEY` is missing
- `SUPABASE_JWT_SECRET` is missing
- `VISION_PROVIDER=mock`
- a hosted vehicle provider is still `mock`
- MarketCheck is enabled without `MARKETCHECK_API_KEY`
- OpenAI vision is enabled without `OPENAI_API_KEY`

## Icon State

### Current icon files

- Source image provided by user: [Icon.png](/Users/mattbrillman/Car_Identifier/Icon.png)
- Current app icon file in use: [icon-1024.png](/Users/mattbrillman/Car_Identifier/icon-1024.png)
- Intermediate files also exist:
  - [assets/app-icon-clean.png](/Users/mattbrillman/Car_Identifier/assets/app-icon-clean.png)
  - [icon-cropped-source.png](/Users/mattbrillman/Car_Identifier/icon-cropped-source.png)
  - [icon-safe-crop.png](/Users/mattbrillman/Car_Identifier/icon-safe-crop.png)

### Important context

The original [Icon.png](/Users/mattbrillman/Car_Identifier/Icon.png) had built-in white margin. `icon-1024.png` was created by cropping and scaling the existing image rather than redesigning it.

If the icon still looks wrong in a future build, the next debugging target should be the asset artwork itself or additional native icon slots, not the Expo config path, because the config and the primary 1024 native asset have already been updated.

## Useful Commands

### Mobile

```bash
npm start
```

### Backend

```bash
cd backend
npm run dev
```

### Typechecks

```bash
npm run typecheck
cd backend && npm run typecheck
```

### Backend build

```bash
cd backend && npm run build
```

### EAS build

```bash
eas build -p ios
```

### EAS submit

```bash
eas submit -p ios
```

## Most Important Open Items

- Verify whether the latest explicit `/auth` onboarding navigation fix actually resolves the broken TestFlight CTA issue on device
- If onboarding is still broken after a fresh build, inspect release logs from the phone for the added onboarding tap messages to determine whether taps fire and navigation no-ops, or whether touches never reach the handlers
- RevenueCat / StoreKit purchase flow is still not truly wired for launch-grade subscriptions
- Production monitoring and crash reporting are still missing
- Final end-to-end release validation on real devices is still needed
