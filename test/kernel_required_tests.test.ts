import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeSemanticDigest } from "../src/kernel/events/digest";
import { TraceLog } from "../src/kernel/traces/traceLog";

import { tickHour } from "../src/sim/tick";
import { createVerticalSliceWorld } from "../src/sim/scenarios/kernel_v0_verticalSlice";

import {
  initializeRoleSlotsFromWorld,
  createEmptyPromotionState,
  checkPromotions,
  DEFAULT_PROMOTION_CONFIG,
  type PromotionState,
} from "../src/kernel/population/promotion";

import { initializePoolsFromWorld } from "../src/kernel/population/pools";
import type { SiteId } from "../src/sim/types";

function aliveNamedCount(world: { npcs: Record<string, { alive: boolean }> }): number {
  return Object.values(world.npcs).filter(n => n.alive).length;
}

function aliveNamedCountBySite(world: { npcs: Record<string, { alive: boolean; siteId: string }> }): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive) continue;
    counts[npc.siteId] = (counts[npc.siteId] ?? 0) + 1;
  }
  return counts;
}

describe("kernel plan required tests", () => {
  it("semantic digest determinism: same seed produces identical semantic digest", () => {
    const runHours = (seed: number, hours: number) => {
      let world = createVerticalSliceWorld(seed);
      const events: any[] = [];
      for (let i = 0; i < hours; i++) {
        const res = tickHour(world);
        world = res.world;
        events.push(...res.events);
      }
      return computeSemanticDigest(events);
    };

    const digest1 = runHours(12345, 6);
    const digest2 = runHours(12345, 6);

    assert.equal(digest1, digest2);
    assert.ok(/^[0-9a-f]{8}$/.test(digest1), `Expected 8-char hex digest, got: ${digest1}`);
  });

  it("promotion: restores named population after deaths", () => {
    let world = createVerticalSliceWorld(42);

    const initialBySite = aliveNamedCountBySite(world as any);
    const initialTotal = aliveNamedCount(world as any);

    // Track vacancies by initializing slots BEFORE deaths.
    let promotionState: PromotionState = {
      roleSlots: initializeRoleSlotsFromWorld(world),
      trainees: [],
    };

    const poolState = initializePoolsFromWorld(world.sites as any);

    // Kill 10 named agents deterministically (sorted IDs for stability).
    const aliveIds = Object.values(world.npcs)
      .filter(n => n.alive)
      .map(n => n.id)
      .sort();
    for (const id of aliveIds.slice(0, 10)) {
      world.npcs[id]!.alive = false;
    }

    const afterDeathsTotal = aliveNamedCount(world as any);
    assert.equal(afterDeathsTotal, initialTotal - 10);

    const config = {
      ...DEFAULT_PROMOTION_CONFIG,
      targetNamedAgentsPerSite: initialBySite,
      maxPromotionsPerTick: 3, // keep test runtime small
    };

    // Run promotions for up to 30 days (720 hours), but break early once restored.
    for (let i = 0; i < 24 * 30; i++) {
      const result = checkPromotions(world, promotionState, poolState, config);
      promotionState = result.state;

      if (result.newNpcs.length > 0) {
        for (const npc of result.newNpcs) {
          world.npcs[npc.id] = npc;
        }
        // Keep v2-compatible alias in sync if present.
        if ((world as any).entities) {
          (world as any).entities = world.npcs;
        }
      }

      if (aliveNamedCount(world as any) >= initialTotal - 3) {
        break;
      }

      world = { ...world, tick: world.tick + 1 };
    }

    assert.ok(
      aliveNamedCount(world as any) >= initialTotal - 3,
      `Expected named population to recover near initial (${initialTotal}), got ${aliveNamedCount(world as any)}`
    );
  });

  it("decision traces: traces present in TraceLog", () => {
    const traceLog = new TraceLog({ devMode: true });

    traceLog.emitDecision({
      tick: 1,
      agentId: "npc:test",
      reason: "plan_created",
      location: { siteId: "TownMarket" as SiteId, locationId: "TownMarket:street:i0" },
      needsSnapshot: { Food: 0.2 },
      traitSnapshot: { Discipline: 0.6 },
      topOptions: [{ actionKind: "idle", score: 1, reasons: ["baseline"] }],
      chosenOption: { actionKind: "idle", score: 1 },
      perceivedInfoRefs: {},
    });

    const traces = traceLog.getAll();
    assert.ok(traces.length > 0);
    assert.ok(traces[0]?.topOptions?.length >= 1);
    assert.ok(traces[0]?.chosenOption?.actionKind);
  });
});

