import test from "node:test";
import assert from "node:assert/strict";
import { parseHorsepower, resolveHorsepower } from "../src/lib/vehicleData.js";

test("parseHorsepower handles numeric horsepower", () => {
  assert.equal(parseHorsepower(295), 295);
});

test("parseHorsepower handles string horsepower like '295 hp'", () => {
  assert.equal(parseHorsepower("295 hp"), 295);
});

test("parseHorsepower returns null for missing horsepower", () => {
  assert.equal(parseHorsepower(null), null);
  assert.equal(parseHorsepower(""), null);
  assert.equal(parseHorsepower(undefined), null);
});

test("resolveHorsepower preserves an earlier valid horsepower over a later fallback zero", () => {
  assert.equal(resolveHorsepower("295 hp", 0), 295);
});

test("parseHorsepower treats non-positive horsepower as missing", () => {
  assert.equal(parseHorsepower(0), null);
  assert.equal(parseHorsepower("0 hp"), null);
});

test("parseHorsepower does not mistake engine displacement for horsepower", () => {
  assert.equal(parseHorsepower("4.0L V6"), null);
  assert.equal(parseHorsepower("2.5L Hybrid"), null);
});
