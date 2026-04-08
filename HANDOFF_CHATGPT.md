# CarScanr Handoff For ChatGPT

Update this file after meaningful product, auth, environment, backend, or deployment changes so the next session starts from the current truth.

## Project Summary

CarScanr contains two coordinated codebases in one repo:

- Expo + React Native mobile app at the repo root
- Node.js + TypeScript + Express backend in `backend/`

Product goal:

- User takes or uploads a photo of a car or motorcycle
- AI identifies likely year, make, and model
- App shows specs, value, listings, and Garage history
- Free vs Pro subscription model gates premium access

## Current Launch-Prep State

The repo is now set up for a production-like preview flow instead of a laptop-only dev loop.

### What is now true

- Mobile auth now uses real Supabase email/password auth by default
- Supabase mobile sessions persist and restore on app launch
- Backend requests use real bearer tokens from the mobile Supabase session
- Shared mobile API client blocks protected requests when signed out
- Mobile environment handling now distinguishes `local`, `preview`, and `production`
- `EXPO_PUBLIC_PLAN_OVERRIDE` is now local-only and ignored outside local mode
- Preview/production-style mobile builds now expect a public HTTPS backend URL
- Backend environment handling now distinguishes `APP_ENV=local|preview|production`
- Backend startup now fails fast for unsafe preview/production configs
- Backend startup logs and `/health` expose non-secret diagnostics for hosted verification
- Backend mock fallbacks are now local-only and explicitly gated by env
- Dev auth bypass is now local-only and blocked outside local mode
- Scan flow no longer defaults to a mock-only path for normal scans
- Backend tests were updated to use real image buffers so the scan path exercises actual preprocessing
- EAS profiles now drive environment selection instead of requiring source edits

## Environment Model

### Local

Use when developing against your laptop:

- Mobile: `EXPO_PUBLIC_APP_ENV=local`
- Backend: `APP_ENV=local`
- `EXPO_PUBLIC_API_BASE_URL` may be `http://localhost:4000` or LAN IP
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
- Same hosted assumptions as preview, but with production credentials and app metadata

## Important Files

### Mobile

- [app.config.ts](/Users/mattbrillman/Car_Identifier/app.config.ts)
- [eas.json](/Users/mattbrillman/Car_Identifier/eas.json)
- [app/(auth)/index.tsx](/Users/mattbrillman/Car_Identifier/app/(auth)/index.tsx)
- [app/(tabs)/profile.tsx](/Users/mattbrillman/Car_Identifier/app/(tabs)/profile.tsx)
- [lib/env.ts](/Users/mattbrillman/Car_Identifier/lib/env.ts)
- [lib/supabase.ts](/Users/mattbrillman/Car_Identifier/lib/supabase.ts)
- [services/authService.ts](/Users/mattbrillman/Car_Identifier/services/authService.ts)
- [services/apiClient.ts](/Users/mattbrillman/Car_Identifier/services/apiClient.ts)
- [services/scanService.ts](/Users/mattbrillman/Car_Identifier/services/scanService.ts)
- [services/subscriptionService.ts](/Users/mattbrillman/Car_Identifier/services/subscriptionService.ts)
- [features/subscription/SubscriptionProvider.tsx](/Users/mattbrillman/Car_Identifier/features/subscription/SubscriptionProvider.tsx)
- [features/subscription/planOverride.ts](/Users/mattbrillman/Car_Identifier/features/subscription/planOverride.ts)
- [.env.example](/Users/mattbrillman/Car_Identifier/.env.example)

### Backend

- [backend/src/config/env.ts](/Users/mattbrillman/Car_Identifier/backend/src/config/env.ts)
- [backend/src/server.ts](/Users/mattbrillman/Car_Identifier/backend/src/server.ts)
- [backend/src/app.ts](/Users/mattbrillman/Car_Identifier/backend/src/app.ts)
- [backend/src/middleware/auth.ts](/Users/mattbrillman/Car_Identifier/backend/src/middleware/auth.ts)
- [backend/src/lib/auth.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/auth.ts)
- [backend/src/lib/repositoryRegistry.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/repositoryRegistry.ts)
- [backend/src/lib/providerRegistry.ts](/Users/mattbrillman/Car_Identifier/backend/src/lib/providerRegistry.ts)
- [backend/src/services/scanService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/scanService.ts)
- [backend/src/services/usageService.ts](/Users/mattbrillman/Car_Identifier/backend/src/services/usageService.ts)
- [backend/Dockerfile](/Users/mattbrillman/Car_Identifier/backend/Dockerfile)
- [backend/.env.example](/Users/mattbrillman/Car_Identifier/backend/.env.example)
- [render.yaml](/Users/mattbrillman/Car_Identifier/render.yaml)

## Current API / Auth Behavior

- `/api/*` routes still require auth
- In local mode, dev bypass tokens can still work if `AUTH_DEV_BYPASS_ENABLED=true`
- In preview/production-style mode, backend auth expects real Supabase bearer tokens
- If Supabase auth/persistence config is missing in preview/production-style mode, backend startup now fails fast instead of drifting into a fake-safe mode
- Signed-out mobile users now stop before protected requests are sent
- Profile screen still shows lightweight debug info such as whether a token is present and which API base URL is in use

