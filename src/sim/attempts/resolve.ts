import { makeId } from "../ids";
import type { Attempt, SimEvent, WorldState } from "../types";
import type { Rng } from "../rng";
import { isBusy, markBusy } from "../busy";
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
    return { world: next, events: [], keyChanges: [] };
  }

  if (attempt.kind === "travel") return resolveTravel(world, attempt, ctx);
  if (attempt.kind === "patrol") return resolvePatrol(world, attempt, ctx);
  if (attempt.kind === "work_farm" || attempt.kind === "work_fish" || attempt.kind === "work_hunt") return resolveWork(world, attempt, ctx);
  if (attempt.kind === "heal") return resolveHeal(world, attempt, ctx);
  if (attempt.kind === "preach_fixed_path") return resolvePreach(world, attempt, ctx);
  if (attempt.kind === "investigate") return resolveInvestigate(world, attempt, ctx);
  if (attempt.kind === "steal") return resolveSteal(world, attempt, ctx);

  if (attempt.kind === "trade") return resolveTrade(world, attempt, ctx);
  if (attempt.kind === "assault") return resolveAssault(world, attempt, ctx);
  if (attempt.kind === "kill") return resolveKill(world, attempt, ctx);
  if (attempt.kind === "raid") return resolveRaid(world, attempt, ctx);
  if (attempt.kind === "arrest") return resolveArrest(world, attempt, ctx);
  if (attempt.kind === "kidnap") return resolveKidnap(world, attempt, ctx);
  if (attempt.kind === "forced_eclipse") return resolveForcedEclipse(world, attempt, ctx);
  if (attempt.kind === "anchor_sever") return resolveAnchorSever(world, attempt, ctx);

  // Default: no-op but keep event for observability.
  return {
    world,
    events: [
      {
        id: makeId("evt", world.tick, ctx.nextEventSeq()),
        tick: world.tick,
        kind: "attempt.recorded",
        visibility: attempt.visibility,
        siteId: attempt.siteId,
        message: `Attempt recorded: ${attempt.kind}`,
        data: { attempt }
      }
    ],
    keyChanges: []
  };
}


