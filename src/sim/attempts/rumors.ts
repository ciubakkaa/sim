import type { NpcId, NpcState, SettlementSiteState, SiteRumor, WorldState } from "../types";
import { tickToDay } from "../types";
import { applyRelationshipDelta, relationshipDeltaFromRumor, scaleDeltaByConfidence } from "../relationships";
import { isNpcTraveling } from "../movement";
import { recordDid } from "../beliefs";
import { getConfig } from "../config";
import { getNeighbors } from "../map";
import type { Rng } from "../rng";

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

function mutateRumorLabel(r: SiteRumor): string {
  // Very lightweight mutation: soften certainty and/or remove some details.
  const base = r.label || "Rumor";
  if (base.toLowerCase().includes("rumor:")) return base.replace(/rumor:\s*/i, "Rumor: maybe ");
  if (base.toLowerCase().includes("gossip:")) return base.replace(/gossip:\s*/i, "Gossip: maybe ");
  return `Maybe: ${base}`;
}

export function decayRumorsDaily(world: WorldState): WorldState {
  const cfg = getConfig();

  const nowDay = tickToDay(world.tick);
  const decay = Math.max(0, Math.round(10 * (cfg.tuning.rumorDecayPerDay ?? 0.5)));
  const maxSiteRumors = 120;

  let changed = false;
  const nextSites: typeof world.sites = { ...world.sites };

  for (const [id, s] of Object.entries(world.sites)) {
    if (!isSettlement(s) || !s.rumors?.length) continue;
    const nextRumors: SiteRumor[] = [];
    for (const r of s.rumors) {
      const ageDays = nowDay - tickToDay(r.tick);
      if (ageDays > 14) continue;
      const confidence = Math.max(0, Math.round(r.confidence - decay * Math.max(1, ageDays)));
      if (confidence < 10) continue;
      nextRumors.push({ ...r, confidence });
    }
    const bounded = nextRumors.length > maxSiteRumors ? nextRumors.slice(nextRumors.length - maxSiteRumors) : nextRumors;
    if (bounded.length !== s.rumors.length) {
      nextSites[id] = { ...s, rumors: bounded };
      changed = true;
    }
  }

  return changed ? { ...world, sites: nextSites } : world;
}

export function spreadRumorsDaily(world: WorldState, rng: Rng): WorldState {
  const cfg = getConfig();

  // Per day: for each settlement, maybe spread one recent rumor to one neighboring site.
  let nextWorld = world;
  const chance = cfg.tuning.rumorSpreadChance ?? 0.15;
  const mutateChance = cfg.tuning.rumorMutationChance ?? 0.1;

  const settlementIds = Object.values(world.sites)
    .filter(isSettlement)
    .map((s) => s.id)
    .sort();

  for (const siteId of settlementIds) {
    const s = nextWorld.sites[siteId];
    if (!isSettlement(s) || !s.rumors?.length) continue;
    if (!rng.chance(chance)) continue;

    const neighbors = getNeighbors(nextWorld.map, siteId)
      .map((e) => e.to)
      .filter((to) => isSettlement(nextWorld.sites[to]));
    if (!neighbors.length) continue;

    const destId = neighbors[rng.int(0, neighbors.length - 1)]!;
    const recent = s.rumors.slice(-20);
    const picked = recent[rng.int(0, recent.length - 1)]!;

    const mutated = rng.chance(mutateChance) ? mutateRumorLabel(picked) : picked.label;
    const nextRumor: SiteRumor = {
      ...picked,
      tick: nextWorld.tick,
      siteId: destId,
      confidence: Math.max(10, Math.round(picked.confidence * 0.7)),
      label: mutated
    };

    nextWorld = applyPublicRumorAndRelationships(nextWorld, nextRumor);
  }

  return nextWorld;
}


