# CarScanr

CarScanr is an iPhone-first Expo + React Native app plus a Node/TypeScript backend for vehicle identification, pricing, listings, Garage saves, and future subscription access.

## Stack

- Expo + React Native + TypeScript
- Expo Router
- Supabase auth + backend persistence
- Node + TypeScript + Express backend in `backend/`
- EAS build profiles for local dev, preview, and production-style builds
- Render blueprint and Docker scaffolding for public backend deployment

## Environment Modes

### Local

- Mobile env: `EXPO_PUBLIC_APP_ENV=local`
- Backend env: `APP_ENV=local`
- `EXPO_PUBLIC_API_BASE_URL` can be `http://localhost:4000` or your LAN IP
- Mock fallbacks are allowed only when explicitly enabled on the backend
- `EXPO_PUBLIC_PLAN_OVERRIDE` is allowed only in local mode

### Preview

- Mobile env: `EXPO_PUBLIC_APP_ENV=preview`
- Backend env: `APP_ENV=preview`
- `EXPO_PUBLIC_API_BASE_URL` must be a public HTTPS backend URL
- Real Supabase mobile auth is the default path
- Backend dev auth bypass and mock fallbacks must be disabled

### Production

- Mobile env: `EXPO_PUBLIC_APP_ENV=production`
- Backend env: `APP_ENV=production`
- Uses the same public HTTPS backend shape as preview
- No laptop/LAN assumptions
- No dev auth bypass or mock fallbacks

## Mobile Env Vars

Start from [.env.example](/Users/mattbrillman/Car_Identifier/.env.example).

- `EXPO_PUBLIC_APP_ENV`
  `local`, `preview`, or `production`
- `EXPO_PUBLIC_API_BASE_URL`
  Local can use `http://localhost:4000`; preview/production must use HTTPS
- `EXPO_PUBLIC_SUPABASE_URL`
  Required for real mobile auth
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  Required for real mobile auth
- `EXPO_PUBLIC_PLAN_OVERRIDE`
  Dev-only helper for local testing; ignored outside local mode
- `EXPO_PUBLIC_EAS_PROJECT_ID`
- `EXPO_PUBLIC_APP_NAME`
- `EXPO_PUBLIC_IOS_BUNDLE_ID`
- `EXPO_PUBLIC_IOS_BUILD_NUMBER`

## Backend Env Vars

Start from [backend/.env.example](/Users/mattbrillman/Car_Identifier/backend/.env.example).

- `APP_ENV`
  `local`, `preview`, or `production`
- `NODE_ENV`
  Usually `development` locally and `production` on hosted deployments
- `ALLOW_MOCK_FALLBACKS`
  Local-only safety valve; must be `false` for preview/production
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `AUTH_DEV_BYPASS_ENABLED`
  Local-only; must be `false` outside local dev
- `VISION_PROVIDER`
  `openai` or `mock`
- `OPENAI_API_KEY`
- `VEHICLE_SPECS_PROVIDER`
- `VEHICLE_VALUE_PROVIDER`
- `VEHICLE_LISTINGS_PROVIDER`
- `MARKETCHECK_API_KEY`
- `CORS_ORIGIN`

## Local Development

1. Install dependencies:

```bash
npm install
cd backend && npm install
```

2. Configure local env files from the example files.

3. Start the backend:

```bash
cd backend
npm run dev
```

4. Start Expo:

```bash
npm start
```

5. For a physical device in local mode, use your Mac's LAN IP in `EXPO_PUBLIC_API_BASE_URL`.

## Preview / Production-Like Testing

1. Deploy the backend publicly with Render using [render.yaml](/Users/mattbrillman/Car_Identifier/render.yaml) and [backend/Dockerfile](/Users/mattbrillman/Car_Identifier/backend/Dockerfile).
2. Set backend env vars in the host dashboard from [backend/.env.example](/Users/mattbrillman/Car_Identifier/backend/.env.example).
3. Confirm the backend health endpoint:

```bash
curl https://your-backend.example.com/health
```

4. Set mobile env vars for preview:

```bash
EXPO_PUBLIC_APP_ENV=preview
EXPO_PUBLIC_API_BASE_URL=https://your-backend.example.com
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

5. Build the preview app:

```bash
npm run eas:build:preview
```

The preview flow now assumes:

- public HTTPS backend
- real Supabase mobile auth session
- real bearer tokens on backend requests
- no dev auth shortcuts

## Backend Deployment Notes

The backend now fails fast for preview/production-style deployments when critical env vars are missing or unsafe, including:

- missing `SUPABASE_*` auth/persistence config
- `AUTH_DEV_BYPASS_ENABLED=true`
- `ALLOW_MOCK_FALLBACKS=true`
- mock providers selected for preview/production
- MarketCheck selected without `MARKETCHECK_API_KEY`
- OpenAI vision selected without `OPENAI_API_KEY`

Startup logs and `/health` now report non-secret diagnostics:

- `NODE_ENV`
- `APP_ENV`
- whether Supabase is configured
- whether OpenAI is configured
- whether dev auth bypass is enabled
- whether mock fallbacks are allowed
- active provider selection

## Auth State

- Mobile auth now uses real Supabase email/password auth by default
- Supabase sessions persist across app restarts
- Backend requests send `Authorization: Bearer <real_token>`
- Signed-out users no longer attempt protected backend requests through the shared API client
- Sign-out clears local mobile auth state and resets cached scan/subscription state

## Still Not Fully Live

- StoreKit / RevenueCat is still not wired
- Purchase and restore actions are intentionally honest placeholders
- OpenAI vision still depends on valid billing/quota outside local mock mode
- A true production launch still needs real subscription billing, App Store flows, analytics/crash reporting, and release validation
