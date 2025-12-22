import type { NpcId, NpcState, SettlementSiteState, SiteRumor, WorldState } from "../types";
import { tickToDay } from "../types";
import { applyRelationshipDelta, relationshipDeltaFromRumor, scaleDeltaByConfidence } from "../relationships";
import { isNpcTraveling } from "../movement";
import { recordDid } from "../beliefs";

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
    .filter((n) => n.siteId === siteId && !isNpcTraveling(n))
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
    let updated = applyRelationshipDelta(w, rumor.actorId, nextWorld, scaled);
    updated = recordDid(updated, rumor.actorId, String(rumor.kind), rumor.confidence, "witnessed", nextWorld.tick);
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
    nextNpc = recordDid(nextNpc, rumor.actorId, String(rumor.kind), rumor.confidence, "rumor", world.tick);
  }

  return nextNpc;
}

export function shareBeliefsOnArrival(npc: NpcState, site: SettlementSiteState, world: WorldState): SettlementSiteState {
  // Convert one recent high-confidence belief into a local rumor buffer entry (no immediate relationship updates).
  const nowDay = tickToDay(world.tick);
  const recent = npc.beliefs
    .filter((b) => tickToDay(b.tick) >= nowDay - 7 && b.confidence >= 55 && b.predicate === "did")
    .sort((a, b) => b.confidence - a.confidence || b.tick - a.tick);
  if (!recent.length) return site;

  const b = recent[0]!;
  const conf = Math.round(b.confidence * 0.6);
  const label = `Gossip: ${b.subjectId} ${b.predicate} ${b.object}`;
  return addRumor(site, {
    tick: world.tick,
    kind: (b.object as any) ?? "incident",
    actorId: b.subjectId,
    siteId: site.id,
    confidence: conf,
    label
  });
}


