import { makeId } from "../ids";
import type { NpcId, NpcIntent, NpcState, SettlementSiteState, SimEvent, SiteId, WorldState } from "../types";
import { clamp } from "../util";
import { tickToHourOfDay } from "../types";
import { getNeighbors } from "../map";
import { addRumor, isSettlement } from "../attempts/rumors";

export type IntentUpdateCtx = {
  nextEventSeq: () => number;
};

function ensureIntents(n: NpcState): NpcIntent[] {
  return n.intents ?? [];
}

function decayIntents(intents: NpcIntent[]): NpcIntent[] {
  // v1: quick decay to keep intents small/short-lived.
  const out: NpcIntent[] = [];
  for (const it of intents) {
    const nextIntensity = clamp(it.intensity - 8, 0, 100);
    // Keep long-horizon plans around longer.
    const keep = it.kind === "raid_plan" ? nextIntensity >= 15 : nextIntensity >= 25;
    if (!keep) continue;
    out.push({ ...it, intensity: nextIntensity });
  }
  return out;
}

function strongestCrimeTarget(npc: NpcState, world: WorldState): { targetId: NpcId; confidence: number; kind: string } | null {
  const seen = npc.beliefs
    .filter((b) => b.predicate === "witnessed_crime")
    .map((b) => ({ targetId: b.subjectId as NpcId, confidence: b.confidence, kind: b.object }))
    .filter((x) => x.targetId && world.npcs[x.targetId]?.alive && world.npcs[x.targetId]?.siteId === npc.siteId)
    .sort((a, b) => b.confidence - a.confidence || String(a.targetId).localeCompare(String(b.targetId)));
  return seen[0] ?? null;
}

function addOrReplaceIntent(intents: NpcIntent[], next: NpcIntent): NpcIntent[] {
  const idx = intents.findIndex(
    (i) =>
      i.kind === next.kind &&
      i.targetNpcId === next.targetNpcId &&
      i.targetSiteId === next.targetSiteId &&
      i.executeAtTick === next.executeAtTick
  );
  if (idx >= 0) {
    const prev = intents[idx]!;
    // keep previous id/formedTick for stability
    const merged: NpcIntent = {
      ...prev,
      intensity: Math.max(prev.intensity, next.intensity),
      whyText: next.whyText ?? prev.whyText,
      data: { ...(prev.data ?? {}), ...(next.data ?? {}) }
    };
    const out = [...intents];
    out[idx] = merged;
    return out;
  }
  return [...intents, next];
}

function maybeCreateAttackIntent(npc: NpcState, world: WorldState): NpcIntent | null {
  const t = strongestCrimeTarget(npc, world);
  if (!t) return null;

  const aggression = npc.traits.Aggression ?? 0;
  const discipline = npc.traits.Discipline ?? 50;
  const integrity = npc.traits.Integrity ?? 50;

  // If very disciplined / high integrity, intent is weaker.
  const raw = aggression * 0.55 + t.confidence * 0.55 - discipline * 0.25 - integrity * 0.15;
  const intensity = clamp(Math.round(raw), 0, 100);
  if (intensity < 45) return null;

  return {
    id: makeId("intent", world.tick, Math.floor((npc.traits.Aggression ?? 0) * 1000) + world.tick),
    kind: "attack",
    formedTick: world.tick,
    intensity,
    targetNpcId: t.targetId,
    whyText: `crime=${String(t.kind)} confidence=${t.confidence} aggression=${Math.round(aggression)}`
  };
}

function maybeCreateRaidPlanIntent(npc: NpcState, world: WorldState): NpcIntent | null {
  // Only cult leaders plan raids in v1.
  if (!npc.cult?.member) return null;
  if (npc.cult.role !== "cell_leader") return null;

  const siteAny: any = world.sites[npc.siteId];
  if (!isSettlement(siteAny)) return null;
  const cultInfluence = typeof (siteAny as any).cultInfluence === "number" ? (siteAny as any).cultInfluence : 0;
  if (cultInfluence < 45) return null;

  // Plan at daily boundary only.
  const hour = tickToHourOfDay(world.tick);
  if (hour !== 0) return null;

  // Choose a neighboring settlement as target (prefer human).
  const neighbors = getNeighbors(world.map, npc.siteId);
  const candidates: SiteId[] = neighbors
    .map((e) => e.to as SiteId)
    .filter((id) => {
      const s: any = world.sites[id];
      return s?.kind === "settlement";
    })
    .sort();
  if (!candidates.length) return null;

  const preferred = candidates.filter((id) => (world.sites as any)[id]?.culture === "human");
  const targetSiteId = (preferred[0] ?? candidates[0]) as SiteId;

  // Execute in ~3 days.
  const executeAtTick = world.tick + 24 * 3;
  return {
    id: makeId("intent", world.tick, 100 + world.tick),
    kind: "raid_plan",
    formedTick: world.tick,
    intensity: clamp(Math.round(55 + cultInfluence * 0.4), 0, 100),
    executeAtTick,
    targetSiteId,
    whyText: `cultInfluence=${Math.round(cultInfluence)} target=${targetSiteId} eta=${executeAtTick}`
  };
}

