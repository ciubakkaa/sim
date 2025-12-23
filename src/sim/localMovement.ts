import type { LocalEdge, LocationId, NpcState, SettlementSiteState, SimEvent, WorldState } from "./types";
import { makeId } from "./ids";
import { clamp } from "./util";
import type { Rng } from "./rng";

export function isNpcLocalTraveling(npc: NpcState): boolean {
  return Boolean(npc.localTravel && npc.localTravel.remainingMeters > 0);
}

function edgesForSite(site: SettlementSiteState): LocalEdge[] {
  return site.local?.edges ?? [];
}

function neighbors(edges: LocalEdge[], from: LocationId): { to: LocationId; meters: number }[] {
  const out: { to: LocationId; meters: number }[] = [];
  for (const e of edges) {
    if (e.from === from) out.push({ to: e.to, meters: e.meters });
    else if (e.to === from) out.push({ to: e.from, meters: e.meters });
  }
  return out;
}

function shortestPathMeters(site: SettlementSiteState, from: LocationId, to: LocationId): number | undefined {
  if (from === to) return 0;
  const edges = edgesForSite(site);
  if (!edges.length) return undefined;

  // Dijkstra (small graphs; deterministic due to stable sorting)
  const dist = new Map<LocationId, number>();
  const visited = new Set<LocationId>();
  dist.set(from, 0);

  const pickNext = (): LocationId | undefined => {
    let best: { id: LocationId; d: number } | undefined;
    for (const [id, d] of dist.entries()) {
      if (visited.has(id)) continue;
      if (!best || d < best.d || (d === best.d && id.localeCompare(best.id) < 0)) best = { id, d };
    }
    return best?.id;
  };

  while (true) {
    const cur = pickNext();
    if (!cur) return undefined;
    if (cur === to) return dist.get(cur);
    visited.add(cur);

    const base = dist.get(cur)!;
    const nbs = neighbors(edges, cur).sort((a, b) => a.to.localeCompare(b.to));
    for (const nb of nbs) {
      if (visited.has(nb.to)) continue;
      const nd = base + nb.meters;
      const prev = dist.get(nb.to);
      if (prev === undefined || nd < prev) dist.set(nb.to, nd);
    }
  }
}

export function startLocalTravel(
  npc: NpcState,
  site: SettlementSiteState,
  toLocationId: LocationId,
  ctx: { rng: Rng; nextEventSeq: () => number },
  worldTick: number,
  purposeKind?: NpcState["busyKind"]
): { npc: NpcState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  if (!npc.alive) return { npc, events };
  if (!site.local) return { npc, events };

  const fromLocationId = npc.local?.siteId === site.id ? npc.local.locationId : `${site.id}:streets`;
  const meters = shortestPathMeters(site, fromLocationId, toLocationId);
  if (meters === undefined) return { npc, events };
  if (meters <= 0) {
    return { npc: { ...npc, local: { siteId: site.id, locationId: toLocationId }, localTravel: undefined }, events };
  }

  const nextNpc: NpcState = {
    ...npc,
    local: { siteId: site.id, locationId: fromLocationId },
    localTravel: {
      kind: "localTravel",
      siteId: site.id,
      fromLocationId,
      toLocationId,
      totalMeters: meters,
      remainingMeters: meters,
      startedTick: worldTick,
      lastProgressTick: worldTick,
      purposeKind: purposeKind as any
    }
  };

  events.push({
    id: makeId("evt", worldTick, ctx.nextEventSeq()),
    tick: worldTick,
    kind: "local.travel.started",
    visibility: "system",
    siteId: site.id,
    message: `${npc.name} started moving locally`,
    data: { npcId: npc.id, fromLocationId, toLocationId, totalMeters: meters, purposeKind }
  });

  return { npc: nextNpc, events };
}

function metersThisHour(): number {
  // inside settlements, movement is slower than open-road travel but still meaningful per hour
  return 450;
}

export function progressLocalTravelHourly(
  world: WorldState,
  ctx: { rng: Rng; nextEventSeq: () => number }
): { world: WorldState; events: SimEvent[]; keyChanges: string[] } {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  let nextWorld = world;
  const npcIds = Object.keys(world.npcs).sort();

  for (const npcId of npcIds) {
    const npc = nextWorld.npcs[npcId];
    if (!npc || !npc.alive) continue;
    if (!isNpcLocalTraveling(npc)) continue;
    const lt = npc.localTravel!;
    if (lt.lastProgressTick === world.tick) continue;

    const siteAny = nextWorld.sites[lt.siteId] as any;
    if (!siteAny || siteAny.kind !== "settlement" || !siteAny.local) continue;
    const site = siteAny as SettlementSiteState;

    const step = metersThisHour();
    const remaining = Math.max(0, lt.remainingMeters - step);
    const arrived = remaining <= 0;

    if (!arrived) {
      const updated: NpcState = {
        ...npc,
        localTravel: { ...lt, remainingMeters: remaining, lastProgressTick: world.tick }
      };
      nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [npc.id]: updated } };
      continue;
    }

    const updated: NpcState = {
      ...npc,
      local: { siteId: site.id, locationId: lt.toLocationId },
      localTravel: undefined
    };
    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [npc.id]: updated } };
    keyChanges.push(`${npc.name} arrived at ${lt.toLocationId}`);

    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind: "local.travel.arrived",
      visibility: "system",
      siteId: site.id,
      message: `${npc.name} arrived locally`,
      data: {
        npcId: npc.id,
        toLocationId: lt.toLocationId,
        purposeKind: lt.purposeKind
      }
    });
  }

  return { world: nextWorld, events, keyChanges };
}


