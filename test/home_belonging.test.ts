import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { computeNpcNeeds } from "../src/sim/npcs";
import { generateScoredAttempt } from "../src/sim/attempts";
import type { WorldState } from "../src/sim/types";

function patchNpc(world: WorldState, npcId: string, patch: any): WorldState {
  const npc = world.npcs[npcId];
  assert.ok(npc, "npc must exist");
  return { ...world, npcs: { ...world.npcs, [npcId]: { ...npc, ...patch } } };
}

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

test("belonging: stays 0 before 48h away, then rises ~1 per 2h", () => {
  const w0 = createWorld(1);
  const npcId = findNpcId(w0, (n) => n.category === "Farmer" && n.siteId === "HumanVillageA");

  const w48 = { ...w0, tick: 48 };
  const npcAway48 = { ...w48.npcs[npcId]!, siteId: "HumanCityPort", homeSiteId: "HumanVillageA", awayFromHomeSinceTick: 0 };
  const needs48 = computeNpcNeeds(npcAway48, w48);
  assert.equal(needs48.Belonging, 0);

  const w100 = { ...w0, tick: 100 };
  const npcAway100 = { ...w100.npcs[npcId]!, siteId: "HumanCityPort", homeSiteId: "HumanVillageA", awayFromHomeSinceTick: 0 };
  const needs100 = computeNpcNeeds(npcAway100, w100);
  // (100 - 48) / 2 = 26
  assert.equal(needs100.Belonging, 26);
});

test("home-seeking: when Belonging > 60 and home is adjacent, scoring travel targets home", () => {
  const w0 = createWorld(1);
  const npcId = findNpcId(w0, (n) => n.category === "Farmer" && n.siteId === "HumanVillageA");

  // Move the farmer one hop away (HumanCityPort is adjacent to HumanVillageA in the map).
  const w1 = patchNpc({ ...w0, tick: 200 }, npcId, {
    siteId: "HumanCityPort",
    homeSiteId: "HumanVillageA",
    awayFromHomeSinceTick: 0,
    // Make belonging dominate scoring to ensure travel is selected deterministically.
    needs: { ...w0.npcs[npcId]!.needs, Belonging: 80, Food: 0, Safety: 0, Duty: 0, Freedom: 0, Meaning: 0 },
    lastAttemptTick: -999,
    busyUntilTick: -999
  });

  const rng = { next: () => 0, int: (a: number, _b?: number) => a, chance: () => false } as any;
  const a = generateScoredAttempt(w1.npcs[npcId]!, w1, rng);
  assert.ok(a, "attempt should exist");
  assert.equal(a!.kind, "travel");
  assert.equal((a!.resources as any)?.toSiteId, "HumanVillageA");
});


