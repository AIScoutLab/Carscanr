# Car Identifier Backend

Node.js + TypeScript + Express backend for Car Identifier. The service is structured for clean modular growth, with mock providers today and ready seams for Supabase persistence, AI vision, valuation vendors, listings vendors, and App Store subscription verification later.

## Features

- `POST /api/scan/identify`
- `GET /api/vehicle/specs`
- `GET /api/vehicle/value`
- `GET /api/vehicle/listings`
- `POST /api/garage/save`
- `GET /api/garage/list`
- `DELETE /api/garage/:id`
- `POST /api/subscription/verify`
- `GET /api/usage/today`

## Architecture

```text
backend/
  src/
    config/
    controllers/
    data/
    errors/
    lib/
    middleware/
    models/
    providers/
      mock/
    repositories/
    routes/
    services/
    types/
```

## Setup

1. Install dependencies:

```bash
cd backend
npm install
```

2. Copy env file:

```bash
cp .env.example .env
```

3. Start the dev server:

```bash
npm run dev
```

4. Apply the initial Supabase schema in [backend/supabase/migrations/001_initial_schema.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/migrations/001_initial_schema.sql) and seed your `vehicles`, `valuations`, and `listing_results` tables before using the API.

5. Run the ready-made SQL in [backend/supabase/seed.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/seed.sql) to load starter vehicle, valuation, and listing data.

## Auth Setup

Protected routes verify Supabase bearer tokens in the backend auth middleware.

- Send `Authorization: Bearer <supabase_access_token>`
- The backend verifies the token with Supabase and attaches `req.auth.userId`
- A temporary local-only bypass can be enabled with `AUTH_DEV_BYPASS_ENABLED=true`
- Do not enable the bypass in production

## Environment Variables

- `PORT`
- `NODE_ENV`
- `LOG_LEVEL`
- `CORS_ORIGIN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `AUTH_DEV_BYPASS_ENABLED`
- `AUTH_DEV_BYPASS_USER_ID`
- `AUTH_DEV_BYPASS_EMAIL`
- `UPLOAD_MAX_FILE_SIZE_BYTES`
- `FREE_SCAN_LIMIT_PER_DAY`
- `ABUSE_MAX_SCAN_ATTEMPTS_PER_10_MIN`
- `VISION_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_VISION_MODEL`
- `OPENAI_VISION_TIMEOUT_MS`
- `VEHICLE_SPECS_PROVIDER`
- `VEHICLE_VALUE_PROVIDER`
- `VEHICLE_LISTINGS_PROVIDER`
- `MARKETCHECK_API_KEY`
- `MARKETCHECK_BASE_URL`
- `MARKETCHECK_VALUE_RADIUS_MILES`

You can copy [backend/.env.example](/Users/mattbrillman/Car_Identifier/backend/.env.example) to `backend/.env` and replace the placeholder values directly.

## Run Commands

- `npm run dev` starts the backend in watch mode
- `npm run build` compiles to `dist/`
- `npm run start` runs compiled output
- `npm run typecheck` validates TypeScript
- `npm test` runs the automated route and service tests with the local auth bypass enabled for test mode
- `npm run seed` prints seed vehicles, valuations, and listings JSON

## Tests

The backend test suite is intentionally practical rather than exhaustive:

- route tests exercise the real Express app through request injection without opening sockets
- service tests cover usage limits, scan normalization, and garage persistence
- external services are mocked through the provider and repository registries

Run:

```bash
cd backend
npm test
```

## API Examples

Get today usage:

```bash
curl http://localhost:4000/api/usage/today
```

Get specs:

```bash
curl "http://localhost:4000/api/vehicle/specs?vehicleId=2022-tesla-model-3-long-range"
```

Get value:

```bash
curl "http://localhost:4000/api/vehicle/value?vehicleId=2020-honda-civic-ex&zip=60610&mileage=42000&condition=good"
```

Get listings:

```bash
curl "http://localhost:4000/api/vehicle/listings?vehicleId=2019-ford-mustang-gt&zip=60610&radiusMiles=50"
```

Save garage item:

```bash
curl -X POST http://localhost:4000/api/garage/save \
  -H "Content-Type: application/json" \
  -d '{"vehicleId":"2021-cadillac-ct4-premium-luxury","imageUrl":"https://example.com/scan.jpg","notes":"Looks like my car","favorite":true}'
