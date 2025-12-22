import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { ACTION_DEFINITIONS } from "../src/sim/actions/definitions";
import { scoreActions, selectAction } from "../src/sim/actions/scoring";
import type { WorldState } from "../src/sim/types";

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

test("scoring: work_farm example math (base + need + trait + site condition)", () => {
  const w0 = createWorld(1);
  const farmerId = findNpcId(w0, (n) => n.category === "Farmer" && n.siteId === "HumanVillageA");

  const w1 = patchNpc(w0, farmerId, {
    needs: { ...w0.npcs[farmerId]!.needs, Food: 70, Duty: 30 },
    traits: { ...w0.npcs[farmerId]!.traits, Discipline: 60 }
  });
  const w2 = patchSite(w1, "HumanVillageA", { hunger: 55, fieldsCondition: 1 });

  const def = ACTION_DEFINITIONS.find((d) => d.kind === "work_farm");
  assert.ok(def, "work_farm definition missing");

  const scored = scoreActions(w2.npcs[farmerId]!, w2, [def], [], []);
  assert.equal(scored.length, 1);

  // Expected:
  // base 40
  // + Food 70 * 0.5 = 35
  // + Duty 30 * 0.3 = 9
  // + Discipline 60 * 0.2 = 12
  // + hunger > 50 = +20
  assert.equal(Math.round(scored[0]!.score), 116);
});

test("selectAction: weighted selection respects rng roll ordering", () => {
  const dummy = (roll: number) => ({ next: () => roll } as any);

  const a = { definition: { kind: "trade" } as any, score: 10 };
  const b = { definition: { kind: "travel" } as any, score: 30 };
  const c = { definition: { kind: "patrol" } as any, score: 60 };

  // roll=0 -> pick first
  assert.equal(selectAction([a, b, c] as any, dummy(0), 0)?.definition.kind, "trade");
  // roll close to 1 -> pick last
  assert.equal(selectAction([a, b, c] as any, dummy(0.999999), 0)?.definition.kind, "patrol");
});


