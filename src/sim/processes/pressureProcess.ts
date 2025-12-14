import { DIFFUSION_KM_SCALE } from "../constants";
import { makeId } from "../ids";
import { getNeighbors } from "../map";
import { clamp } from "../util";
import type { SimEvent, SiteState, WorldState } from "../types";
import type { ProcessContext, ProcessResult } from "./types";

function weightByKm(km: number): number {
  // Simple exponential-like decay using a rational approximation.
  // km=0 => 1.0, km=20 => 0.5, km=40 => 0.33...
  return DIFFUSION_KM_SCALE / (DIFFUSION_KM_SCALE + Math.max(0, km));
}

function localEclipsingSource(site: SiteState): number {
  if (site.kind === "special" && site.id === "AncientRuin") return 90;
  if (site.kind === "hideout") return 55;
  return 0;
}

export function applyEclipsingPressureHourly(world: WorldState, ctx: ProcessContext): ProcessResult {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  const nextSites: Record<string, SiteState> = { ...world.sites };

  for (const siteId of world.map.sites) {
    const site = world.sites[siteId];
    const neighbors = getNeighbors(world.map, siteId);

    let sum = 0;
    let wSum = 0;
    for (const n of neighbors) {
      const w = weightByKm(n.km);
      sum += (world.sites[n.to]?.eclipsingPressure ?? 0) * w;
      wSum += w;
    }
    const neighborAvg = wSum > 0 ? sum / wSum : 0;

    const source = localEclipsingSource(site);
    const decay = 0.985;
    const blended = (neighborAvg * 0.55 + source) * decay;
    const nextPressure = clamp(blended, 0, 100);

    if (Math.abs(nextPressure - site.eclipsingPressure) >= 3) {
      keyChanges.push(`${site.name} eclipsing pressure is now ${nextPressure.toFixed(0)}`);
    }

    nextSites[siteId] = { ...site, eclipsingPressure: nextPressure };

    events.push({
      id: makeId("evt", world.tick, ctx.nextEventSeq()),
      tick: world.tick,
      kind: "world.eclipsing.pressure",
      visibility: "system",
      siteId,
      message: `Eclipsing pressure updated at ${site.name}`,
      data: { nextPressure, neighborAvg, source }
    });
  }

  return { world: { ...world, sites: nextSites }, events, keyChanges };
}


