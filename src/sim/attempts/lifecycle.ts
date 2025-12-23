import { makeId } from "../ids";
import type { Attempt, AttemptKind, NpcState, SimEvent, WorldState } from "../types";
import { resolveAndApplyAttempt } from "./resolve";
import type { Rng } from "../rng";
import { isNpcTraveling } from "../movement";
import { isDetained } from "../eclipsing";
import { pickTravelDestination } from "../npcs";
import { opportunitiesFromPendingAttempt } from "../opportunities/engine";
import { pickOpportunityResponse } from "../opportunities/respond";

function windupHoursForAttempt(kind: AttemptKind): number {
  // Only “high-interaction” attempts get an interruptible windup in v1.
  if (kind === "assault" || kind === "kill" || kind === "arrest" || kind === "kidnap" || kind === "steal") return 1;
  if (kind === "raid" || kind === "forced_eclipse" || kind === "anchor_sever") return 2;
  return 0;
}

function canBeInterrupted(kind: AttemptKind): boolean {
  return windupHoursForAttempt(kind) > 0;
}

function guardsPresent(world: WorldState, siteId: string): NpcState[] {
  return Object.values(world.npcs)
    .filter((n) => n.alive && n.siteId === siteId && !isNpcTraveling(n))
    .filter((n) => n.category === "GuardMilitia" || n.category === "ConcordEnforcer" || n.category === "ElvenWarriorSentinel");
}

function shouldInterrupt(world: WorldState, attempt: Attempt, rng: Rng): { byNpcId?: string; reason: string } | null {
  if (attempt.visibility !== "public") return null;
  const guards = guardsPresent(world, attempt.siteId);
  if (!guards.length) return null;
  if (attempt.kind === "arrest" && world.npcs[attempt.actorId]?.category === "GuardMilitia") return null;
  // Deterministic probabilistic interruption.
  const p = Math.min(0.15 + guards.length * 0.18, 0.85);
  if (!rng.chance(p)) return null;
  const by = guards.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
  return { byNpcId: by?.id, reason: `interrupted_by_guard p=${p.toFixed(2)}` };
}

function applyImmediateAttempt(
  world: WorldState,
  attempt: Attempt,
  ctx: { rng: Rng; nextEventSeq: () => number }
): { world: WorldState; events: SimEvent[]; keyChanges: string[] } {
  const res = resolveAndApplyAttempt(world, attempt, ctx);
  return {
    world: res.world,
    events: [
      ...res.events,
      {
        id: makeId("evt", res.world.tick, ctx.nextEventSeq()),
        tick: res.world.tick,
        kind: "attempt.completed",
        visibility: attempt.visibility,
        siteId: attempt.siteId,
        message: `Attempt completed: ${attempt.kind}`,
        data: { attempt }
      }
    ],
    keyChanges: res.keyChanges
  };
}

function shouldAbortSelf(world: WorldState, attempt: Attempt, rng: Rng): string | null {
  const actor = world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return "actor_missing";
  // Low-probability reconsideration to allow “intent but no action”.
  const discipline = actor.traits.Discipline ?? 50;
  const integrity = actor.traits.Integrity ?? 50;
  const selfControl = (discipline + integrity) / 200; // 0..1
  const p = 0.03 * selfControl;
  if (p <= 0) return null;
  if (!rng.chance(p)) return null;
  return `self_aborted p=${p.toFixed(3)}`;
}

export function scheduleAttemptIfNeeded(
  world: WorldState,
  attempt: Attempt,
  ctx: { rng: Rng; nextEventSeq: () => number }
): { world: WorldState; events: SimEvent[]; keyChanges: string[]; scheduled: boolean } {
  const actor = world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world, events: [], keyChanges: [], scheduled: false };

  const windup = windupHoursForAttempt(attempt.kind);
  if (windup <= 0) return { world, events: [], keyChanges: [], scheduled: false };

  // Don't schedule if already preparing something.
  if (actor.pendingAttempt) return { world, events: [], keyChanges: [], scheduled: false };

  const executeAtTick = world.tick + windup;
  const ev: SimEvent = {
    id: makeId("evt", world.tick, ctx.nextEventSeq()),
    tick: world.tick,
    kind: "attempt.started",
    visibility: attempt.visibility,
    siteId: attempt.siteId,
    message: `${actor.name} started ${attempt.kind}`,
    data: { attempt, executeAtTick }
  };

  const nextActor: NpcState = {
    ...actor,
    lastAttemptTick: attempt.tick,
    busyUntilTick: Math.max(actor.busyUntilTick, executeAtTick),
    busyKind: attempt.kind,
    pendingAttempt: { startedTick: world.tick, executeAtTick, attempt }
  };
  const nextWorld: WorldState = { ...world, npcs: { ...world.npcs, [actor.id]: nextActor } };
  return { world: nextWorld, events: [ev], keyChanges: [], scheduled: true };
}

