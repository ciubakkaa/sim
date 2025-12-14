import { DIFFUSION_KM_SCALE } from "../constants";
import { makeId } from "../ids";
import { getNeighbors } from "../map";
import { clamp } from "../util";
import type { SimEvent, SiteState, WorldState } from "../types";
import type { ProcessContext, ProcessResult } from "./types";

function weightByKm(km: number): number {
  return DIFFUSION_KM_SCALE / (DIFFUSION_KM_SCALE + Math.max(0, km));
}

function localAnchoringSource(site: SiteState): number {
  if (site.kind !== "settlement") return 0;
  if (site.id === "ElvenCity") return 85;
  if (site.id === "ElvenTownFortified") return 65;
  return 0;
}

export function applyAnchoringHourly(world: WorldState, ctx: ProcessContext): ProcessResult {
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
      sum += (world.sites[n.to]?.anchoringStrength ?? 0) * w;
      wSum += w;
    }
    const neighborAvg = wSum > 0 ? sum / wSum : 0;

    const source = localAnchoringSource(site);
    const decay = 0.99;
    const blended = (neighborAvg * 0.6 + source) * decay;
    const nextStrength = clamp(blended, 0, 100);

    if (Math.abs(nextStrength - site.anchoringStrength) >= 3) {
      keyChanges.push(`${site.name} anchoring is now ${nextStrength.toFixed(0)}`);
    }

    nextSites[siteId] = { ...site, anchoringStrength: nextStrength };

    events.push({
      id: makeId("evt", world.tick, ctx.nextEventSeq()),
      tick: world.tick,
      kind: "world.anchoring.strength",
      visibility: "system",
      siteId,
      message: `Anchoring strength updated at ${site.name}`,
      data: { nextStrength, neighborAvg, source }
    });
  }

  return { world: { ...world, sites: nextSites }, events, keyChanges };
}