```

List garage items:

```bash
curl http://localhost:4000/api/garage/list
```

Delete garage item:

```bash
curl -X DELETE http://localhost:4000/api/garage/<id>
```

Verify subscription:

```bash
curl -X POST http://localhost:4000/api/subscription/verify \
  -H "Content-Type: application/json" \
  -d '{"platform":"ios","receiptData":"mock-pro-receipt","productId":"car_identifier_pro_monthly"}'
```

Identify vehicle from image:

```bash
curl -X POST http://localhost:4000/api/scan/identify \
  -F "image=@/absolute/path/to/car-photo.jpg"
```

## Scan Flow

1. Receive multipart image upload
2. Send image bytes to `VisionProvider`
3. For the OpenAI provider, call the Responses API with image input plus strict JSON schema output
4. Store raw AI response for debugging
5. Normalize fields and confidence
6. If the primary AI call fails or times out, fall back to the mock provider
7. Match against `VehicleSpecsProvider`
8. Return top candidate vehicles and scan metadata

## Seed Data

- 2021 Cadillac CT4
- 2020 Honda Civic
- 2019 Ford Mustang
- 2022 Tesla Model 3
- 2021 Yamaha YZF-R3
- 2023 Harley-Davidson Street Glide

Ready-to-run SQL for that starter dataset lives in [backend/supabase/seed.sql](/Users/mattbrillman/Car_Identifier/backend/supabase/seed.sql).

## Production Notes

- Persistence now expects Supabase-backed tables for scans, vehicles, garage items, valuations, listing results, subscriptions, usage counters, and vision debug logs
- Verify Supabase JWT in `authMiddleware`
- Upload scan images to Supabase Storage or signed object storage
- Replace mock listings/specs/value providers with vendor-backed integrations
- Add rate limiting with Redis or edge middleware for stronger abuse controls
- Persist subscription state and verify Apple receipts server-side
- Add tests, observability, and OpenAPI docs before shipping
## Live Market Data

The backend can now use live internet-backed vehicle data for search, listings, and market-value estimates via MarketCheck.

To enable it in `backend/.env`:

```env
VEHICLE_SPECS_PROVIDER=marketcheck
VEHICLE_VALUE_PROVIDER=marketcheck
VEHICLE_LISTINGS_PROVIDER=marketcheck
MARKETCHECK_API_KEY=your_marketcheck_api_key
MARKETCHECK_BASE_URL=https://api.marketcheck.com
MARKETCHECK_VALUE_RADIUS_MILES=100
```

Behavior:

- `GET /api/vehicle/search` uses live MarketCheck inventory search when configured
- `GET /api/vehicle/listings` uses live nearby dealer listings when configured
- `GET /api/vehicle/value` uses live price-stat inventory search to estimate trade-in, private-party, and dealer-retail ranges
- If MarketCheck is unavailable or not configured, the backend falls back to the existing seeded/mock data path

## Public Deployment

The backend is now prepared for public container hosting:

- Docker image: [backend/Dockerfile](/Users/mattbrillman/Car_Identifier/backend/Dockerfile)
- Docker ignore: [backend/.dockerignore](/Users/mattbrillman/Car_Identifier/backend/.dockerignore)
- Render blueprint: [render.yaml](/Users/mattbrillman/Car_Identifier/render.yaml)

Recommended production env values:

```env
NODE_ENV=production
AUTH_DEV_BYPASS_ENABLED=false
CORS_ORIGIN=*
```

Then provide real values for:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `OPENAI_API_KEY`
- `MARKETCHECK_API_KEY`

After deployment, point the mobile app’s `EXPO_PUBLIC_API_BASE_URL` at your public HTTPS backend URL and rebuild the app with EAS.
