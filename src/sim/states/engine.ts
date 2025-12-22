import type { Attempt, NpcId, NpcState, SimEvent, SimTick, SiteState, WorldState } from "../types";
import { tickToHourOfDay } from "../types";
import { isNpcTraveling } from "../movement";
import { getRelationship } from "../relationships";
import type { ActiveState, ReactiveStateDefinition, StateTrigger } from "./types";
import { STATE_DEFINITIONS } from "./definitions";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function asAttempt(e: SimEvent): Attempt | undefined {
  return (e.data as any)?.attempt as Attempt | undefined;
}

function attemptSuccess(e: SimEvent): boolean | undefined {
  return (e.data as any)?.success as boolean | undefined;
}

function asVictimMatches(trigger: Extract<StateTrigger, { type: "witnessedAttempt" }>, npcId: NpcId, attempt: Attempt): boolean {
  if (trigger.asVictim === undefined) return true;
  const isVictim = attempt.targetId === npcId;
  return trigger.asVictim ? isVictim : !isVictim;
}

function siteNumberField(site: SiteState | undefined, field: string): number | undefined {
  const v = (site as any)?.[field];
  return typeof v === "number" ? v : undefined;
}

function compare(op: string, a: number, b: number): boolean {
  switch (op) {
    case ">":
      return a > b;
    case "<":
      return a < b;
    case "=":
      return a === b;
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    default:
      return false;
  }
}

export function decayActiveStates(
  active: ActiveState[],
  tick: SimTick,
  definitionsById: Map<string, ReactiveStateDefinition>
): ActiveState[] {
  const next: ActiveState[] = [];
  for (const s of active) {
    const def = definitionsById.get(s.definitionId);
    if (!def) continue;
    if (tick >= s.expiresAtTick) continue;

    let intensity = s.intensity;
    const dur = Math.max(0, def.baseDurationHours);
    if (dur > 0 && def.decayRateModifier > 0) {
      const deltaPerHour = (100 / dur) * def.decayRateModifier;
      intensity = clamp(intensity - deltaPerHour, 0, 100);
    }

    if (intensity <= 0) continue;
    next.push({ ...s, intensity });
  }
  return next;
}

function resistanceMultiplier(def: ReactiveStateDefinition, npc: NpcState): number {
  // Positive resistance traits reduce intensity; negative values increase intensity.
  let mult = 1;
  for (const [k, v] of Object.entries(def.resistanceTraits)) {
    const trait = npc.traits[k as keyof NpcState["traits"]] ?? 0;
    mult -= (v ?? 0) * (trait / 100);
  }
  return clamp(mult, 0.2, 2.0);
}

function evaluateNeedThresholdMemory(
  npc: NpcState,
  tick: SimTick,
  trigger: Extract<StateTrigger, { type: "needThreshold" }>
): { memory: Record<string, SimTick>; ok: boolean } {
  const key = `need:${trigger.need}:${trigger.op}:${trigger.value}`;
  const nowOk = compare(trigger.op, npc.needs[trigger.need], trigger.value);

  const memory = { ...npc.stateTriggerMemory };
  if (!nowOk) {
    delete memory[key];
    return { memory, ok: false };
  }
  const since = memory[key];
  if (since === undefined) {
    memory[key] = tick;
    return { memory, ok: false };
  }
  const heldHours = tick - since;
  return { memory, ok: heldHours >= trigger.duration };
}

function familyNearby(npc: NpcState, world: WorldState): number {
  for (const id of npc.familyIds) {
    const f = world.npcs[id];
    if (!f || !f.alive) continue;
    if (isNpcTraveling(f)) continue;
    if (f.siteId === npc.siteId) return 1;
  }
  return 0;
}

