import type { Attempt, NpcState, SettlementSiteState, WorldState } from "../../types";
import { clamp } from "../../util";
import type { ResolveCtx, ResolveResult } from "./helpers";
import { makeHelpers } from "./helpers";
import { isSettlement } from "../rumors";
import { markBusy } from "../../busy";

function getTarget(world: WorldState, attempt: Attempt): NpcState | undefined {
  if (!attempt.targetId) return undefined;
  return world.npcs[attempt.targetId];
}

export function resolveForcedEclipse(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const actor = h.world.npcs[attempt.actorId];
  const target = getTarget(h.world, attempt);
  if (!actor || !actor.alive || !target || !target.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (actor.siteId !== attempt.siteId || target.siteId !== attempt.siteId) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (target.category === "TaintedThrall") return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const site = h.world.sites[attempt.siteId];
  const pressure = site.eclipsingPressure;
  const anchor = site.anchoringStrength;

  // Require either detention or a high-pressure/low-anchor environment (hideouts/ruin-adjacent).
  const detained = Boolean(target.status?.detained);
  const envOk = pressure >= 55 && anchor <= 45;
  if (!detained && !envOk) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  if (target.status?.eclipsing) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const days = ctx.rng.int(1, 3);
  const hours = days * 24;
  const initiatedTick = h.world.tick;
  const completeTick = initiatedTick + hours;
  const reversibleUntilTick = initiatedTick + 48;

  // Site unrest rises if this happens in a settlement.
  if (isSettlement(site)) {
    h.apply({
      kind: "site.patch",
      siteId: site.id,
      patch: { unrest: clamp((site as SettlementSiteState).unrest + 3, 0, 100) } as Partial<SettlementSiteState>
    });
  }

  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "forced_eclipse") }
  });
  h.apply({
    kind: "npc.patch",
    npcId: target.id,
    patch: {
      status: {
        ...(target.status ?? {}),
        detained: {
          byNpcId: actor.id,
          atSiteId: attempt.siteId,
          startedTick: target.status?.detained?.startedTick ?? initiatedTick,
          untilTick: Math.max(target.status?.detained?.untilTick ?? initiatedTick, completeTick)
        },
        eclipsing: { initiatedTick, completeTick, reversibleUntilTick }
      } as any,
      trauma: clamp(target.trauma + 22, 0, 100),
      forcedActiveUntilTick: h.world.tick + 72
    } as Partial<NpcState>
  });

  h.pushKeyChange(`${target.name} is being eclipsed (complete in ${days}d)`);
  h.emit(`${actor.name} began a forced eclipsing ritual`, { targetId: target.id, days, completeTick, reversibleUntilTick, pressure, anchor });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} began a forced eclipsing`, 90);

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveAnchorSever(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const actor = h.world.npcs[attempt.actorId];
  const target = getTarget(h.world, attempt);
  if (!actor || !actor.alive || !target || !target.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (actor.siteId !== attempt.siteId || target.siteId !== attempt.siteId) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const e = target.status?.eclipsing;
  if (!e) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const withinWindow = h.world.tick <= e.reversibleUntilTick;
  if (!withinWindow) {
    h.emit(`${actor.name} attempted to sever eclipsing (too late)`, { targetId: target.id, reversibleUntilTick: e.reversibleUntilTick });
    return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  }

  const site = h.world.sites[attempt.siteId];
  const anchor = site.anchoringStrength / 100;
  const score = actor.traits.Discipline * 0.5 + actor.traits.Integrity * 0.3 + actor.traits.Curiosity * 0.2;
  const difficulty = 55 + (1 - anchor) * 25;
  const chance = clamp(score - difficulty + 60, 10, 90);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: {
      lastAttemptTick: attempt.tick,
      trauma: clamp(actor.trauma + (success ? 1 : 2), 0, 100),
      ...markBusy(actor, h.world.tick, attempt.durationHours, "anchor_sever")
    }
  });

  if (!success) {
    h.apply({
      kind: "npc.patch",
      npcId: target.id,
      patch: { trauma: clamp(target.trauma + 8, 0, 100), forcedActiveUntilTick: h.world.tick + 24 }
    });
    h.emit(`${actor.name} failed to sever eclipsing`, { success: false, roll, chance, targetId: target.id });
    if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} failed to sever eclipsing`, 70);
    return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  }

  h.apply({
    kind: "npc.patch",
    npcId: target.id,
    patch: {
      status: { ...(target.status ?? {}), eclipsing: undefined } as any,
      trauma: clamp(target.trauma - 10, 0, 100)
    } as Partial<NpcState>
  });
  h.pushKeyChange(`${actor.name} severed eclipsing for ${target.name}`);
  h.emit(`${actor.name} severed eclipsing`, { success: true, roll, chance, targetId: target.id });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} severed eclipsing`, 85);
  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}


