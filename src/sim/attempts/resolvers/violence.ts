import type { Attempt, NpcState, SettlementSiteState, WorldState } from "../../types";
import { clamp } from "../../util";
import type { ResolveCtx, ResolveResult } from "./helpers";
import { makeHelpers } from "./helpers";
import { isSettlement } from "../rumors";
import { markBusy } from "../../busy";
import { makeId } from "../../ids";
import { addBelief } from "../../beliefs";

function getTarget(world: WorldState, attempt: Attempt): NpcState | undefined {
  if (!attempt.targetId) return undefined;
  return world.npcs[attempt.targetId];
}

function combatOffense(n: NpcState): number {
  return n.traits.Aggression * 0.5 + n.traits.Courage * 0.3 + n.traits.Discipline * 0.2;
}

function combatDefense(n: NpcState): number {
  return n.traits.Courage * 0.4 + n.traits.Discipline * 0.4 + n.traits.Aggression * 0.2;
}

export function resolveAssault(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const actor = h.world.npcs[attempt.actorId];
  const target = getTarget(h.world, attempt);
  if (!actor || !actor.alive || !target || !target.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (actor.siteId !== attempt.siteId || target.siteId !== attempt.siteId) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  // Task 15: combat outcome based on attacker offense vs defender defense.
  const score = combatOffense(actor);
  const resist = combatDefense(target);
  const chance = clamp(50 + (score - resist) * 0.4, 5, 90);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  const traumaToTarget = success ? ctx.rng.int(10, 22) : ctx.rng.int(3, 10);
  const traumaToActor = success ? 1 : 3;
  const dmg = clamp(Math.round((success ? 8 : 3) + (score / 100) * 14 + ctx.rng.int(-2, 2)), 1, 28);
  const nextHp = clamp(target.hp - dmg, 0, target.maxHp);

  // Task 15: mutual damage (risk to attacker).
  const retaliation = clamp(Math.round((success ? 3 : 2) + (combatOffense(target) / 100) * 10 + ctx.rng.int(-2, 2)), 0, 18);
  const nextActorHp = clamp(actor.hp - retaliation, 0, actor.maxHp);

  // Settlement unrest spikes slightly on violence.
  const site = h.world.sites[attempt.siteId];
  if (isSettlement(site)) {
    h.apply({
      kind: "site.patch",
      siteId: site.id,
      patch: { unrest: clamp(site.unrest + (success ? 2 : 1), 0, 100) } as Partial<SettlementSiteState>
    });
  }
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: {
      trauma: clamp(actor.trauma + traumaToActor, 0, 100),
      lastAttemptTick: attempt.tick,
      hp: nextActorHp,
      ...markBusy(actor, h.world.tick, attempt.durationHours, "assault")
    }
  });
  h.apply({
    kind: "npc.patch",
    npcId: target.id,
    patch: {
      trauma: clamp(target.trauma + traumaToTarget, 0, 100),
      forcedActiveUntilTick: h.world.tick + 24,
      hp: nextHp
    }
  });

  if (nextHp <= 0) {
    h.apply({
      kind: "npc.killed",
      npcId: target.id,
      tick: h.world.tick,
      cause: "murder",
      byNpcId: actor.id,
      atSiteId: attempt.siteId
    });

    // Task 21: dedicated death event + beliefs at the site.
    h.events.push({
      id: makeId("evt", h.world.tick, ctx.nextEventSeq()),
      tick: h.world.tick,
      kind: "npc.died",
      visibility: "system",
      siteId: attempt.siteId,
      message: `${target.name} died from injuries at ${attempt.siteId}`,
      data: { npcId: target.id, cause: "murder", atSiteId: attempt.siteId, byNpcId: actor.id }
    });
    h.pushKeyChange(`${target.name} died from injuries at ${attempt.siteId}`);

    for (const w of Object.values(h.world.npcs) as NpcState[]) {
      if (!w.alive) continue;
      if (w.siteId !== attempt.siteId) continue;
      if (w.id === target.id) continue;
      const updated = addBelief(w, {
        subjectId: target.id,
        predicate: "npc_died",
        object: "murder",
        confidence: 90,
        source: "witnessed",
        tick: h.world.tick
      });
      h.apply({ kind: "npc.patch", npcId: w.id, patch: { beliefs: updated.beliefs } });
    }
  }

  h.emit(`${actor.name} assaulted ${target.name}`, {
    success,
    roll,
    chance,
    traumaToTarget,
    damage: dmg,
    hpAfter: nextHp,
    retaliation,
    actorHpAfter: nextActorHp
  });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} assaulted ${target.name}`, 85);

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveKill(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const actor = h.world.npcs[attempt.actorId];
  const target = getTarget(h.world, attempt);
  if (!actor || !actor.alive || !target || !target.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (actor.siteId !== attempt.siteId || target.siteId !== attempt.siteId) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  // Task 15: base kill success ~30% with trait modifiers.
  const score = combatOffense(actor);
  const resist = combatDefense(target);
  const chance = clamp(30 + (score - resist) * 0.35, 2, 80);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  // Mutual damage even on kill attempts.
  const exchange = clamp(Math.round(2 + (combatOffense(target) / 100) * 8 + ctx.rng.int(-2, 2)), 0, 16);
  const actorHpAfter = clamp(actor.hp - exchange, 0, actor.maxHp);

  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: {
      lastAttemptTick: attempt.tick,
      trauma: clamp(actor.trauma + (success ? 6 : 2), 0, 100),
      hp: actorHpAfter,
      ...markBusy(actor, h.world.tick, attempt.durationHours, "kill")
    }
  });

  if (!success) {
    const nick = clamp(Math.round(2 + (score / 100) * 6 + ctx.rng.int(-2, 2)), 0, 12);
    const targetHpAfter = clamp(target.hp - nick, 0, target.maxHp);
    h.apply({
      kind: "npc.patch",
      npcId: target.id,
      patch: { trauma: clamp(target.trauma + 6, 0, 100), hp: targetHpAfter }
    });

    // Extra notability for an attempted murder that was witnessed (fighting).
    if (attempt.visibility === "public") {
      h.apply({ kind: "npc.patch", npcId: actor.id, patch: { notability: clamp(actor.notability + 5, 0, 100) } as any });
    }

    h.emit(`${actor.name} attempted to kill ${target.name}`, { success: false, roll, chance, exchange, actorHpAfter, nick, targetHpAfter });
    if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} tried to kill ${target.name}`, 90);
    return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  }

  h.apply({ kind: "npc.killed", npcId: target.id, tick: h.world.tick, cause: "murder", byNpcId: actor.id, atSiteId: attempt.siteId });

  // Task 21: dedicated death event + beliefs at the site.
  h.events.push({
    id: makeId("evt", h.world.tick, ctx.nextEventSeq()),
    tick: h.world.tick,
    kind: "npc.died",
    visibility: "system",
    siteId: attempt.siteId,
    message: `${target.name} was murdered at ${attempt.siteId}`,
    data: { npcId: target.id, cause: "murder", atSiteId: attempt.siteId, byNpcId: actor.id }
  });

  for (const w of Object.values(h.world.npcs) as NpcState[]) {
    if (!w.alive) continue;
    if (w.siteId !== attempt.siteId) continue;
    if (w.id === target.id) continue;
    const updated = addBelief(w, {
      subjectId: target.id,
      predicate: "npc_died",
      object: "murder",
      confidence: 95,
      source: "witnessed",
      tick: h.world.tick
    });
    h.apply({ kind: "npc.patch", npcId: w.id, patch: { beliefs: updated.beliefs } });
  }

  // Trauma ripple for other NPCs at the site (small, deterministic).
  for (const n of Object.values(h.world.npcs) as NpcState[]) {
    if (!n.alive) continue;
    if (n.id === actor.id || n.id === target.id) continue;
    if (n.siteId !== attempt.siteId) continue;
    h.apply({
      kind: "npc.patch",
      npcId: n.id,
      patch: { trauma: clamp(n.trauma + 8, 0, 100), forcedActiveUntilTick: h.world.tick + 48 }
    });
  }

  // Settlement unrest spike.
  const site = h.world.sites[attempt.siteId];
  if (isSettlement(site)) {
    h.apply({
      kind: "site.patch",
      siteId: site.id,
      patch: {
        unrest: clamp(site.unrest + 6, 0, 100),
        morale: clamp(site.morale - 2, 0, 100)
      } as Partial<SettlementSiteState>
    });
  }
  h.pushKeyChange(`${target.name} was murdered at ${attempt.siteId}`);
  h.emit(`${actor.name} killed ${target.name}`, { success: true, roll, chance, victimId: target.id });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} killed ${target.name}`, 95);

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveRaid(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const actor = h.world.npcs[attempt.actorId];
  const site = h.world.sites[attempt.siteId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (actor.siteId !== attempt.siteId) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const score = actor.traits.Aggression * 0.45 + actor.traits.Courage * 0.25 + actor.traits.Discipline * 0.3;
  const defense = clamp(35 + site.unrest * 0.25 + site.anchoringStrength * 0.1, 0, 100);
  const baseChance = clamp(score - defense + 55, 5, 85);

  // Task 18: coordination bonus for raids (+10% per additional bandit at the site).
  const banditsHere = Object.values(h.world.npcs).filter((n) => (n as NpcState).alive && (n as NpcState).siteId === attempt.siteId && (n as NpcState).category === "BanditRaider") as NpcState[];
  const extraBandits = Math.max(0, banditsHere.length - 1);
  const coordBonus = Math.min(40, extraBandits * 10);
  const chance = clamp(baseChance + coordBonus, 5, 95);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  let killedId: string | undefined;

  if (success) {
    const type = ctx.rng.chance(0.5) ? "grain" : ctx.rng.chance(0.5) ? "fish" : "meat";
    const stealAmt = attempt.intentMagnitude === "major" ? ctx.rng.int(30, 70) : attempt.intentMagnitude === "minor" ? ctx.rng.int(8, 20) : ctx.rng.int(18, 45);
    const available = site.food[type].reduce((a, l) => a + l.amount, 0);
    const taken = Math.min(stealAmt, available);
    h.apply({ kind: "site.food.take", siteId: site.id, foodType: type, amount: stealAmt, takeFrom: "newest" });

    // Task 14: raids can damage fieldsCondition (0.05–0.15).
    const fieldsDamage = 0.05 + ctx.rng.int(0, 10) / 100; // 0.05..0.15
    const nextFields = clamp(site.fieldsCondition - fieldsDamage, 0, 1);
    h.apply({
      kind: "site.patch",
      siteId: site.id,
      patch: {
        unrest: clamp(site.unrest + 8, 0, 100),
        morale: clamp(site.morale - 5, 0, 100),
        fieldsCondition: nextFields
      } as Partial<SettlementSiteState>
    });

    // Sometimes kill a named NPC.
    if (ctx.rng.chance(0.35)) {
      const candidates = Object.values(h.world.npcs).filter((n) => (n as NpcState).alive && (n as NpcState).siteId === attempt.siteId) as NpcState[];
      if (candidates.length) {
        const victim = candidates[ctx.rng.int(0, candidates.length - 1)]!;
        killedId = victim.id;
        h.apply({ kind: "npc.killed", npcId: victim.id, tick: h.world.tick, cause: "raid", byNpcId: actor.id, atSiteId: attempt.siteId });

        h.events.push({
          id: makeId("evt", h.world.tick, ctx.nextEventSeq()),
          tick: h.world.tick,
          kind: "npc.died",
          visibility: "system",
          siteId: attempt.siteId,
          message: `${victim.name} died in a raid at ${attempt.siteId}`,
          data: { npcId: victim.id, cause: "raid", atSiteId: attempt.siteId, byNpcId: actor.id }
        });
        h.pushKeyChange(`${victim.name} died in a raid at ${attempt.siteId}`);

        for (const w of Object.values(h.world.npcs) as NpcState[]) {
          if (!w.alive) continue;
          if (w.siteId !== attempt.siteId) continue;
          if (w.id === victim.id) continue;
          const updated = addBelief(w, {
            subjectId: victim.id,
            predicate: "npc_died",
            object: "raid",
            confidence: 80,
            source: "witnessed",
            tick: h.world.tick
          });
          h.apply({ kind: "npc.patch", npcId: w.id, patch: { beliefs: updated.beliefs } });
        }
      }
    }

    h.pushKeyChange(`${site.name} was raided (${type} stolen)`);
    h.emit(`${actor.name} raided ${site.name}`, { success: true, roll, chance, baseChance, coordBonus, extraBandits, stolenType: type, stolen: taken, killedId, fieldsDamage });
    if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} raided ${site.name}`, 90);
  } else {
    h.apply({ kind: "site.patch", siteId: site.id, patch: { unrest: clamp(site.unrest + 2, 0, 100) } as Partial<SettlementSiteState> });
    h.emit(`${actor.name} attempted a raid on ${site.name}`, { success: false, roll, chance, baseChance, coordBonus, extraBandits });
    if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} attempted a raid`, 70);
  }

  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: {
      lastAttemptTick: attempt.tick,
      trauma: clamp(actor.trauma + (success ? 2 : 1), 0, 100),
      ...markBusy(actor, h.world.tick, attempt.durationHours, "raid")
    }
  });

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}


