import { makeId } from "../ids";
import { pickTravelDestination } from "../npcs";
import { clamp } from "../util";
import type { Attempt, NpcState, SettlementSiteState, SimEvent, SiteRumor, WorldState } from "../types";
import type { Rng } from "../rng";
import { addRumor, applyPublicRumorAndRelationships, ingestRumorsOnArrival, isSettlement } from "./rumors";

export function resolveAndApplyAttempt(
  world: WorldState,
  attempt: Attempt,
  ctx: { rng: Rng; nextEventSeq: () => number }
): { world: WorldState; events: SimEvent[]; keyChanges: string[] } {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  let nextWorld = world;
  const actor = nextWorld.npcs[attempt.actorId];
  if (!actor) return { world, events, keyChanges };

  const site = nextWorld.sites[attempt.siteId];

  const emit = (kind: SimEvent["kind"], message: string, data?: Record<string, unknown>) => {
    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind,
      visibility: attempt.visibility,
      siteId: attempt.siteId,
      message,
      data: { attempt, ...(data ?? {}) }
    });
  };

  const addPublicRumor = (label: string, confidence: number) => {
    const rumor: SiteRumor = {
      tick: nextWorld.tick,
      kind: attempt.kind,
      actorId: attempt.actorId,
      targetId: attempt.targetId,
      siteId: attempt.siteId,
      confidence,
      label
    };
    nextWorld = applyPublicRumorAndRelationships(nextWorld, rumor);
  };

  if (attempt.kind === "travel") {
    const from = actor.siteId;
    const to = (attempt.resources?.toSiteId as string | undefined) ?? pickTravelDestination(nextWorld, from, ctx.rng);
    if (!to) return { world: nextWorld, events, keyChanges };
    const updatedActor: NpcState = { ...actor, siteId: to, lastAttemptTick: attempt.tick };
    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [actor.id]: updatedActor } };
    keyChanges.push(`${actor.name} traveled ${from} -> ${to}`);
    emit("attempt.recorded", `${actor.name} traveled`, { from, to });

    const dest = nextWorld.sites[to];
    if (isSettlement(dest)) {
      const ingested = ingestRumorsOnArrival(updatedActor, dest, nextWorld);
      nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [actor.id]: ingested } };
    }
    return { world: nextWorld, events, keyChanges };
  }

  if (attempt.kind === "work_farm" || attempt.kind === "work_fish" || attempt.kind === "work_hunt") {
    if (!isSettlement(site)) return { world: nextWorld, events, keyChanges };
    const hours = Math.max(1, Math.min(10, attempt.durationHours || 4));
    const type = attempt.kind === "work_farm" ? "grain" : attempt.kind === "work_fish" ? "fish" : "meat";

    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [actor.id]: { ...actor, lastAttemptTick: attempt.tick } } };
    // NOTE: Food production is handled by Phase 1.3 automatic processes.
    // Work attempts are currently observational/story signals (Phase 4), not additional net food.
    emit("attempt.recorded", `${actor.name} worked (${type})`, { type, hours });
    return { world: nextWorld, events, keyChanges };
  }

  if (attempt.kind === "heal") {
    if (!isSettlement(site)) return { world: nextWorld, events, keyChanges };
    const amt = ctx.rng.int(1, 4);
    const updatedSite: SettlementSiteState = { ...site, sickness: clamp(site.sickness - amt, 0, 100) };
    nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [site.id]: updatedSite } };
    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [actor.id]: { ...actor, lastAttemptTick: attempt.tick } } };
    emit("attempt.recorded", `${actor.name} healed in ${site.name}`, { sicknessReduced: amt });
    if (attempt.visibility === "public") addPublicRumor(`${actor.name} healed`, 85);
    return { world: nextWorld, events, keyChanges };
  }

  if (attempt.kind === "preach_fixed_path") {
    if (!isSettlement(site)) return { world: nextWorld, events, keyChanges };
    const base = 1 + Math.floor(actor.traits.NeedForCertainty / 35);
    const delta = Math.max(0, base + ctx.rng.int(-1, 1));
    const updatedSite: SettlementSiteState = { ...site, cultInfluence: clamp(site.cultInfluence + delta, 0, 100) };
    nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [site.id]: updatedSite } };
    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [actor.id]: { ...actor, lastAttemptTick: attempt.tick } } };
    emit("attempt.recorded", `${actor.name} preached the Fixed Path`, { cultInfluenceDelta: delta });
    if (attempt.visibility === "public") addPublicRumor(`${actor.name} preached the Fixed Path`, 70);
    return { world: nextWorld, events, keyChanges };
  }

  if (attempt.kind === "investigate") {
    if (!isSettlement(site)) return { world: nextWorld, events, keyChanges };
    const score = actor.traits.Suspicion * 0.6 + actor.traits.Discipline * 0.4;
    const difficulty = 50 + site.cultInfluence * 0.3;
    const chance = clamp((score - difficulty) + 55, 5, 90);
    const roll = ctx.rng.int(0, 99);
    const success = roll < chance;
    const delta = success ? -ctx.rng.int(1, 3) : 0;
    const updatedSite: SettlementSiteState = { ...site, cultInfluence: clamp(site.cultInfluence + delta, 0, 100) };
    nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [site.id]: updatedSite } };
    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [actor.id]: { ...actor, lastAttemptTick: attempt.tick } } };
    emit("attempt.recorded", `${actor.name} investigated`, { success, roll, chance, cultInfluenceDelta: delta });
    if (attempt.visibility === "public") addPublicRumor(`${actor.name} investigated`, 75);
    return { world: nextWorld, events, keyChanges };
  }

  if (attempt.kind === "steal") {
    if (!isSettlement(site)) return { world: nextWorld, events, keyChanges };
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

    let taken = 0;
    if (success) {
      const lots = [...site.food[targetType]];
      let remaining = amountWanted;
      for (let i = lots.length - 1; i >= 0 && remaining > 0; i--) {
        const lot = lots[i];
        const take = Math.min(lot.amount, remaining);
        lot.amount -= take;
        remaining -= take;
        taken += take;
        if (lot.amount <= 0) lots.splice(i, 1);
      }
      const updatedSite: SettlementSiteState = { ...site, food: { ...site.food, [targetType]: lots } };
      nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [site.id]: updatedSite } };
    }

    const witnessChance = attempt.visibility === "public" ? 0.9 : 0.25;
    const witnessed = ctx.rng.chance(witnessChance);

    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [actor.id]: { ...actor, lastAttemptTick: attempt.tick } } };
    emit("attempt.recorded", `${actor.name} attempted theft`, { success, taken, targetType, roll, chance, witnessed });

    if (witnessed) {
      addPublicRumor(`${actor.name} stole ${taken} ${targetType}`, 85);
    } else if (success) {
      if (ctx.rng.chance(0.15)) {
        const s2 = nextWorld.sites[attempt.siteId];
        if (isSettlement(s2)) {
          nextWorld = {
            ...nextWorld,
            sites: {
              ...nextWorld.sites,
              [attempt.siteId]: addRumor(s2, {
                tick: nextWorld.tick,
                kind: "steal",
                actorId: attempt.actorId,
                siteId: attempt.siteId,
                confidence: 30,
                label: `Rumor: ${actor.name} stole`
              })
            }
          };
        }
      }
    }

    return { world: nextWorld, events, keyChanges };
  }

  nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [actor.id]: { ...actor, lastAttemptTick: attempt.tick } } };
  emit("attempt.recorded", `${actor.name} attempted ${attempt.kind}`);
  return { world: nextWorld, events, keyChanges };
}


