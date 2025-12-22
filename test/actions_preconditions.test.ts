import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { checkPreconditions } from "../src/sim/actions/preconditions";
import type { ActionPrecondition } from "../src/sim/actions/types";
import type { TravelState, WorldState } from "../src/sim/types";

function patchNpc(world: WorldState, npcId: string, patch: any): WorldState {
  const npc = world.npcs[npcId];
  assert.ok(npc, "npc must exist");
  return { ...world, npcs: { ...world.npcs, [npcId]: { ...npc, ...patch } } };
}

function patchSite(world: WorldState, siteId: string, patch: any): WorldState {
  const site = world.sites[siteId];
  assert.ok(site, "site must exist");
  return { ...world, sites: { ...world.sites, [siteId]: { ...(site as any), ...(patch as any) } } };
}

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

test("preconditions: atSiteKind + hasCategory basic pass/fail", () => {
  const w0 = createWorld(1);
  const farmerId = findNpcId(w0, (n) => n.category === "Farmer" && n.siteId === "HumanVillageA");

  const ok: ActionPrecondition[] = [
    { type: "atSiteKind", kinds: ["settlement"] },
    { type: "hasCategory", categories: ["Farmer"] }
  ];
  assert.equal(checkPreconditions(ok, w0.npcs[farmerId]!, w0), true);

  const w1 = patchNpc(w0, farmerId, { siteId: "DeepForest" });
  assert.equal(checkPreconditions(ok, w1.npcs[farmerId]!, w1), false);
});

test("preconditions: notBusy / notTraveling / notDetained", () => {
  const w0 = createWorld(1);
  const npcId = findNpcId(w0, (n) => n.siteId === "HumanVillageA" && n.alive);

  const base: ActionPrecondition[] = [{ type: "notBusy" }, { type: "notTraveling" }, { type: "notDetained" }];
  assert.equal(checkPreconditions(base, w0.npcs[npcId]!, w0), true);

  const wBusy = patchNpc(w0, npcId, { busyUntilTick: w0.tick + 5 });
  assert.equal(checkPreconditions(base, wBusy.npcs[npcId]!, wBusy), false);

  const travel: TravelState = {
    kind: "travel",
    from: "HumanVillageA",
    to: "HumanCityPort",
    totalKm: 10,
    remainingKm: 5,
    edgeQuality: "road",
    startedTick: w0.tick,
    lastProgressTick: w0.tick
  };
  const wTravel = patchNpc(w0, npcId, { travel });
  assert.equal(checkPreconditions(base, wTravel.npcs[npcId]!, wTravel), false);

  const wDetained = patchNpc(w0, npcId, {
    status: { detained: { byNpcId: npcId, atSiteId: "HumanVillageA", startedTick: w0.tick, untilTick: w0.tick + 10 } }
  });
  assert.equal(checkPreconditions(base, wDetained.npcs[npcId]!, wDetained), false);
});

test("preconditions: siteCondition + npcCondition numeric comparisons", () => {
  const w0 = createWorld(1);
  const farmerId = findNpcId(w0, (n) => n.category === "Farmer" && n.siteId === "HumanVillageA");

  const w1 = patchSite(w0, "HumanVillageA", { hunger: 80 });
  assert.equal(
    checkPreconditions([{ type: "siteCondition", field: "hunger", op: ">=", value: 50 }], w1.npcs[farmerId]!, w1),
    true
  );

  const w2 = patchNpc(w1, farmerId, { hp: 10 });
  assert.equal(checkPreconditions([{ type: "npcCondition", field: "hp", op: "<", value: 50 }], w2.npcs[farmerId]!, w2), true);

  const w3 = patchNpc(w0, farmerId, { siteId: "DeepForest" });
  assert.equal(
    checkPreconditions([{ type: "siteCondition", field: "hunger", op: ">=", value: 50 }], w3.npcs[farmerId]!, w3),
    false
  );
});

test("preconditions: hasTarget selector cultMemberAtSite", () => {
  const w0 = createWorld(1);

  const guardAtVillage = findNpcId(w0, (n) => n.category === "GuardMilitia" && n.siteId === "HumanVillageA");
  const p: ActionPrecondition[] = [{ type: "hasTarget", selector: { type: "cultMemberAtSite" } }];
  assert.equal(checkPreconditions(p, w0.npcs[guardAtVillage]!, w0), true);

  const elvenSentinel = findNpcId(w0, (n) => n.category === "ElvenWarriorSentinel" && n.siteId === "ElvenCity");
  const wNoCult = patchNpc(w0, elvenSentinel, { siteId: "ElvenCity" });
  assert.equal(checkPreconditions(p, wNoCult.npcs[elvenSentinel]!, wNoCult), false);
});


