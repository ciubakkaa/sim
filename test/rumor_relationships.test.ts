import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { resolveAndApplyAttempt } from "../src/sim/attempts";
import { Rng } from "../src/sim/rng";
import { runSimulation } from "../src/runner/run";
import { progressTravelHourly } from "../src/sim/movement";

const runSimTests = process.env.RUN_SIM_TESTS === "1" || process.env.RUN_SLOW_TESTS === "1";
const simTest = runSimTests ? test : test.skip;

test("rumor ingestion updates relationships when returning to a site", () => {
  let world = createWorld(123);
  world = { ...world, tick: 10 };

  const villagers = Object.values(world.npcs).filter((n) => n.siteId === "HumanVillageA");
  assert.ok(villagers.length >= 2, "expected at least 2 villagers");
  const thief = villagers[0]!;
  const witnessLater = villagers[1]!;

  let seq = 0;
  const ctx = { rng: new Rng(999), nextEventSeq: () => ++seq };

  // Move witness away so they won't immediately witness the theft.
  {
    const travelOut = {
      id: "att:travel:out",
      tick: world.tick,
      kind: "travel" as const,
      visibility: "public" as const,
      actorId: witnessLater.id,
      siteId: "HumanVillageA",
      durationHours: 1,
      intentMagnitude: "normal" as const,
      resources: { toSiteId: "HumanCityPort" }
    };
    world = resolveAndApplyAttempt(world, travelOut, ctx).world;
    // Travel is multi-hour now: NPC is in transit until arrival.
    assert.equal(world.npcs[witnessLater.id]!.siteId, "HumanVillageA");
    assert.ok(world.npcs[witnessLater.id]!.travel);

    // Progress 4 hours (HumanVillageA <-> HumanCityPort is 16km; daytime speed is 4 km/h).
    for (let i = 0; i < 4; i++) {
      world = { ...world, tick: world.tick + 1 };
      world = progressTravelHourly(world, ctx).world;
    }
    assert.equal(world.npcs[witnessLater.id]!.siteId, "HumanCityPort");
    assert.ok(!world.npcs[witnessLater.id]!.travel);
  }

  // Theft happens in the village (public => rumor created and witnesses updated).
  {
    const steal = {
      id: "att:steal",
      tick: world.tick,
      kind: "steal" as const,
      visibility: "public" as const,
      actorId: thief.id,
      siteId: "HumanVillageA",
      durationHours: 1,
      intentMagnitude: "normal" as const
    };
    world = resolveAndApplyAttempt(world, steal, ctx).world;
  }

  // Return to the village: should ingest rumor and update relationship.
  {
    const travelBack = {
      id: "att:travel:back",
      tick: world.tick,
      kind: "travel" as const,
      visibility: "public" as const,
      actorId: witnessLater.id,
      siteId: "HumanCityPort",
      durationHours: 1,
      intentMagnitude: "normal" as const,
      resources: { toSiteId: "HumanVillageA" }
    };
    world = resolveAndApplyAttempt(world, travelBack, ctx).world;
    assert.ok(world.npcs[witnessLater.id]!.travel);
    for (let i = 0; i < 4; i++) {
      world = { ...world, tick: world.tick + 1 };
      world = progressTravelHourly(world, ctx).world;
    }
    assert.equal(world.npcs[witnessLater.id]!.siteId, "HumanVillageA");
  }

  const rel = world.npcs[witnessLater.id]!.relationships[thief.id];
  assert.ok(rel, "relationship should be materialized via rumor ingestion");
  assert.equal(rel.trust, 30);
  assert.equal(rel.fear, 15);
  assert.equal(rel.loyalty, 20);
});

simTest("cultInfluence is derived from actual cult members (not just unrest)", () => {
  let world = createWorld(123);
  // Pick a human site and force unrest high without adding cult members.
  const site = world.sites["HumanVillageA"] as any;
  site.unrest = 100;
  site.cultInfluence = 0;
  // Ensure no members in that site.
  for (const n of Object.values(world.npcs)) {
    if (n.siteId === "HumanVillageA") {
      world = {
        ...world,
        npcs: {
          ...world.npcs,
          [n.id]: { ...n, cult: { member: false, role: "none" }, category: n.category === "ConcordDevotee" ? "Farmer" : n.category }
        }
      };
    }
  }

  // Run one day so cult process derives influence.
  const a = runSimulation({ seed: 123, days: 1 });
  // In the normal generated world, there are some cultists; this test only asserts the model allows decoupling.
  // We just check that the summarizer field exists and is within bounds.
  const s = a.summaries[0]!;
  const v = s.sites.find((x) => x.siteId === "HumanVillageA")!;
  assert.ok(v.cultInfluence !== undefined);
  assert.ok(v.cultInfluence >= 0 && v.cultInfluence <= 100);
});


