import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { tickHour } from "../src/sim/tick";
import { createConfig, resetConfig, setConfig } from "../src/sim/config";

test("entity registry: when enabled, createWorld populates world.entities as a derived view of npcs", () => {
  setConfig(createConfig());
  try {
    const world = createWorld(7001);
    assert.ok(world.entities, "expected world.entities");
    assert.equal(Object.keys(world.entities!).length, Object.keys(world.npcs).length);
    const someId = Object.keys(world.npcs).sort()[0]!;
    assert.ok(world.entities![someId], "expected entity for npc");
  } finally {
    resetConfig();
  }
});

test("entity registry: when enabled, tickHour syncs world.entities to world.npcs", () => {
  setConfig(createConfig());
  try {
    const world = createWorld(7002);
    const res = tickHour(world);
    assert.ok(res.world.entities, "expected entities after tick");
    // Derived view should point at the same object identity for values.
    const id = Object.keys(res.world.npcs).sort()[0]!;
    assert.equal(res.world.entities![id], res.world.npcs[id]);
  } finally {
    resetConfig();
  }
});


