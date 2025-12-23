import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { computeDeterministicLayout } from "../src/service/layout";

test("computeDeterministicLayout is deterministic for same map+seed", () => {
  const w = createWorld(1);
  const a = computeDeterministicLayout(w.map, 1);
  const b = computeDeterministicLayout(w.map, 1);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("computeDeterministicLayout differs across seeds (sanity)", () => {
  const w = createWorld(1);
  const a = computeDeterministicLayout(w.map, 1);
  const b = computeDeterministicLayout(w.map, 2);
  assert.notEqual(JSON.stringify(a.sites), JSON.stringify(b.sites));
});


