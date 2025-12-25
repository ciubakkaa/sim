import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { applyFoodProcessHourly } from "../src/sim/processes/foodProcess";
import { startTravel, progressTravelHourly } from "../src/sim/movement";
import { Rng } from "../src/sim/rng";

test("seasons: food production at dawn is lower in winter than summer (same site config)", () => {
  const base = createWorld(5);
  const siteId = "HumanVillageA";
  const site: any = base.sites[siteId];
  assert.equal(site.kind, "settlement");

  // Ensure labor was done to avoid no-labor penalty
  const sites = {
    ...base.sites,
    [siteId]: { ...site, fieldsCondition: 1, laborWorkedToday: { grain: 1, fish: 1, meat: 1 } }
  };

  // Summer: day 30, hour 6
  let worldSummer: any = { ...base, tick: 30 * 24 + 6, sites };
  const resSummer = applyFoodProcessHourly(worldSummer, { rng: new Rng(1), nextEventSeq: (() => { let i = 0; return () => ++i; })() });
  const prodSummer = resSummer.events.find((e) => e.kind === "world.food.produced" && e.siteId === siteId);
  assert.ok(prodSummer);
  const sumProduced = (x: any) => Object.values(x ?? {}).reduce((a: number, v: any) => a + Number(v ?? 0), 0);
  const totalSummer = sumProduced((prodSummer as any).data?.produced);

  // Winter: day 90, hour 6
  let worldWinter: any = { ...base, tick: 90 * 24 + 6, sites };
  const resWinter = applyFoodProcessHourly(worldWinter, { rng: new Rng(1), nextEventSeq: (() => { let i = 0; return () => ++i; })() });
  const prodWinter = resWinter.events.find((e) => e.kind === "world.food.produced" && e.siteId === siteId);
  assert.ok(prodWinter);
  const totalWinter = sumProduced((prodWinter as any).data?.produced);

  assert.ok(totalWinter <= totalSummer, `expected winter production <= summer (${totalWinter} <= ${totalSummer})`);
});

test("seasons: travel progresses slower in winter than summer for same traveler/edge", () => {
  const base = createWorld(6);
  const npc = Object.values(base.npcs).find((n) => n.alive && n.siteId === "HumanVillageA")!;
  assert.ok(npc);

  // Start travel to a known-neighbor site (world seed guarantees this edge)
  const to = "HumanCityPort";
  const started = startTravel(npc, base, to);
  assert.ok(started.npc.travel);

  const mkWorld = (tick: number) => ({
    ...base,
    tick,
    npcs: { ...base.npcs, [npc.id]: started.npc }
  });

  // Summer tick (day 30, hour 12)
  let wSummer: any = mkWorld(30 * 24 + 12);
  const s0 = (wSummer.npcs[npc.id]!.travel!.remainingKm as number);
  wSummer = progressTravelHourly(wSummer, { rng: new Rng(123), nextEventSeq: (() => { let i = 0; return () => ++i; })() }).world as any;
  const s1 = (wSummer.npcs[npc.id]!.travel!.remainingKm as number);

  // Winter tick (day 90, hour 12)
  let wWinter: any = mkWorld(90 * 24 + 12);
  const w0 = (wWinter.npcs[npc.id]!.travel!.remainingKm as number);
  wWinter = progressTravelHourly(wWinter, { rng: new Rng(123), nextEventSeq: (() => { let i = 0; return () => ++i; })() }).world as any;
  const w1 = (wWinter.npcs[npc.id]!.travel!.remainingKm as number);

  const progressedSummer = s0 - s1;
  const progressedWinter = w0 - w1;
  assert.ok(progressedWinter <= progressedSummer, `expected winter travel <= summer (${progressedWinter} <= ${progressedSummer})`);
});


