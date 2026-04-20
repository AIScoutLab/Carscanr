# Value / Listings QA Report

Date: 2026-04-19

Purpose:
- verify the new value/listings fallback system
- identify vehicles that still need live-scan or provider-backed QA
- make local fixture gaps explicit so we do not confuse missing QA coverage with missing product coverage

## Summary

- Local runtime verification is currently limited by bundled fixture coverage.
- The requested common-vehicle set:
  - `Honda CR-V`
  - `Toyota Corolla`
  - `Toyota Camry`
  - `Ford Ranger`
  - `Ford F-150`
  - `BMW X3`
  - `Mercedes S-Class`
  is **not present** in the current bundled offline/mock fixture set used for local-only verification in this environment.
- One motorcycle path **was** locally verifiable:
  - `2023 Harley-Davidson Street Glide Special`
  - result: strong payload, unlock eligible, horsepower present, value present, listings present

## Matrix

| Vehicle | Identification Result | PayloadStrength | UnlockEligible | Horsepower | Value | Listings | Source Labels | Status / Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Honda CR-V | Not locally verifiable | Unknown | Unknown | Unknown | Unknown | Unknown | N/A | Missing from current local fixture set. Needs live/provider QA. |
| Toyota Corolla | Not locally verifiable | Unknown | Unknown | Unknown | Unknown | Unknown | N/A | Missing from current local fixture set. Needs live/provider QA. |
| Toyota Camry | Not locally verifiable | Unknown | Unknown | Unknown | Unknown | Unknown | N/A | Missing from current local fixture set. Needs live/provider QA. |
| Ford Ranger | Not locally verifiable | Unknown | Unknown | Unknown | Unknown | Unknown | N/A | Missing from current local fixture set. Needs live/provider QA. |
| Ford F-150 | Not locally verifiable | Unknown | Unknown | Unknown | Unknown | Unknown | N/A | Missing from current local fixture set. Needs live/provider QA. |
| BMW X3 | Not locally verifiable | Unknown | Unknown | Unknown | Unknown | Unknown | N/A | Missing from current local fixture set. Needs live/provider QA. |
| Mercedes S-Class | Not locally verifiable | Unknown | Unknown | Unknown | Unknown | Unknown | N/A | Missing from current local fixture set. Needs live/provider QA. |
| Harley-Davidson Street Glide Special (motorcycle) | Local seed vehicle resolved | Strong | Yes | Present | Present | Present | Value: `Estimated market range` or stored market data path. Listings: local believable listing present. | Locally verified via seed data. |

## Common-Vehicle Flags

The following common vehicles are still flagged for QA follow-up because local verification could not confirm:
- Honda CR-V
- Toyota Corolla
- Toyota Camry
- Ford Ranger
- Ford F-150
- BMW X3
- Mercedes S-Class

Why they are flagged:
- no local fixture-backed verification for value
- no local fixture-backed verification for listings
- no local fixture-backed verification for horsepower completeness

This is currently a **fixture coverage gap**, not proof that production coverage fails for those vehicles.

## Locally Verified Detail

### Harley-Davidson Street Glide Special

- Identification result:
  - local seed vehicle available
- Payload strength:
  - `strong`
- Unlock eligible:
  - `true`
- Horsepower:
  - present
- Value:
  - present
- Listings:
  - present
- Useful detail:
  - yes

## Next QA Step

To complete this matrix properly, run live/provider-backed QA for:
- Honda CR-V
- Toyota Corolla
- Toyota Camry
- Ford Ranger
- Ford F-150
- BMW X3
- Mercedes S-Class

Recommended capture fields for each live run:
- identified year / make / model
- payloadStrength
- unlockEligible
- horsepower present
- value present
- listings present
- value source label
- listing fallback source
- whether family cache, adjacent-year rescue, or similar-vehicle fallback fired