function maybeSignalIntent(world: WorldState, npc: NpcState, intent: NpcIntent, ctx: IntentUpdateCtx): SimEvent | null {
  // Signal only in settlements (tells are local).
  const siteAny: any = world.sites[npc.siteId];
  if (!isSettlement(siteAny)) return null;

  // No repeated signaling within 4 ticks.
  if (intent.lastSignaledTick !== undefined && world.tick - intent.lastSignaledTick < 4) return null;

  if (intent.kind === "attack" && intent.intensity >= 80 && intent.targetNpcId) {
    return {
      id: makeId("evt", world.tick, ctx.nextEventSeq()),
      tick: world.tick,
      kind: "intent.signaled",
      visibility: "public",
      siteId: npc.siteId,
      message: `${npc.name} looked ready to attack`,
      data: {
        actorId: npc.id,
        targetId: intent.targetNpcId,
        intentKind: intent.kind,
        signal: "weapon_draw",
        intensity: intent.intensity
      }
    };
  }

  return null;
}

function maybeLeakRaidRumor(world: WorldState, npc: NpcState, intent: NpcIntent, ctx: IntentUpdateCtx): { world: WorldState; event?: SimEvent } {
  if (intent.kind !== "raid_plan") return { world };
  const siteAny: any = world.sites[npc.siteId];
  if (!isSettlement(siteAny)) return { world };

  // Leak chance: small, deterministic per day via tick boundary (hour 0 already).
  const leakChance = 0.22;
  const seedish = ((world.seed ^ world.tick) >>> 0) % 1000;
  const roll = seedish / 1000;
  if (roll > leakChance) return { world };

  const target = intent.targetSiteId ?? "unknown";
  const etaH = intent.executeAtTick ? Math.max(0, intent.executeAtTick - world.tick) : 72;
  const days = Math.max(1, Math.round(etaH / 24));
  const label = `Rumor: a cult cell plans a raid on ${target} in ~${days} days`;

  const rumorSite = siteAny as SettlementSiteState;
  const updatedSite = addRumor(rumorSite, {
    tick: world.tick,
    kind: "raid",
    actorId: npc.id,
    siteId: npc.siteId,
    confidence: 35,
    label
  });
  const nextWorld: WorldState = { ...world, sites: { ...world.sites, [npc.siteId]: updatedSite } };
  const ev: SimEvent = {
    id: makeId("evt", world.tick, ctx.nextEventSeq()),
    tick: world.tick,
    kind: "world.incident",
    visibility: "system",
    siteId: npc.siteId,
    message: label,
    data: { rumor: { kind: "raid", actorId: npc.id, siteId: npc.siteId, confidence: 35, label }, intentId: intent.id }
  };
  return { world: nextWorld, event: ev };
}

export function updateIntents(
  world: WorldState,
  ctx: IntentUpdateCtx
): { world: WorldState; events: SimEvent[]; keyChanges: string[] } {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  let nextWorld = world;
  const nextNpcs: Record<string, NpcState> = { ...world.npcs };
  let changed = false;

  const ids = Object.keys(world.npcs).sort();
  for (const id of ids) {
    const npc = world.npcs[id]!;
    if (!npc.alive) continue;

    let intents = decayIntents(ensureIntents(npc));

    const attack = maybeCreateAttackIntent(npc, nextWorld);
    if (attack) intents = addOrReplaceIntent(intents, attack);

    const raidPlan = maybeCreateRaidPlanIntent(npc, nextWorld);
    if (raidPlan) intents = addOrReplaceIntent(intents, raidPlan);

    // Signals & rumor leaks.
    for (const it of intents) {
      const sig = maybeSignalIntent(nextWorld, npc, it, ctx);
      if (sig) {
        events.push(sig);
        it.lastSignaledTick = nextWorld.tick;
      }
      const leaked = maybeLeakRaidRumor(nextWorld, npc, it, ctx);
      if (leaked.event) {
        nextWorld = leaked.world;
        events.push(leaked.event);
        keyChanges.push(leaked.event.message);
      }
    }

    // Keep bounded.
    intents.sort((a, b) => b.intensity - a.intensity || String(a.kind).localeCompare(String(b.kind)));
    const trimmed = intents.length > 8 ? intents.slice(0, 8) : intents;

    if (trimmed.length !== (npc.intents?.length ?? 0)) {
      changed = true;
      nextNpcs[id] = { ...npc, intents: trimmed };
    } else {
      // Cheap equality: compare kinds/targets/intensity.
      const prev = npc.intents ?? [];
      let same = prev.length === trimmed.length;
      for (let i = 0; same && i < prev.length; i++) {
        const a = prev[i]!;
        const b = trimmed[i]!;
        if (a.kind !== b.kind) same = false;
        else if (a.targetNpcId !== b.targetNpcId) same = false;
        else if (a.targetSiteId !== b.targetSiteId) same = false;
        else if (a.executeAtTick !== b.executeAtTick) same = false;
        else if (a.intensity !== b.intensity) same = false;
        else if (a.lastSignaledTick !== b.lastSignaledTick) same = false;
      }
      if (!same) {
        changed = true;
        nextNpcs[id] = { ...npc, intents: trimmed };
      }
    }
  }

  if (changed) nextWorld = { ...nextWorld, npcs: nextNpcs };
  return { world: nextWorld, events, keyChanges };
}