## Backend Deployment Readiness

### Public deploy path

The intended hosted path is:

1. Deploy `backend/` using [render.yaml](/Users/mattbrillman/Car_Identifier/render.yaml)
2. Fill env vars from [backend/.env.example](/Users/mattbrillman/Car_Identifier/backend/.env.example)
3. Verify [backend health](/Users/mattbrillman/Car_Identifier/backend/src/app.ts) through `/health`
4. Point mobile `EXPO_PUBLIC_API_BASE_URL` to that public HTTPS URL
5. Build a preview app with EAS

### Startup diagnostics

Startup logs and `/health` now expose:

- `NODE_ENV`
- `APP_ENV`
- `allowMockFallbacks`
- `authDevBypassEnabled`
- `supabaseConfigured`
- `openAIConfigured`
- `visionProvider`
- active vehicle provider selection
- whether mock repositories are active

No secrets are logged.

### Guardrails now enforced

Preview/production-style backend startup fails if:

- `SUPABASE_URL` is missing
- `SUPABASE_SERVICE_ROLE_KEY` is missing
- `SUPABASE_JWT_SECRET` is missing
- `AUTH_DEV_BYPASS_ENABLED=true`
- `ALLOW_MOCK_FALLBACKS=true`
- `VISION_PROVIDER=mock`
- any vehicle provider is `mock`
- MarketCheck is selected without `MARKETCHECK_API_KEY`
- OpenAI vision is selected without `OPENAI_API_KEY`

## Mobile Auth State

### Current behavior

- `authService` now uses the real Supabase client instead of local synthetic `dev-session:*` tokens
- Sign in uses `supabase.auth.signInWithPassword`
- Sign up uses `supabase.auth.signUp`
- Session restore uses `supabase.auth.getSession`
- Sign out uses `supabase.auth.signOut`
- Supabase auth storage is backed by AsyncStorage
- Session changes reset local scan/subscription caches

### Important limitation

If your Supabase project requires email confirmation on sign-up, a new account may not get an immediate session. The current UI handles this honestly by surfacing a confirmation message instead of pretending the account is signed in.

## Subscription State

- Subscription status scaffolding still exists
- StoreKit / RevenueCat is still not wired
- Purchase and restore actions are now explicitly honest placeholders instead of syncing fake dev receipts
- Cancel still calls the backend subscription cancel route
- `EXPO_PUBLIC_PLAN_OVERRIDE` remains available for local-only UI testing

## OpenAI / Vision State

- Normal scan flow no longer defaults to a mock-only code path
- Scan requests now run through the main cached/provider-backed pipeline
- In local mode, mock fallback is still allowed when `ALLOW_MOCK_FALLBACKS=true`
- In preview/production-style mode, provider failures now surface as real failures instead of silently downgrading to mock
- OpenAI quota/billing problems are still a real preview/launch blocker if `VISION_PROVIDER=openai`

## Preview / Live-Like Testing Path

Use this flow for realistic testing:

1. Deploy the backend publicly with Render
2. Set hosted backend env vars:
   - `APP_ENV=preview`
   - `NODE_ENV=production`
   - `ALLOW_MOCK_FALLBACKS=false`
   - `AUTH_DEV_BYPASS_ENABLED=false`
   - real `SUPABASE_*`
   - real `OPENAI_API_KEY`
   - real `MARKETCHECK_API_KEY`
3. Confirm `/health`
4. Set mobile env vars:
   - `EXPO_PUBLIC_APP_ENV=preview`
   - `EXPO_PUBLIC_API_BASE_URL=https://your-public-backend`
   - `EXPO_PUBLIC_SUPABASE_URL=...`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY=...`
5. Build:
   - `npm run eas:build:preview`
6. Install the preview build on device
7. Sign in with a real Supabase-backed account
8. Exercise scan, usage, garage, listings, and auth flows against the hosted backend

## Local Run Commands

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

### Backend tests

```bash
cd backend
npm test
```

## Remaining True Launch Blockers

- StoreKit / RevenueCat integration is still missing
- App Store purchase verification is not truly live
- OpenAI billing/quota must be healthy for real hosted scan behavior
- Render or another public backend host still has to be configured with real env vars
- Production monitoring, analytics, and crash reporting are still not wired
- Final release validation on real devices/TestFlight still remains

## Most Recent Launch-Prep Upgrade

This pass implemented:

- mobile env separation via `EXPO_PUBLIC_APP_ENV`
- backend env separation via `APP_ENV`
- real Supabase mobile auth/session handling
- protected-request enforcement in the shared API client
- local-only dev plan override behavior
- stricter backend startup validation
- hosted backend diagnostics through startup logs and `/health`
- preview/production guardrails against mock/dev auth fallbacks
- honest subscription placeholder behavior
- EAS preview/production env-driven readiness
