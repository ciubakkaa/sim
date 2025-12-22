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

export function resolveTrade(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const deltaMorale = ctx.rng.int(0, 2);
  const deltaUnrest = ctx.rng.int(0, 1) ? -1 : 0;
  h.apply({
    kind: "site.patch",
    siteId: site.id,
    patch: {
      morale: clamp(site.morale + deltaMorale, 0, 100),
      unrest: clamp(site.unrest + deltaUnrest, 0, 100)
    } as Partial<SettlementSiteState>
  });
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "trade") }
  });
  h.emit(`${actor.name} traded in ${site.name}`, { deltaMorale, deltaUnrest });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} traded`, 50);

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveArrest(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const actor = h.world.npcs[attempt.actorId];
  const target = getTarget(h.world, attempt);
  if (!actor || !actor.alive || !target || !target.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (actor.siteId !== attempt.siteId || target.siteId !== attempt.siteId) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (target.status?.detained) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const score = actor.traits.Discipline * 0.6 + actor.traits.Suspicion * 0.4;
  const resist = target.traits.Courage * 0.5 + target.traits.Aggression * 0.25 + target.traits.Fear * 0.25;
  const chance = clamp(score - resist + 55, 10, 90);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  const detentionHours = success ? ctx.rng.int(24, 48) : 0;
  const nextTrauma = success ? clamp(target.trauma + 6, 0, 100) : clamp(target.trauma + 2, 0, 100);
  const detained = success
    ? { byNpcId: actor.id, atSiteId: attempt.siteId, startedTick: h.world.tick, untilTick: h.world.tick + detentionHours }
    : undefined;

  const unrestDelta = success ? 1 : 2;
  h.apply({
    kind: "site.patch",
    siteId: site.id,
    patch: { unrest: clamp(site.unrest + unrestDelta, 0, 100) } as Partial<SettlementSiteState>
  });
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "arrest") }
  });
  h.apply({
    kind: "npc.patch",
    npcId: target.id,
    patch: {
      trauma: nextTrauma,
      forcedActiveUntilTick: success ? h.world.tick + 24 : target.forcedActiveUntilTick,
      status: { ...(target.status ?? {}), detained } as any
    } as Partial<NpcState>
  });

  h.emit(`${actor.name} attempted an arrest`, { success, roll, chance, detentionHours, targetId: target.id });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} arrested ${target.name}`, success ? 75 : 40);

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveKidnap(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const actor = h.world.npcs[attempt.actorId];
  const target = getTarget(h.world, attempt);
  if (!actor || !actor.alive || !target || !target.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (actor.siteId !== attempt.siteId || target.siteId !== attempt.siteId) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (target.status?.detained) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const score = actor.traits.Aggression * 0.45 + actor.traits.Discipline * 0.35 + (100 - actor.traits.Empathy) * 0.2;
  const resist = target.traits.Courage * 0.55 + target.traits.Discipline * 0.25 + target.traits.Suspicion * 0.2;
  const chance = clamp(score - resist + 45, 5, 85);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  if (!success) {
    const bumpedSite = h.world.sites[attempt.siteId];
    if (isSettlement(bumpedSite)) {
      h.apply({
        kind: "site.patch",
        siteId: bumpedSite.id,
        patch: { unrest: clamp(bumpedSite.unrest + 2, 0, 100) } as Partial<SettlementSiteState>
      });
    }
    h.apply({
      kind: "npc.patch",
      npcId: actor.id,
      patch: {
        lastAttemptTick: attempt.tick,
        trauma: clamp(actor.trauma + 2, 0, 100),
        ...markBusy(actor, h.world.tick, attempt.durationHours, "kidnap")
      }
    });
    h.apply({
      kind: "npc.patch",
      npcId: target.id,
      patch: { trauma: clamp(target.trauma + 4, 0, 100), forcedActiveUntilTick: h.world.tick + 24 }
    });
    h.emit(`${actor.name} attempted a kidnapping`, { success: false, roll, chance, targetId: target.id });
    if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} attempted to kidnap ${target.name}`, 70);
    return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  }

  const detentionHours = ctx.rng.int(24, 72);

  const bumpedSite = h.world.sites[attempt.siteId];
  if (isSettlement(bumpedSite)) {
    h.apply({
      kind: "site.patch",
      siteId: bumpedSite.id,
      patch: { unrest: clamp(bumpedSite.unrest + 4, 0, 100) } as Partial<SettlementSiteState>
    });
  }
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "kidnap") }
  });
  h.apply({
    kind: "npc.patch",
    npcId: target.id,
    patch: {
      status: {
        ...(target.status ?? {}),
        detained: { byNpcId: actor.id, atSiteId: attempt.siteId, startedTick: h.world.tick, untilTick: h.world.tick + detentionHours }
      } as any,
      trauma: clamp(target.trauma + 18, 0, 100),
      forcedActiveUntilTick: h.world.tick + 48
    } as Partial<NpcState>
  });

  h.emit(`${actor.name} kidnapped ${target.name}`, { success: true, roll, chance, detentionHours, targetId: target.id });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} kidnapped ${target.name}`, 85);

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}


