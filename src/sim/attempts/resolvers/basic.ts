import { makeId } from "../../ids";
import { startTravel, isNpcTraveling } from "../../movement";
import { pickTravelDestination } from "../../npcs";
import { getNeighbors } from "../../map";
import { clamp } from "../../util";
import type { Attempt, FoodType, NpcState, SettlementSiteState, SiteRumor, WorldState } from "../../types";
import type { ResolveCtx, ResolveResult } from "./helpers";
import { makeHelpers } from "./helpers";
import { isSettlement } from "../rumors";
import { markBusy } from "../../busy";
import { addFoodLot } from "../../food";
import { addBelief } from "../../beliefs";
import { addFoodToBuilding, pickLocationByKinds } from "../../localRules";

export function resolveTravel(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (isNpcTraveling(actor)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const from = actor.siteId;
  const to = (attempt.resources?.toSiteId as string | undefined) ?? pickTravelDestination(h.world, from, ctx.rng);
  if (!to) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  // Task 16: block travel into undiscovered hideouts.
  const toSite: any = h.world.sites[to];
  if (toSite?.kind === "hideout" && toSite.hidden) {
    h.emit(`${actor.name} attempted to travel to an unknown location`, { from, to });
    return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  }

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
  const type: FoodType = attempt.kind === "work_farm" ? "grain" : attempt.kind === "work_fish" ? "fish" : "meat";

  // Task 10: work attempts produce tangible food.
  // Keep these small so baseline site production still dominates early.
  const basePerHour = type === "grain" ? 2 : 2;
  const raw = hours * basePerHour;
  const amount = Math.max(
    0,
    Math.round(type === "grain" ? raw * (site.fieldsCondition ?? 1) : raw)
  );

  if (amount > 0) {
    const updatedSite = addFoodLot(site, type, amount, Math.floor(h.world.tick / 24));
    // Phase X: mirror some produced food into a local storehouse for UI inspection.
    const storageId = pickLocationByKinds(site, ["storage"]);
    const nextLocal = storageId ? addFoodToBuilding({ ...site, local: site.local }, storageId, type, amount) : site.local;
    h.apply({
      kind: "site.patch",
      siteId: site.id,
      patch: {
        food: updatedSite.food,
        laborWorkedToday: {
          ...(site.laborWorkedToday ?? { grain: 0, fish: 0, meat: 0 }),
          [type]: (site.laborWorkedToday?.[type] ?? 0) + hours
        },
        local: nextLocal
      } as Partial<SettlementSiteState>
    });
  } else {
    // Still mark labor so the baseline isn't penalized if someone worked but yielded nothing (edge cases).
    h.apply({
      kind: "site.patch",
      siteId: site.id,
      patch: {
        laborWorkedToday: {
          ...(site.laborWorkedToday ?? { grain: 0, fish: 0, meat: 0 }),
          [type]: (site.laborWorkedToday?.[type] ?? 0) + hours
        },
        local: site.local
      } as Partial<SettlementSiteState>
    });
  }

  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, attempt.kind) }
  });
  h.emit(`${actor.name} worked (${type})`, { type, hours, amount });
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
  let discoveredHideoutId: string | undefined;

  // Task 16: hidden site discovery (ScoutRanger patrolling near a hidden hideout).
  if (actor.category === "ScoutRanger" && ctx.rng.chance(0.05)) {
    const neighbors = getNeighbors(h.world.map, site.id);
    const hidden = neighbors
      .map((n) => h.world.sites[n.to] as any)
      .filter((s) => s?.kind === "hideout" && s.hidden)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const target = hidden[0];
    if (target) {
      discoveredHideoutId = target.id;
      h.apply({ kind: "site.patch", siteId: target.id, patch: { hidden: false } as any });

      const witnesses = Object.values(h.world.npcs).filter((n) => n.alive && n.siteId === site.id && !isNpcTraveling(n));
      for (const w of witnesses) {
        const nextW = addBelief(w as any, {
          subjectId: target.id,
          predicate: "discovered_location",
          object: String(target.id),
          confidence: 80,
          source: "witnessed",
          tick: h.world.tick
        });
        h.apply({ kind: "npc.patch", npcId: w.id, patch: { beliefs: nextW.beliefs } });
      }

      h.pushKeyChange(`${actor.name} discovered a hidden site: ${target.id}`);
    }
  }

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
  h.emit(`${actor.name} patrolled ${site.name}`, { unrestReduced: delta, discoveredHideoutId });
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

  // Task 9: slower, more realistic cult influence gains.
  // - +1 influence (at most) per preach attempt
  // - scaled by (1 - anchoringStrength/100)
  // - additional 50% failure chance when anchoringStrength > 50
  // - saturation: 0.5x when influence > 80
  const anchorMult = 1 - site.anchoringStrength / 100;
  const highAnchorPenalty = site.anchoringStrength > 50 ? 0.5 : 1.0;
  const saturation = site.cultInfluence > 80 ? 0.5 : 1.0;
  const chance = clamp(anchorMult * highAnchorPenalty * saturation, 0, 1);
  const delta = ctx.rng.chance(chance) ? 1 : 0;

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
  h.emit(`${actor.name} preached the Fixed Path`, {
    cultInfluenceDelta: delta,
    chance,
    anchoringStrength: site.anchoringStrength,
    highAnchorPenaltyApplied: site.anchoringStrength > 50,
    saturationApplied: site.cultInfluence > 80
  });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} preached the Fixed Path`, 70);
  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveInvestigate(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const score = actor.traits.Suspicion * 0.6 + actor.traits.Discipline * 0.4;
  // NOTE: investigate should not directly erase cult influence; it should surface leads and
  // enable follow-up actions (arrests, rumors, protection), otherwise it flatlines the sim.
  const cultInfluence = isSettlement(site) ? site.cultInfluence : 0;
  const difficulty = 55 + cultInfluence * 0.2;
  let chance = clamp(score - difficulty + 55, 5, 90);

  // Task 16: double investigate chance at discovered hideouts.
  const discoveredHideoutBonus = (site as any)?.kind === "hideout" && (site as any).hidden === false;
  if (discoveredHideoutBonus) chance = clamp(chance * 2, 5, 90);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  // Task 12: in high-influence settlements, guards can identify a cult member.
  let identifiedTargetId: string | undefined;
  if (
    success &&
    isSettlement(site) &&
    site.cultInfluence > 40 &&
    (actor.category === "GuardMilitia" || actor.category === "ScoutRanger" || actor.category === "Threadwarden") &&
    ctx.rng.chance(0.25)
  ) {
    const candidates = Object.values(h.world.npcs).filter((n) => n.alive && n.siteId === site.id && n.cult.member);
    if (candidates.length) {
      const t = candidates[ctx.rng.int(0, candidates.length - 1)]!;
      identifiedTargetId = t.id;
      const nextActor = addBelief(actor, {
        subjectId: t.id,
        predicate: "identified_cult_member",
        object: "true",
        confidence: 80,
        source: "witnessed",
        tick: h.world.tick
      });
      h.apply({ kind: "npc.patch", npcId: actor.id, patch: { beliefs: nextActor.beliefs } });

      // Task 18: share investigation findings with other guards at the same site.
      const guardsHere = Object.values(h.world.npcs).filter(
        (n) =>
          n.alive &&
          n.siteId === actor.siteId &&
          !isNpcTraveling(n as any) &&
          n.id !== actor.id &&
          (n.category === "GuardMilitia" || n.category === "ScoutRanger" || n.category === "Threadwarden")
      ) as NpcState[];
      for (const g of guardsHere) {
        const updated = addBelief(g, {
          subjectId: t.id,
          predicate: "identified_cult_member",
          object: "true",
          confidence: 60,
          source: "report",
          tick: h.world.tick
        });
        h.apply({ kind: "npc.patch", npcId: g.id, patch: { beliefs: updated.beliefs } });
      }

      // Task 18: propagate identification to nearby guards (neighboring sites).
      const neighbors = getNeighbors(h.world.map, actor.siteId);
      for (const nb of neighbors) {
        const guardsNearby = Object.values(h.world.npcs).filter(
          (n) =>
            n.alive &&
            n.siteId === nb.to &&
            !isNpcTraveling(n as any) &&
            (n.category === "GuardMilitia" || n.category === "ScoutRanger" || n.category === "Threadwarden")
        ) as NpcState[];
        for (const g of guardsNearby) {
          const updated = addBelief(g, {
            subjectId: t.id,
            predicate: "identified_cult_member",
            object: "true",
            confidence: 50,
            source: "report",
            tick: h.world.tick
          });
          h.apply({ kind: "npc.patch", npcId: g.id, patch: { beliefs: updated.beliefs } });
        }
      }

      h.pushKeyChange(`${actor.name} identified a cult member: ${t.name}`);
    }
  }

  // Small, explainable effect: success marginally reduces unrest (people feel protected).
  // Failure slightly increases unrest (tensions rise).
  const unrestDelta = success ? -0.6 : +0.4;
  if (isSettlement(site)) {
    h.apply({ kind: "site.patch", siteId: site.id, patch: { unrest: clamp(site.unrest + unrestDelta, 0, 100) } as Partial<SettlementSiteState> });
  }
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "investigate") }
  });
  h.emit(`${actor.name} investigated`, { success, roll, chance, unrestDelta, identifiedTargetId, discoveredHideoutBonus });
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


