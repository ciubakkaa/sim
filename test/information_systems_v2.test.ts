import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { tickHour } from "../src/sim/tick";
import { createConfig, resetConfig, setConfig } from "../src/sim/config";

test("v2 perception: when enabled, NPCs record discovered_location knowledge facts", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(12001);
    world = tickHour(world).world;
    const anyWithFacts = Object.values(world.npcs).some((n) => (n.knowledge?.facts ?? []).some((f) => f.kind === "discovered_location"));
    assert.ok(anyWithFacts, "expected at least one NPC to gain discovered_location knowledge");
  } finally {
    resetConfig();
  }
});

test("v2 secrets: when enabled, private crime attempts create world secrets + actor learns them", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(12002);
    const siteId = "HumanCityPort";
    const actorId = Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId && !n.category.includes("Guard"))!.id;
    const targetId = Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId && n.id !== actorId)!.id;

    const t0 = world.tick;
    const res0 = tickHour(world, {
      attempts: [
        {
          id: "att:test:secret:steal",
          tick: t0 + 1,
          kind: "steal",
          visibility: "private",
          actorId,
          targetId,
          siteId,
          durationHours: 1,
          intentMagnitude: "normal"
        }
      ]
    });
    // First tick schedules steal (windup=1). Second tick executes it (attempt.recorded).
    world = tickHour(res0.world).world;

    const secrets = world.secrets ?? {};
    assert.ok(Object.keys(secrets).length >= 1, "expected at least one secret created");
    const actor = world.npcs[actorId]!;
    assert.ok((actor.knowledge?.secrets ?? []).length >= 1, "expected actor to learn their secret");
  } finally {
    resetConfig();
  }
});

test("v2 rumors: when enabled, end-of-day spreads some rumors between settlements (bounded)", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(12003);
    // Force a public rumor at HumanCityPort.
    const siteId = "HumanCityPort";
    const actorId = Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId)!.id;
    const t0 = world.tick;
    world = tickHour(world, {
      attempts: [
        {
          id: "att:test:rumor:steal",
          tick: t0 + 1,
          kind: "steal",
          visibility: "public",
          actorId,
          targetId: undefined,
          siteId,
          durationHours: 1,
          intentMagnitude: "normal"
        }
      ]
    }).world;

    // Run until end-of-day boundary (hour 23) to trigger daily spread.
    for (let i = 0; i < 30; i++) world = tickHour(world).world;

    const settlements = Object.values(world.sites).filter((s: any) => s.kind === "settlement") as any[];
    const totalRumors = settlements.reduce((a, s) => a + ((s.rumors ?? []).length as number), 0);
    assert.ok(totalRumors > 0, "expected rumors present across settlements");
  } finally {
    resetConfig();
  }
});


