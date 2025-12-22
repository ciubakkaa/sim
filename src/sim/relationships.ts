import { clamp } from "./util";
import type { AttemptKind, NpcState, Relationship, SiteRumor, WorldState } from "./types";

export function baselineRelationship(a: NpcState, b: NpcState, world: WorldState): Relationship {
  if (a.id === b.id) return { trust: 100, fear: 0, loyalty: 100 };

  const aSite = world.sites[a.siteId];
  const bSite = world.sites[b.siteId];

  const sameSite = aSite?.id && bSite?.id && aSite.id === bSite.id;
  if (sameSite) {
    if (aSite.culture === bSite.culture) {
      if (aSite.culture === "elven") return { trust: 55, fear: 5, loyalty: 25 };
      if (aSite.culture === "human") return { trust: 45, fear: 10, loyalty: 20 };
    }
    return { trust: 32, fear: 12, loyalty: 5 };
  }

  // Bandits default to feared.
  if (b.category === "BanditRaider") return { trust: 10, fear: 60, loyalty: 0 };

  // Default strangers.
  return { trust: 35, fear: 15, loyalty: 5 };
}

export function getRelationship(a: NpcState, b: NpcState, world: WorldState): Relationship {
  return a.relationships[b.id] ?? baselineRelationship(a, b, world);
}

export function setRelationship(a: NpcState, bId: string, rel: Relationship): NpcState {
  return { ...a, relationships: { ...a.relationships, [bId]: rel } };
}

export function applyRelationshipDelta(
  a: NpcState,
  bId: string,
  world: WorldState,
  delta: Partial<Relationship>
): NpcState {
  const base = a.relationships[bId] ?? undefined;
  const b = world.npcs[bId];
  const current = base ?? (b ? baselineRelationship(a, b, world) : { trust: 35, fear: 15, loyalty: 5 });
  const next: Relationship = {
    trust: clamp(current.trust + (delta.trust ?? 0), 0, 100),
    fear: clamp(current.fear + (delta.fear ?? 0), 0, 100),
    loyalty: clamp(current.loyalty + (delta.loyalty ?? 0), 0, 100)
  };
  return setRelationship(a, bId, next);
}

export function relationshipDeltaFromRumor(
  npc: NpcState,
  rumor: SiteRumor,
  actor: NpcState | undefined
): { delta: Partial<Relationship>; confidence: number } | undefined {
  if (!actor || !rumor.actorId) return undefined;

  const conf = rumor.confidence;
  const kind = rumor.kind;

  if (kind === "steal") return { delta: { trust: -15, fear: +5 }, confidence: conf };
  if (kind === "assault") return { delta: { trust: -30, fear: +20 }, confidence: conf };
  if (kind === "kill") return { delta: { trust: -80, fear: +35, loyalty: -30 }, confidence: conf };
  if (kind === "raid" || kind === "incident") return { delta: { trust: -10, fear: +10 }, confidence: conf };
  if (kind === "kidnap" || kind === "forced_eclipse") return { delta: { trust: -60, fear: +25, loyalty: -15 }, confidence: conf };
  if (kind === "arrest") return { delta: { trust: +2 }, confidence: conf };
  if (kind === "trade") return { delta: { trust: +3 }, confidence: conf };

  if (kind === "preach_fixed_path") {
    const certainty = npc.traits.NeedForCertainty;
    if (certainty >= 60) return { delta: { trust: +10 }, confidence: conf };
    return { delta: { trust: -5, fear: +5 }, confidence: conf };
  }

  if (kind === "heal") return { delta: { trust: +10, loyalty: +5 }, confidence: conf };
  if (kind === "investigate") return { delta: { trust: +5 }, confidence: conf };

  return undefined;
}

export function scaleDeltaByConfidence(delta: Partial<Relationship>, confidence: number): Partial<Relationship> {
  let scale = 0;
  if (confidence >= 80) scale = 1;
  else if (confidence >= 50) scale = 0.6;
  else if (confidence >= 20) scale = 0.25;
  else scale = 0;

  return {
    trust: delta.trust ? Math.round(delta.trust * scale) : undefined,
    fear: delta.fear ? Math.round(delta.fear * scale) : undefined,
    loyalty: delta.loyalty ? Math.round(delta.loyalty * scale) : undefined
  };
}


