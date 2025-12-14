import { makeId } from "../ids";
import { clamp } from "../util";
import type { SettlementSiteState, SimEvent, WorldState } from "../types";
import type { ProcessContext, ProcessResult } from "./types";

function isSettlement(site: unknown): site is SettlementSiteState {
  return Boolean(site && (site as SettlementSiteState).kind === "settlement");
}

export function applyUnrestProcessHourly(world: WorldState, ctx: ProcessContext): ProcessResult {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  let nextWorld = world;

  for (const siteId of world.map.sites) {
    const site = nextWorld.sites[siteId];
    if (!isSettlement(site)) continue;

    const pop = site.cohorts.children + site.cohorts.adults + site.cohorts.elders;
    // Unrest should track experienced hardship (hunger), not "low pantry reserves".
    const hunger = clamp(site.hunger ?? 0, 0, 100);
    const hungerStress = (hunger / 100) * 1.6; // 0..1.6
    const relief = hunger < 5 ? 0.6 : 0; // very mild calming when consistently fed

    const baseDelta = hungerStress * 0.9 - relief * 0.4; // small hourly drift
    const cultStress = Math.round((site.cultInfluence / 100) * 0.3);
    const pressureStress = Math.round((site.eclipsingPressure / 100) * 0.2);
    const sicknessStress = Math.round((site.sickness / 100) * 0.2);

    const noise = ctx.rng.int(-1, 1) * 0.1;
    const unrestDelta = baseDelta + cultStress + pressureStress + sicknessStress + noise;

    const nextUnrest = clamp(site.unrest + unrestDelta, 0, 100);
    const moraleDelta = -unrestDelta * 0.6 + (ctx.rng.int(-1, 1) * 0.1);
    const nextMorale = clamp(site.morale + moraleDelta, 0, 100);

    const updated: SettlementSiteState = { ...site, unrest: nextUnrest, morale: nextMorale };

    if (Math.abs(unrestDelta) >= 1) {
      keyChanges.push(`${site.name} unrest ${unrestDelta > 0 ? "rose" : "fell"} (${unrestDelta.toFixed(1)})`);
    }

    nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [siteId]: updated } };

    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind: "world.unrest.drifted",
      visibility: "system",
      siteId,
      message: `Unrest drifted at ${site.name}`,
      data: { delta: unrestDelta, hunger, hungerStress, cultStress, pressureStress, sicknessStress }
    });

    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind: "world.morale.drifted",
      visibility: "system",
      siteId,
      message: `Morale drifted at ${site.name}`,
      data: { delta: moraleDelta }
    });
  }

  return { world: nextWorld, events, keyChanges };
}


