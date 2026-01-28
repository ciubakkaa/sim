import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createCrimeModule } from "../src/modules/crime/crimeModule";
import type { TickContext, DecisionInput } from "../src/kernel/kernelTypes";
import type { KernelEvent } from "../src/kernel/events/eventTypes";

function makeCtx(opts: {
  world: any;
  tick?: number;
  seed?: number;
  stableChance: (rollId: string, p: number) => boolean;
  stableInt: (rollId: string, min: number, max: number) => number;
  rollId: (p: any) => string;
}) {
  const emitted: any[] = [];
  const ctx: TickContext = {
    world: opts.world,
    tick: opts.tick ?? 10,
    seed: opts.seed ?? 123,
    emitEvent: (e) => {
      emitted.push(e);
      return `evt-${emitted.length}`;
    },
    emitTrace: () => "trace-mock",
    stableChance: opts.stableChance,
    stableInt: opts.stableInt,
    rollId: opts.rollId as any,
  };
  return { ctx, emitted };
}

function makeWorld(npcs: Record<string, any>) {
  return { tick: 10, seed: 1, npcs, sites: {}, map: { sites: [], edges: [] } };
}

function makeAttemptRecordedEvent(params: {
  id: string;
  tick: number;
  siteId: string;
  actorId: string;
  targetId: string;
  kind: string;
  visibility: "private" | "public";
}): KernelEvent {
  return {
    id: params.id,
    tick: params.tick,
    kind: "attempt.recorded",
    visibility: params.visibility,
    siteId: params.siteId,
    message: "attempt",
    data: {
      attempt: {
        kind: params.kind,
        actorId: params.actorId,
        targetId: params.targetId,
        siteId: params.siteId,
        visibility: params.visibility,
        tick: params.tick,
        durationHours: 1,
        magnitude: "normal",
      },
    },
  };
}

describe("crime module: observation uncertainty", () => {
  it("opens response with identified suspect and biases guards toward chase/arrest", () => {
    const mod = createCrimeModule();
    const siteId = "TownMarket";
    const thiefId = "npc:thief";
    const victimId = "npc:victim";
    const guardId = "npc:guard";

    const world = makeWorld({
      [thiefId]: { id: thiefId, name: "Thief", alive: true, siteId, category: "BanditRaider" },
      [victimId]: { id: victimId, name: "Victim", alive: true, siteId, category: "MerchantSmuggler" },
      [guardId]: { id: guardId, name: "Guard", alive: true, siteId, category: "GuardMilitia" },
    });

    const { ctx, emitted } = makeCtx({
      world,
      stableChance: (rollId) => {
        if (rollId.includes("crime.observe.saw_event")) return true;
        if (rollId.includes("crime.observe.saw_face")) return true;
        if (rollId.includes("crime.report.decide")) return true;
        return true;
      },
      stableInt: (rollId, min, max) => {
        if (rollId.includes("crime.observe.confidence")) return max;
        return min;
      },
      rollId: (p: any) => `${p.purpose}|agent=${p.agentId ?? ""}|target=${p.targetId ?? ""}`,
    });

    mod.onTickStart?.(ctx);
    mod.onEvent?.(
      ctx,
      makeAttemptRecordedEvent({
        id: "evt-crime-1",
        tick: ctx.tick,
        siteId,
        actorId: thiefId,
        targetId: victimId,
        kind: "steal",
        visibility: "private",
      })
    );

    // Should emit observation/report/response events.
    assert.ok(emitted.some((e) => e.kind === "crime.observation.created"));
    assert.ok(emitted.some((e) => e.kind === "crime.reported"));
    assert.ok(emitted.some((e) => e.kind === "crime.response.opened"));

    const input: DecisionInput = { options: [], modifiers: [], blockedActions: new Set() };
    const out = mod.onAgentDecide?.(ctx, guardId, input) ?? input;

    const chase = out.options.find((o) => o.actionKind === "chase");
    assert.ok(chase, "expected chase option");
    assert.equal(chase?.targetId, thiefId);

    assert.ok(out.modifiers.some((m) => m.actionKind === "arrest" && m.delta >= 50));
    assert.ok(out.modifiers.some((m) => m.actionKind === "chase" && m.delta >= 30));
  });

  it("opens response with unknown suspect and biases guards toward investigate", () => {
    const mod = createCrimeModule();
    const siteId = "TownMarket";
    const thiefId = "npc:thief";
    const victimId = "npc:victim";
    const guardId = "npc:guard";

    const world = makeWorld({
      [thiefId]: { id: thiefId, name: "Thief", alive: true, siteId, category: "BanditRaider" },
      [victimId]: { id: victimId, name: "Victim", alive: true, siteId, category: "MerchantSmuggler" },
      [guardId]: { id: guardId, name: "Guard", alive: true, siteId, category: "GuardMilitia" },
    });

    const { ctx } = makeCtx({
      world,
      stableChance: (rollId) => {
        if (rollId.includes("crime.observe.saw_event")) return true;
        if (rollId.includes("crime.observe.saw_face")) return false;
        if (rollId.includes("crime.report.decide")) return true;
        return true;
      },
      stableInt: (rollId, min, max) => {
        if (rollId.includes("crime.observe.confidence")) return min;
        return min;
      },
      rollId: (p: any) => `${p.purpose}|agent=${p.agentId ?? ""}|target=${p.targetId ?? ""}`,
    });

    mod.onEvent?.(
      ctx,
      makeAttemptRecordedEvent({
        id: "evt-crime-2",
        tick: ctx.tick,
        siteId,
        actorId: thiefId,
        targetId: victimId,
        kind: "steal",
        visibility: "private",
      })
    );

    const input: DecisionInput = { options: [], modifiers: [], blockedActions: new Set() };
    const out = mod.onAgentDecide?.(ctx, guardId, input) ?? input;

    assert.ok(out.options.some((o) => o.actionKind === "investigate"));
    assert.ok(out.modifiers.some((m) => m.actionKind === "investigate" && m.delta >= 30));
    assert.ok(!out.options.some((o) => o.actionKind === "chase"));
  });
});

