import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { tickHour } from "../src/sim/tick";

test("gossip: creates a public rumor and gives target a heard_rumor knowledge fact", () => {
  let world = createWorld(2);
  const siteId = "HumanVillageA";
  const npcsHere = Object.values(world.npcs).filter((n) => n.alive && n.siteId === siteId).sort((a, b) => a.id.localeCompare(b.id));
  assert.ok(npcsHere.length >= 2);

  const actor = npcsHere[0]!;
  const target = npcsHere[1]!;

  const attempt: any = {
    id: "test-gossip",
    tick: world.tick,
    kind: "gossip",
    siteId,
    actorId: actor.id,
    targetId: target.id,
    visibility: "public",
    intentMagnitude: "minor",
    durationHours: 1,
    why: { text: "test" }
  };

  const res = tickHour(world, { attempts: [attempt] });
  world = res.world;

  const site: any = world.sites[siteId];
  assert.ok(Array.isArray(site.rumors) && site.rumors.length > 0, "site should have at least one rumor");

  const updatedTarget = world.npcs[target.id]!;
  const facts = updatedTarget.knowledge?.facts ?? [];
  assert.ok(facts.some((f: any) => f.kind === "heard_rumor"), "target should have heard_rumor fact");
});

test("blackmail: with leverage, transfers coins from target to actor (private)", () => {
  let world = createWorld(3);
  const siteId = "HumanCityPort";
  const npcsHere = Object.values(world.npcs).filter((n) => n.alive && n.siteId === siteId).sort((a, b) => a.id.localeCompare(b.id));
  assert.ok(npcsHere.length >= 2);

  const actor = npcsHere[0]!;
  const target = npcsHere[1]!;

  // Give actor leverage: identified cult member fact about target.
  const actorK: any = actor.knowledge ?? { facts: [], secrets: [] };
  actorK.facts = [
    ...(actorK.facts ?? []),
    { id: "fact:test", kind: "identified_cult_member", subjectId: target.id, object: "true", confidence: 90, source: "witnessed", tick: world.tick }
  ];

  // Give target coins
  const targetInv: any = target.inventory ?? { coins: 0, food: {} };
  targetInv.coins = 50;

  // Make outcome deterministic: force very high chance of success.
  const actorTraits = { ...actor.traits, Greed: 100, Suspicion: 100, Discipline: 100, Integrity: 0 };
  const targetTraits = { ...target.traits, Courage: 0, Integrity: 0, Discipline: 0 };

  world = {
    ...world,
    npcs: {
      ...world.npcs,
      [actor.id]: { ...actor, knowledge: actorK, traits: actorTraits },
      [target.id]: { ...target, inventory: targetInv, traits: targetTraits }
    }
  };

  const attempt: any = {
    id: "test-blackmail",
    tick: world.tick,
    kind: "blackmail",
    siteId,
    actorId: actor.id,
    targetId: target.id,
    visibility: "private",
    intentMagnitude: "normal",
    durationHours: 1,
    why: { text: "test" }
  };

  const res = tickHour(world, { attempts: [attempt] });
  world = res.world;

  const a2 = world.npcs[actor.id]!;
  const t2 = world.npcs[target.id]!;
  const aCoins = a2.inventory?.coins ?? 0;
  const tCoins = t2.inventory?.coins ?? 0;
  assert.ok(aCoins > 0, "actor should gain some coins on successful blackmail");
  assert.ok(tCoins < 50, "target should lose some coins on successful blackmail");
});


