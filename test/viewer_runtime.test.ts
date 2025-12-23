import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { tickHour } from "../src/sim/tick";
import { SimRuntime } from "../src/service/runtime";

test("SimRuntime.step matches manual tickHour stepping for same seed", () => {
  const seed = 42;
  const steps = 25;

  let w = createWorld(seed);
  for (let i = 0; i < steps; i++) w = tickHour(w).world;

  const rt = new SimRuntime({ seed, msPerTick: 60_000, paused: true });
  for (let i = 0; i < steps; i++) rt.step();

  assert.equal(rt.state.world.tick, w.tick);
  assert.deepEqual(rt.state.world, w);
});

test("SimRuntime.helloMessage contains layout+world+settings", () => {
  const rt = new SimRuntime({ seed: 1, msPerTick: 60_000, paused: true });
  const msg = rt.helloMessage();
  assert.equal(msg.type, "hello");
  assert.ok(msg.world);
  assert.ok(msg.layout);
  assert.ok(msg.map);
  assert.ok(msg.settings);
});


