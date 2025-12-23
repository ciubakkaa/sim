import { makeId } from "../ids";
import type { Attempt, SimEvent, WorldState } from "../types";
import type { Rng } from "../rng";
import { isBusy, markBusy } from "../busy";
import { locationKindsForAttempt, pickLocationByKinds } from "../localRules";
import { resolveArrest, resolveKidnap, resolveTrade } from "./resolvers/control";
import { resolveAssault, resolveKill, resolveRaid } from "./resolvers/violence";
import { resolveAnchorSever, resolveForcedEclipse } from "./resolvers/eclipsing";
import {
  resolveHeal,
  resolveInvestigate,
  resolvePatrol,
  resolvePreach,
  resolveSteal,
  resolveTravel,
  resolveWork
} from "./resolvers/basic";

export function resolveAndApplyAttempt(
  world: WorldState,
  attempt: Attempt,
  ctx: { rng: Rng; nextEventSeq: () => number }
): { world: WorldState; events: SimEvent[]; keyChanges: string[] } {
  const actor = world.npcs[attempt.actorId];
  if (actor && isBusy(actor, world.tick)) {
    return {
      world,
      events: [
        {
          id: makeId("evt", world.tick, ctx.nextEventSeq()),
          tick: world.tick,
          kind: "attempt.recorded",
          visibility: attempt.visibility,
          siteId: attempt.siteId,
          message: `Attempt ignored (busy): ${attempt.kind}`,
          data: { attempt, busyUntilTick: actor.busyUntilTick, busyKind: actor.busyKind }
        }
      ],
      keyChanges: []
    };
  }

  // Phase X: intra-settlement location enforcement.
  // IMPORTANT: do NOT block or delay the attempt here (too disruptive for the sim/tests).
  // Instead, we snap the NPC to the required location and emit local travel events for observability.
  let nextWorld = world;
  const extraEvents: SimEvent[] = [];
  if (actor && actor.alive) {
    const siteAny: any = world.sites[actor.siteId];
    if (siteAny?.kind === "settlement" && siteAny.local) {
      const kinds = locationKindsForAttempt(attempt.kind, siteAny);
      if (kinds?.length) {
        const toLoc = pickLocationByKinds(siteAny, kinds);
        const local = actor.local;
        const fromLoc = local && local.siteId === siteAny.id ? local.locationId : `${siteAny.id}:streets`;
        if (toLoc && fromLoc !== toLoc) {
          extraEvents.push({
            id: makeId("evt", world.tick, ctx.nextEventSeq()),
            tick: world.tick,
            kind: "local.travel.started",
            visibility: "system",
            siteId: siteAny.id,
            message: `${actor.name} moved locally`,
            data: { npcId: actor.id, fromLocationId: fromLoc, toLocationId: toLoc, purposeKind: attempt.kind }
          });

          const patchedActor = {
            ...actor,
            local: { siteId: siteAny.id, locationId: toLoc },
            localTravel: undefined
          };
          nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [actor.id]: patchedActor } };

          extraEvents.push({
            id: makeId("evt", world.tick, ctx.nextEventSeq()),
            tick: world.tick,
            kind: "local.travel.arrived",
            visibility: "system",
            siteId: siteAny.id,
            message: `${actor.name} arrived locally`,
            data: { npcId: actor.id, toLocationId: toLoc, purposeKind: attempt.kind }
          });
        }
      }
    }
  }

  // Idle: throttle NPCs when no meaningful action is selected.
  // Intentionally emits no events to avoid log spam.
  if (attempt.kind === "idle") {
    if (!actor || !actor.alive) return { world, events: [], keyChanges: [] };
    const hours = Math.max(1, Math.min(6, Math.floor(attempt.durationHours || 1)));
    const next = {
      ...world,
      npcs: {
        ...world.npcs,
        [actor.id]: {
          ...actor,
          lastAttemptTick: attempt.tick,
          ...markBusy(actor, world.tick, hours, "idle")
        }
      }
    };
    return { world: next, events: extraEvents, keyChanges: [] };
  }

  // Attach locationId for observability when inside a settlement.
  const attemptWithLocation: Attempt =
    actor && (nextWorld.npcs[actor.id]?.local?.siteId === actor.siteId) && (nextWorld.npcs[actor.id] as any)?.local?.locationId
      ? {
          ...attempt,
          resources: { ...(attempt.resources ?? {}), locationId: (nextWorld.npcs[actor.id] as any).local.locationId }
        }
      : attempt;

  const wrap = (r: { world: WorldState; events: SimEvent[]; keyChanges: string[] }) => ({
    world: r.world,
    events: [...extraEvents, ...r.events],
    keyChanges: r.keyChanges
  });

  if (attempt.kind === "travel") return wrap(resolveTravel(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "patrol") return wrap(resolvePatrol(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "work_farm" || attempt.kind === "work_fish" || attempt.kind === "work_hunt")
    return wrap(resolveWork(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "heal") return wrap(resolveHeal(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "preach_fixed_path") return wrap(resolvePreach(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "investigate") return wrap(resolveInvestigate(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "steal") return wrap(resolveSteal(nextWorld, attemptWithLocation, ctx));

  if (attempt.kind === "trade") return wrap(resolveTrade(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "assault") return wrap(resolveAssault(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "kill") return wrap(resolveKill(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "raid") return wrap(resolveRaid(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "arrest") return wrap(resolveArrest(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "kidnap") return wrap(resolveKidnap(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "forced_eclipse") return wrap(resolveForcedEclipse(nextWorld, attemptWithLocation, ctx));
  if (attempt.kind === "anchor_sever") return wrap(resolveAnchorSever(nextWorld, attemptWithLocation, ctx));

  // Default: no-op but keep event for observability.
  return {
    world: nextWorld,
    events: [
      ...extraEvents,
      {
        id: makeId("evt", world.tick, ctx.nextEventSeq()),
        tick: world.tick,
        kind: "attempt.recorded",
        visibility: attempt.visibility,
        siteId: attempt.siteId,
        message: `Attempt recorded: ${attempt.kind}`,
        data: { attempt: attemptWithLocation }
      }
    ],
    keyChanges: []
  };
}