export function didTrigger(
  def: ReactiveStateDefinition,
  npc: NpcState,
  prevNpc: NpcState | undefined,
  world: WorldState,
  prevWorld: WorldState,
  events: SimEvent[]
): { memory: Record<string, SimTick>; ok: boolean } {
  let memory = npc.stateTriggerMemory;

  const site = world.sites[npc.siteId];
  const hour = tickToHourOfDay(world.tick);

  // Attempt events at this tick.
  const attemptEvents = events.filter((e) => e.kind === "attempt.recorded");

  // Diff beliefs for beliefGained triggers.
  const prevBeliefs = new Set((prevNpc?.beliefs ?? []).map((b) => `${b.predicate}|${b.object}|${b.tick}`));
  const gainedPredicates = new Set(
    npc.beliefs.filter((b) => !prevBeliefs.has(`${b.predicate}|${b.object}|${b.tick}`)).map((b) => b.predicate)
  );

  // Diff relationship changes for relationshipChanged triggers.
  const relChanged = new Map<string, { trust?: number; fear?: number; loyalty?: number }>();
  if (prevNpc) {
    const keys = new Set([...Object.keys(prevNpc.relationships), ...Object.keys(npc.relationships)]);
    for (const otherId of keys) {
      const before = prevNpc.relationships[otherId];
      const after = npc.relationships[otherId];
      if (!before || !after) continue;
      const delta: any = {};
      if (before.trust !== after.trust) delta.trust = after.trust - before.trust;
      if (before.fear !== after.fear) delta.fear = after.fear - before.fear;
      if (before.loyalty !== after.loyalty) delta.loyalty = after.loyalty - before.loyalty;
      if (Object.keys(delta).length) relChanged.set(otherId, delta);
    }
  }

  // Detect deaths this tick (alive->dead).
  const diedIds: NpcId[] = [];
  for (const [id, prev] of Object.entries(prevWorld.npcs) as [NpcId, NpcState][]) {
    const now = world.npcs[id];
    if (!prev.alive) continue;
    if (now && !now.alive) diedIds.push(id);
  }

  for (const t of def.triggers) {
    if (t.type === "timeOfDay") {
      if (t.hours.includes(hour)) return { memory, ok: true };
      continue;
    }

    if (t.type === "startedTravel") {
      const wasTraveling = prevNpc ? isNpcTraveling(prevNpc) : false;
      const isTraveling = isNpcTraveling(npc);
      if (!wasTraveling && isTraveling) return { memory, ok: true };
      continue;
    }

    if (t.type === "awayFromHome") {
      if (npc.awayFromHomeSinceTick !== undefined && world.tick - npc.awayFromHomeSinceTick >= t.hours) {
        return { memory, ok: true };
      }
      continue;
    }

    if (t.type === "npcCondition") {
      let v: number | undefined;
      if (t.field === "familyNearby") v = familyNearby(npc, world);
      else v = (npc as any)[t.field];
      if (typeof v === "number" && compare(t.op, v, t.value)) return { memory, ok: true };
      continue;
    }

    if (t.type === "siteCondition") {
      const v = siteNumberField(site, t.field);
      if (v !== undefined && compare(t.op, v, t.value)) return { memory, ok: true };
      continue;
    }

    if (t.type === "needThreshold") {
      const res = evaluateNeedThresholdMemory(npc, world.tick, t);
      memory = res.memory;
      if (res.ok) return { memory, ok: true };
      continue;
    }

    if (t.type === "beliefGained") {
      if (gainedPredicates.has(t.predicate)) return { memory, ok: true };
      continue;
    }

    if (t.type === "relationshipChanged") {
      for (const delta of relChanged.values()) {
        const v = (delta as any)[t.field];
        if (typeof v !== "number") continue;
        if (t.direction === "increased" && v > 0) return { memory, ok: true };
        if (t.direction === "decreased" && v < 0) return { memory, ok: true };
      }
      continue;
    }

    if (t.type === "repeatedAction") {
      const windowStart = world.tick - t.window;
      const count = npc.recentActions.filter((a) => a.kind === t.kind && a.tick > windowStart).length;
      if (count >= t.count) return { memory, ok: true };
      continue;
    }

    if (t.type === "attemptSucceeded") {
      for (const e of attemptEvents) {
        const a = asAttempt(e);
        if (!a) continue;
        if (a.kind !== t.kind) continue;
        if (a.actorId !== npc.id) continue;
        if (attemptSuccess(e) === true) return { memory, ok: true };
      }
      continue;
    }

    if (t.type === "receivedHelp") {
      for (const e of attemptEvents) {
        const a = asAttempt(e);
        if (!a) continue;
        if (a.kind !== "heal") continue;
        if (a.targetId !== npc.id) continue;
        if (attemptSuccess(e) === true) return { memory, ok: true };
      }
      continue;
    }

    if (t.type === "witnessedAttempt") {
      for (const e of attemptEvents) {
        const a = asAttempt(e);
        if (!a) continue;
        if (a.kind !== t.kind) continue;
        // actor and target always "witness" their own involvement.
        const involved = a.actorId === npc.id || a.targetId === npc.id;
        const publicWitness = a.visibility === "public" && a.siteId === npc.siteId && !isNpcTraveling(npc);
        if (!involved && !publicWitness) continue;
        if (!asVictimMatches(t, npc.id, a)) continue;
        return { memory, ok: true };
      }
      continue;
    }

    if (t.type === "witnessedEvent") {
      for (const e of attemptEvents) {
        const a = asAttempt(e);
        if (!a) continue;
        if (a.kind !== t.kind) continue;
        const publicWitness = a.visibility === "public" && a.siteId === npc.siteId && !isNpcTraveling(npc);
        if (!publicWitness) continue;
        return { memory, ok: true };
      }
      continue;
    }

    if (t.type === "npcDied") {
      if (!diedIds.length) continue;
      if (t.relationship === "family") {
        if (diedIds.some((id) => npc.familyIds.includes(id))) return { memory, ok: true };
        continue;
      }
      if (t.relationship === "highLoyalty") {
        for (const id of diedIds) {
          const prevOther = prevWorld.npcs[id];
          if (!prevOther) continue;
          const rel = getRelationship(npc, prevOther, prevWorld);
          if (rel.loyalty > 70) return { memory, ok: true };
        }
        continue;
      }
      // any
      for (const id of diedIds) {
        const prevOther = prevWorld.npcs[id];
        if (!prevOther) continue;
        if (prevOther.siteId === npc.siteId) return { memory, ok: true };
      }
      continue;
    }

    // Not yet modeled in the world: siteDestroyed.
    if (t.type === "siteDestroyed") continue;
  }

  return { memory, ok: false };
}

