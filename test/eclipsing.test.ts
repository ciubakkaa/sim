import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { resolveAndApplyAttempt } from "../src/sim/attempts";
import { progressEclipsingHourly, progressDetentionHourly } from "../src/sim/eclipsing";

function stubRng() {
  return {
    int: (min: number, _max: number) => min,
    chance: (_p: number) => true,
    next: () => 0
  } as any;
}

test("forced_eclipse converts target after completion and clears detention/eclipsing status", () => {
  let world = createWorld(1);
  world = { ...world, tick: 10 };

  const actor = Object.values(world.npcs).find((n) => n.alive && n.siteId === "HumanVillageA")!;
  const target = Object.values(world.npcs).find((n) => n.alive && n.siteId === "HumanVillageA" && n.id !== actor.id)!;

  // Detain target to satisfy precondition.
  world = {
    ...world,
    npcs: {
      ...world.npcs,
      [target.id]: {
        ...target,
        status: { detained: { byNpcId: actor.id, atSiteId: "HumanVillageA", startedTick: world.tick, untilTick: world.tick + 200 } }
      }
    }
  };

  let seq = 0;
  const ctx = { rng: stubRng(), nextEventSeq: () => ++seq };

  const res = resolveAndApplyAttempt(world, {
    id: "att:forced",
    tick: world.tick,
    kind: "forced_eclipse",
    visibility: "private",
    actorId: actor.id,
    targetId: target.id,
    siteId: "HumanVillageA",
    durationHours: 6,
    intentMagnitude: "major"
  }, ctx);

  world = res.world;
  const e = world.npcs[target.id]!.status?.eclipsing;
  assert.ok(e, "expected eclipsing to start");

  // stubRng.int(min,max) returns min, so days=1 => completeTick = initiated + 24
  assert.ok(e.completeTick > world.tick);

  // Advance to completion tick and progress.
  world = { ...world, tick: e.completeTick };
  world = progressEclipsingHourly(world, ctx).world;

  const updated = world.npcs[target.id]!;
  assert.equal(updated.category, "TaintedThrall");
  assert.ok(!updated.status?.eclipsing);
  assert.ok(!updated.status?.detained);
});

test("detention auto-releases when untilTick is reached", () => {
  let world = createWorld(1);
  world = { ...world, tick: 10 };

  const actor = Object.values(world.npcs).find((n) => n.alive && n.siteId === "HumanVillageA")!;
  const target = Object.values(world.npcs).find((n) => n.alive && n.siteId === "HumanVillageA" && n.id !== actor.id)!;

  world = {
    ...world,
    npcs: {
      ...world.npcs,
      [target.id]: {
        ...target,
        status: { detained: { byNpcId: actor.id, atSiteId: "HumanVillageA", startedTick: world.tick, untilTick: world.tick + 2 } }
      }
    }
  };

  let seq = 0;
  const ctx = { rng: stubRng(), nextEventSeq: () => ++seq };

  world = { ...world, tick: world.tick + 1 };
  world = progressDetentionHourly(world, ctx).world;
  assert.ok(world.npcs[target.id]!.status?.detained);

  world = { ...world, tick: world.tick + 1 };
  world = progressDetentionHourly(world, ctx).world;
  assert.ok(!world.npcs[target.id]!.status?.detained);
});