export function processPendingAttempts(
  world: WorldState,
  ctx: { rng: Rng; nextEventSeq: () => number }
): { world: WorldState; events: SimEvent[]; keyChanges: string[] } {
  let w = world;
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  const ids = Object.keys(w.npcs).sort();
  for (const id of ids) {
    const npc = w.npcs[id]!;
    const pending = npc.pendingAttempt;
    if (!pending) continue;
    if (pending.executeAtTick > w.tick) continue;

    const attempt = pending.attempt;

    // Generic opportunity system: pending attempt creates an opportunity, NPCs respond with counter-attempts.
    {
      const { opportunities, events: oppEvents } = opportunitiesFromPendingAttempt(w, pending, { nextEventSeq: ctx.nextEventSeq });
      events.push(...oppEvents);
      for (const opp of opportunities) {
        const picked = pickOpportunityResponse(w, opp, { rng: ctx.rng });
        if (picked.event) events.push(picked.event);
        if (picked.response) {
          // Some responses (e.g. victim flee) need a travel destination.
          let respAttempt = picked.response.attempt;
          if (respAttempt.kind === "travel" && !respAttempt.resources?.toSiteId) {
            const actor = w.npcs[respAttempt.actorId];
            const toSiteId = actor ? pickTravelDestination(w, actor.siteId, ctx.rng) : undefined;
            if (toSiteId) respAttempt = { ...respAttempt, resources: { ...(respAttempt.resources ?? {}), toSiteId } };
          }
          const r = applyImmediateAttempt(w, respAttempt, ctx);
          w = r.world;
          events.push(...r.events);
          keyChanges.push(...r.keyChanges);
        }
      }
    }

    // The pending attempt may have been stopped by intervene.
    const refreshed = w.npcs[id]?.pendingAttempt;
    if (!refreshed) continue;

    const actor = w.npcs[attempt.actorId];
    if (!actor || !actor.alive) {
      const ev: SimEvent = {
        id: makeId("evt", w.tick, ctx.nextEventSeq()),
        tick: w.tick,
        kind: "attempt.aborted",
        visibility: attempt.visibility,
        siteId: attempt.siteId,
        message: `Attempt aborted (actor missing): ${attempt.kind}`,
        data: { attempt, reason: "actor_missing" }
      };
      events.push(ev);
      w = { ...w, npcs: { ...w.npcs, [npc.id]: { ...npc, pendingAttempt: undefined, busyUntilTick: w.tick } } };
      continue;
    }

    // Abort if target is unavailable (fled/traveling/died).
    if (attempt.targetId) {
      const t = w.npcs[attempt.targetId];
      if (!t || !t.alive || t.siteId !== attempt.siteId || isNpcTraveling(t)) {
        const ev: SimEvent = {
          id: makeId("evt", w.tick, ctx.nextEventSeq()),
          tick: w.tick,
          kind: "attempt.aborted",
          visibility: attempt.visibility,
          siteId: attempt.siteId,
          message: `Attempt aborted (target unavailable): ${attempt.kind}`,
          data: { attempt, reason: "target_unavailable" }
        };
        events.push(ev);
        w = { ...w, npcs: { ...w.npcs, [npc.id]: { ...actor, pendingAttempt: undefined, busyUntilTick: w.tick } } };
        continue;
      }
    }

    // Abort if actor got detained/traveling, or moved away from attempt site.
    if (isDetained(actor) || isNpcTraveling(actor) || actor.siteId !== attempt.siteId) {
      const ev: SimEvent = {
        id: makeId("evt", w.tick, ctx.nextEventSeq()),
        tick: w.tick,
        kind: "attempt.aborted",
        visibility: attempt.visibility,
        siteId: attempt.siteId,
        message: `Attempt aborted: ${attempt.kind}`,
        data: { attempt, reason: "state_changed" }
      };
      events.push(ev);
      w = { ...w, npcs: { ...w.npcs, [npc.id]: { ...actor, pendingAttempt: undefined, busyUntilTick: w.tick } } };
      continue;
    }

    // Self-abort (rare).
    const selfAbort = shouldAbortSelf(w, attempt, ctx.rng);
    if (selfAbort) {
      const ev: SimEvent = {
        id: makeId("evt", w.tick, ctx.nextEventSeq()),
        tick: w.tick,
        kind: "attempt.aborted",
        visibility: attempt.visibility,
        siteId: attempt.siteId,
        message: `Attempt aborted (self): ${attempt.kind}`,
        data: { attempt, reason: selfAbort }
      };
      events.push(ev);
      w = { ...w, npcs: { ...w.npcs, [npc.id]: { ...actor, pendingAttempt: undefined, busyUntilTick: w.tick } } };
      continue;
    }

    // Interrupt by guards/others.
    const intr = canBeInterrupted(attempt.kind) ? shouldInterrupt(w, attempt, ctx.rng) : null;
    if (intr) {
      const ev: SimEvent = {
        id: makeId("evt", w.tick, ctx.nextEventSeq()),
        tick: w.tick,
        kind: "attempt.interrupted",
        visibility: attempt.visibility,
        siteId: attempt.siteId,
        message: `Attempt interrupted: ${attempt.kind}`,
        data: { attempt, ...intr }
      };
      events.push(ev);
      w = { ...w, npcs: { ...w.npcs, [npc.id]: { ...actor, pendingAttempt: undefined, busyUntilTick: w.tick } } };
      continue;
    }

    // Execute and apply consequences now.
    const exec = resolveAndApplyAttempt(w, attempt, ctx);
    w = exec.world;
    events.push(...exec.events);
    keyChanges.push(...exec.keyChanges);

    // Mark completion (separate from attempt.recorded details).
    events.push({
      id: makeId("evt", w.tick, ctx.nextEventSeq()),
      tick: w.tick,
      kind: "attempt.completed",
      visibility: attempt.visibility,
      siteId: attempt.siteId,
      message: `Attempt completed: ${attempt.kind}`,
      data: { attempt }
    });

    const after = w.npcs[npc.id] ?? actor;
    w = { ...w, npcs: { ...w.npcs, [npc.id]: { ...after, pendingAttempt: undefined } } };
  }

  return { world: w, events, keyChanges };
}


