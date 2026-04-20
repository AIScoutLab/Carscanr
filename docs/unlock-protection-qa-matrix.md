# Unlock Protection QA Matrix

Use this matrix for real-device or simulator QA while the unlock-protection logs are enabled.

## Goal

No user should spend an unlock and then land on an empty or nearly useless detail experience.

## Vehicles

| Vehicle | Expected identification behavior | Unlock expectation | Minimum useful outcome |
| --- | --- | --- | --- |
| Honda CR-V | High-confidence scan should resolve to CR-V family cleanly | Unlock allowed when specs/value/listings are at least usable | Specs visible; value or listings strong/light if available |
| Toyota Camry | High-confidence scan should stay stable across nearby-year fallback | Unlock allowed when payload is usable | Specs visible; value or listings visible if any believable fallback exists |
| Ford F-150 | Generation-sensitive family should still avoid unsafe identity merging | Unlock allowed only when exact/adjacent enrichment is useful | Specs visible; value/listings only if believable comps exist |
| Ford Ranger | Adjacent-year rescue should recover common year-mismatch cases | Unlock allowed when 2022/2024 rescue makes payload usable | Specs visible plus value or believable listings after rescue |
| BMW X3 | Premium mainstream SUV should still produce useful fallback specs | Unlock allowed when payload is usable | Specs visible; light market or listings state acceptable |
| Motorcycle (any) | Should remain conservative and may stay blocked | Unlock may be blocked if payload is thin/empty | Identification remains visible; blocked copy should feel protective, not broken |

## QA checks

For each scan:

1. Confirm result-screen logs show:
   - `UNLOCK_PROTECTION_SCAN_RESULT`
   - `payloadStrength`
   - `unlockEligible`
   - `unlockRecommendationReason`
2. If unlock is blocked:
   - user keeps the unlock
   - message explains that the app is protecting them from spending an unlock on weak detail
   - result still shows useful identification content
3. If unlock is allowed:
   - detail opens with useful specs
   - value/listings render in strong or light state when fallback data exists
   - no empty stacked fallback cards appear

## Pass criteria

- `strong` or `usable` payloads can consume unlocks.
- `thin` or `empty` payloads cannot consume unlocks.
- Blocked results still feel useful because identification remains visible and the user is told why the unlock was protected.
