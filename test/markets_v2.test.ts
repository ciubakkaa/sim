import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { tickHour } from "../src/sim/tick";
import type { WorldState } from "../src/sim/types";
import { createConfig, resetConfig, setConfig } from "../src/sim/config";

function patchNpc(world: WorldState, npcId: string, patch: any): WorldState {
  const npc = world.npcs[npcId];
  assert.ok(npc, "npc must exist");
  return { ...world, npcs: { ...world.npcs, [npcId]: { ...npc, ...patch } } };
}

test("v2 markets: trade performs local buy (coins -> personal food) when enabled", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(13001);
    const siteId = "HumanCityPort";
    const npcId =
      Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId && (n.category === "MerchantSmuggler" || n.category === "Craftsperson"))?.id ??
      Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId && !String(n.category).includes("Guard"))!.id;

    world = patchNpc(world, npcId, {
      busyUntilTick: 0,
      lastAttemptTick: -999,
      needs: { ...world.npcs[npcId]!.needs, Food: 90 },
      inventory: { coins: 100, food: {} }
    });

    const beforeCoins = world.npcs[npcId]!.inventory!.coins;
    const t0 = world.tick;
    const res = tickHour(world, {
      attempts: [
        {
          id: "att:test:market:buy",
          tick: t0 + 1,
          kind: "trade",
          visibility: "private",
          actorId: npcId,
          siteId,
          durationHours: 1,
          intentMagnitude: "normal"
        }
      ]
    });

    const after = res.world.npcs[npcId]!;
    const afterCoins = after.inventory!.coins;
    const foodTotal = (after.inventory!.food.grain ?? 0) + (after.inventory!.food.fish ?? 0) + (after.inventory!.food.meat ?? 0);
    assert.ok(foodTotal > 0, "expected food purchased into personal inventory");
    assert.ok(afterCoins < beforeCoins, "expected coins spent");
  } finally {
    resetConfig();
  }
});

test("v2 markets: trade performs local sell (personal food -> coins) when enabled", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(13002);
    const siteId = "HumanCityPort";
    const npcId = Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId && !String(n.category).includes("Guard"))!.id;

    world = patchNpc(world, npcId, {
      busyUntilTick: 0,
      lastAttemptTick: -999,
      needs: { ...world.npcs[npcId]!.needs, Food: 0, Wealth: 90 },
      inventory: { coins: 0, food: { grain: 20 } }
    });

    const beforeCoins = world.npcs[npcId]!.inventory!.coins;
    const beforeGrain = world.npcs[npcId]!.inventory!.food.grain ?? 0;

    const t0 = world.tick;
    const res = tickHour(world, {
      attempts: [
        {
          id: "att:test:market:sell",
          tick: t0 + 1,
          kind: "trade",
          visibility: "private",
          actorId: npcId,
          siteId,
          durationHours: 1,
          intentMagnitude: "normal"
        }
      ]
    });

    const after = res.world.npcs[npcId]!;
    const afterCoins = after.inventory!.coins;
    const afterGrain = after.inventory!.food.grain ?? 0;
    assert.ok(afterCoins > beforeCoins, "expected coins gained");
    assert.ok(afterGrain < beforeGrain, "expected personal food reduced");
  } finally {
    resetConfig();
  }
});


