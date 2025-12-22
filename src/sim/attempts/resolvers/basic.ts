import { makeId } from "../../ids";
import { startTravel, isNpcTraveling } from "../../movement";
import { pickTravelDestination } from "../../npcs";
import { clamp } from "../../util";
import type { Attempt, NpcState, SettlementSiteState, SiteRumor, WorldState } from "../../types";
import type { ResolveCtx, ResolveResult } from "./helpers";
import { makeHelpers } from "./helpers";
import { isSettlement } from "../rumors";
import { markBusy } from "../../busy";

export function resolveTravel(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (isNpcTraveling(actor)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const from = actor.siteId;
  const to = (attempt.resources?.toSiteId as string | undefined) ?? pickTravelDestination(h.world, from, ctx.rng);
  if (!to) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const started = startTravel({ ...actor, lastAttemptTick: attempt.tick }, h.world, to).npc;
  if (!started.travel) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, travel: started.travel, ...markBusy(actor, h.world.tick, 1, "travel") }
  });
  h.pushKeyChange(`${actor.name} started traveling ${from} -> ${to}`);
  h.emit(`${actor.name} started traveling`, { from, to, km: started.travel.remainingKm });
  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveWork(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const hours = Math.max(1, Math.min(10, attempt.durationHours || 4));
  const type = attempt.kind === "work_farm" ? "grain" : attempt.kind === "work_fish" ? "fish" : "meat";
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, attempt.kind) }
  });
  h.emit(`${actor.name} worked (${type})`, { type, hours });
  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolvePatrol(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  // Patrol is low-impact “keep order” work: a small unrest reduction plus fatigue (busy time).
  const delta = 0.4 + ctx.rng.int(0, 4) / 10; // 0.4..0.8
  h.apply({
    kind: "site.patch",
    siteId: site.id,
    patch: { unrest: clamp(site.unrest - delta, 0, 100) } as Partial<SettlementSiteState>
  });
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "patrol") }
  });
  h.emit(`${actor.name} patrolled ${site.name}`, { unrestReduced: delta });
  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveHeal(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const amt = ctx.rng.int(1, 4);
  h.apply({
    kind: "site.patch",
    siteId: site.id,
    patch: { sickness: clamp(site.sickness - amt, 0, 100) } as Partial<SettlementSiteState>
  });

  // Also heal one wounded NPC in the site (if any).
  const candidates = Object.values(h.world.npcs).filter(
    (n) => (n as NpcState).alive && (n as NpcState).siteId === site.id && (n as NpcState).id !== actor.id && (n as NpcState).hp < (n as NpcState).maxHp
  ) as NpcState[];
  let healedNpcId: string | undefined;
  let healedAmount = 0;
  if (candidates.length) {
    const t = candidates[ctx.rng.int(0, candidates.length - 1)]!;
    healedNpcId = t.id;
    healedAmount = ctx.rng.int(8, 18);
    const nextHp = clamp(t.hp + healedAmount, 0, t.maxHp);
    h.apply({ kind: "npc.patch", npcId: t.id, patch: { hp: nextHp } });
  }

  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "heal") }
  });
  h.emit(`${actor.name} healed in ${site.name}`, { sicknessReduced: amt, healedNpcId, healedAmount });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} healed`, 85);
  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolvePreach(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const base = 1 + Math.floor(actor.traits.NeedForCertainty / 35);
  const delta = Math.max(0, base + ctx.rng.int(-1, 1));
  h.apply({
    kind: "site.patch",
    siteId: site.id,
    patch: { cultInfluence: clamp(site.cultInfluence + delta, 0, 100) } as Partial<SettlementSiteState>
  });
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "preach_fixed_path") }
  });
  h.emit(`${actor.name} preached the Fixed Path`, { cultInfluenceDelta: delta });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} preached the Fixed Path`, 70);
  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveInvestigate(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const score = actor.traits.Suspicion * 0.6 + actor.traits.Discipline * 0.4;
  // NOTE: investigate should not directly erase cult influence; it should surface leads and
  // enable follow-up actions (arrests, rumors, protection), otherwise it flatlines the sim.
  const difficulty = 55 + site.cultInfluence * 0.2;
  const chance = clamp(score - difficulty + 55, 5, 90);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  // Small, explainable effect: success marginally reduces unrest (people feel protected).
  // Failure slightly increases unrest (tensions rise).
  const unrestDelta = success ? -0.6 : +0.4;
  h.apply({ kind: "site.patch", siteId: site.id, patch: { unrest: clamp(site.unrest + unrestDelta, 0, 100) } as Partial<SettlementSiteState> });
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "investigate") }
  });
  h.emit(`${actor.name} investigated`, { success, roll, chance, unrestDelta });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} investigated`, 75);
  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveSteal(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const targetType = ctx.rng.chance(0.5) ? "grain" : ctx.rng.chance(0.5) ? "fish" : "meat";
  const amountWanted =
    attempt.intentMagnitude === "major"
      ? ctx.rng.int(12, 28)
      : attempt.intentMagnitude === "minor"
        ? ctx.rng.int(2, 8)
        : ctx.rng.int(6, 18);

  const score = actor.traits.Discipline * 0.5 + (100 - actor.traits.Suspicion) * 0.2 + site.unrest * 0.3;
  const chance = clamp(score - 55 + 55, 5, 90);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  const available = site.food[targetType].reduce((a, l) => a + l.amount, 0);
  const taken = success ? Math.min(amountWanted, available) : 0;
  if (success) {
    h.apply({ kind: "site.food.take", siteId: site.id, foodType: targetType, amount: amountWanted, takeFrom: "newest" });
  }

  const witnessChance = attempt.visibility === "public" ? 0.9 : 0.25;
  const witnessed = ctx.rng.chance(witnessChance);

  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "steal") }
  });
  h.emit(`${actor.name} attempted theft`, { success, taken, targetType, roll, chance, witnessed });

  if (witnessed) {
    h.addPublicRumor(`${actor.name} stole ${taken} ${targetType}`, 85);
  } else if (success) {
    if (ctx.rng.chance(0.15)) {
      const rumor: SiteRumor = {
        tick: h.world.tick,
        kind: "steal",
        actorId: attempt.actorId,
        siteId: attempt.siteId,
        confidence: 30,
        label: `Rumor: ${actor.name} stole`
      };
      h.apply({ kind: "site.rumor.add", siteId: site.id, rumor });
    }
  }

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}