function upsertState(
  npc: NpcState,
  def: ReactiveStateDefinition,
  tick: SimTick,
  sourceEvent?: string
): ActiveState[] {
  const dur = def.baseDurationHours > 0 ? def.baseDurationHours : 1;
  const expiresAtTick = tick + dur;

  const idx = npc.activeStates.findIndex((s) => s.definitionId === def.id);
  if (idx >= 0) {
    const cur = npc.activeStates[idx]!;
    const nextIntensity = def.stackable ? clamp(cur.intensity + 25, 0, 100) : 100;
    const nextState: ActiveState = {
      ...cur,
      startedTick: tick,
      expiresAtTick: Math.max(cur.expiresAtTick, expiresAtTick),
      intensity: clamp(nextIntensity * resistanceMultiplier(def, npc), 0, 100),
      sourceEvent: sourceEvent ?? cur.sourceEvent
    };
    return [...npc.activeStates.slice(0, idx), nextState, ...npc.activeStates.slice(idx + 1)];
  }

  const next: ActiveState = {
    definitionId: def.id,
    startedTick: tick,
    expiresAtTick,
    intensity: clamp(100 * resistanceMultiplier(def, npc), 0, 100),
    sourceEvent
  };
  return [...npc.activeStates, next];
}

export function updateStates(
  world: WorldState,
  prevWorld: WorldState,
  events: SimEvent[],
  opts: { definitions?: ReactiveStateDefinition[] } = {}
): WorldState {
  const defs = opts.definitions ?? STATE_DEFINITIONS;
  const defsById = new Map(defs.map((d) => [d.id, d]));

  const nextNpcs: Record<NpcId, NpcState> = { ...world.npcs };

  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive) continue;
    const prevNpc = prevWorld.npcs[npc.id];

    let activeStates = decayActiveStates(npc.activeStates, world.tick, defsById);

    // Evaluate triggers + update trigger memory (needThreshold durations).
    let memory = npc.stateTriggerMemory;
    for (const def of defs) {
      const res = didTrigger(def, { ...npc, activeStates, stateTriggerMemory: memory }, prevNpc, world, prevWorld, events);
      memory = res.memory;
      if (!res.ok) continue;
      activeStates = upsertState({ ...npc, activeStates, stateTriggerMemory: memory }, def, world.tick);
    }

    nextNpcs[npc.id] = { ...npc, activeStates, stateTriggerMemory: memory };
  }

  return { ...world, npcs: nextNpcs };
}


