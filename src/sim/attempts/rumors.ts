import type { NpcId, NpcState, SettlementSiteState, SiteRumor, WorldState } from "../types";
import { tickToDay } from "../types";
import { applyRelationshipDelta, relationshipDeltaFromRumor, scaleDeltaByConfidence } from "../relationships";

export function isSettlement(site: any): site is SettlementSiteState {
  return Boolean(site && site.kind === "settlement");
}

export function addRumor(site: SettlementSiteState, rumor: SiteRumor): SettlementSiteState {
  const next = [...site.rumors, rumor];
  const trimmed = next.length > 120 ? next.slice(next.length - 120) : next;
  return { ...site, rumors: trimmed };
}

export function witnessesInSite(world: WorldState, siteId: string): NpcId[] {
  return Object.values(world.npcs)
    .filter((n) => n.siteId === siteId)
    .map((n) => n.id);
}

export function applyPublicRumorAndRelationships(world: WorldState, rumor: SiteRumor): WorldState {
  const site = world.sites[rumor.siteId];
  if (!isSettlement(site)) return world;

  let nextWorld: WorldState = {
    ...world,
    sites: { ...world.sites, [rumor.siteId]: addRumor(site, rumor) }
  };

  const witnesses = witnessesInSite(nextWorld, rumor.siteId);
  for (const wId of witnesses) {
    if (!rumor.actorId || wId === rumor.actorId) continue;
    const w = nextWorld.npcs[wId];
    const actor = nextWorld.npcs[rumor.actorId];
    const change = relationshipDeltaFromRumor(w, rumor, actor);
    if (!change) continue;
    const scaled = scaleDeltaByConfidence(change.delta, change.confidence);
    const updated = applyRelationshipDelta(w, rumor.actorId, nextWorld, scaled);
    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [wId]: updated } };
  }

  return nextWorld;
}

export function ingestRumorsOnArrival(npc: NpcState, site: SettlementSiteState, world: WorldState): NpcState {
  const nowDay = tickToDay(world.tick);
  const cutoffDay = nowDay - 7;
  let nextNpc = npc;

  for (const rumor of site.rumors) {
    const rumorDay = tickToDay(rumor.tick);
    if (rumorDay < cutoffDay) continue;
    if (!rumor.actorId) continue;
    if (rumor.actorId === npc.id) continue;

    const actor = world.npcs[rumor.actorId];
    const change = relationshipDeltaFromRumor(npc, rumor, actor);
    if (!change) continue;
    const scaled = scaleDeltaByConfidence(change.delta, change.confidence);
    nextNpc = applyRelationshipDelta(nextNpc, rumor.actorId, world, scaled);
  }

  return nextNpc;
}


