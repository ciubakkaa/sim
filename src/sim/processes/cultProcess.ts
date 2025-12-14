import { CULT_INCIDENT_BASE_CHANCE_PER_DAY } from "../constants";
import { killRandomNpcInSite } from "../death";
import { makeId } from "../ids";
import { clamp } from "../util";
import type { FoodType, SettlementSiteState, SimEvent, WorldState } from "../types";
import { tickToHourOfDay } from "../types";
import type { ProcessContext, ProcessResult } from "./types";

function isSettlement(site: unknown): site is SettlementSiteState {
  return Boolean(site && (site as SettlementSiteState).kind === "settlement");
}

type IncidentType = "arson_fields" | "theft_food" | "murder" | "intimidation";

function pickIncidentType(ctx: ProcessContext): IncidentType {
  const r = ctx.rng.int(1, 100);
  if (r <= 30) return "theft_food";
  if (r <= 55) return "intimidation";
  if (r <= 80) return "arson_fields";
  return "murder";
}

function cultureRecruitmentFactor(site: SettlementSiteState): number {
  if (site.culture === "elven") return 0.02; // near-zero by default
  if (site.culture === "human") return 1;
  return 0.2;
}

export function applyCultDaily(world: WorldState, ctx: ProcessContext): ProcessResult {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  const hour = tickToHourOfDay(world.tick);
  if (hour !== 0) return { world, events, keyChanges }; // daily boundary only

  let nextWorld = world;

  for (const siteId of world.map.sites) {
    const site = nextWorld.sites[siteId];
    if (!isSettlement(site)) continue;

    // Recruitment is NPC-level. Site cultInfluence is derived from actual members, not unrest alone.
    const recruitFactor = cultureRecruitmentFactor(site);
    const pressure = site.eclipsingPressure / 100;
    const unrest = site.unrest / 100;
    const anchorBlock = 1 - site.anchoringStrength / 100;

    const siteNpcs = Object.values(nextWorld.npcs).filter((n) => n.alive && n.siteId === siteId);
    const aliveCount = siteNpcs.length;
    const memberCount = siteNpcs.filter((n) => n.cult.member).length;

    // Attempt a few recruitments per day in human settlements when conditions are ripe.
    if (site.culture === "human" && aliveCount > 0) {
      const recruiters = siteNpcs.filter((n) => n.cult.role === "devotee" || n.cult.role === "cell_leader");
      const potentialTargets = siteNpcs.filter((n) => !n.cult.member);

      const attempts = clamp(Math.round((recruiters.length / Math.max(1, aliveCount)) * 6), 0, 3);
      for (let i = 0; i < attempts && potentialTargets.length > 0; i++) {
        const targetIdx = ctx.rng.int(0, potentialTargets.length - 1);
        const target = potentialTargets.splice(targetIdx, 1)[0]!;

        // Susceptibility: traits + trauma + environment. Unrest is only a partial driver.
        const certainty = target.traits.NeedForCertainty / 100;
        const fear = target.traits.Fear / 100;
        const integrity = target.traits.Integrity / 100;
        const trauma = target.trauma / 100;

        const base =
          recruitFactor *
          anchorBlock *
          (0.35 * certainty + 0.15 * fear + 0.35 * trauma + 0.2 * pressure + 0.1 * unrest - 0.25 * integrity);

        const chance = clamp(base, 0, 0.85);
        if (ctx.rng.chance(chance)) {
          nextWorld = {
            ...nextWorld,
            npcs: {
              ...nextWorld.npcs,
              [target.id]: {
                ...target,
                category: "ConcordDevotee",
                cult: { member: true, role: "devotee", joinedTick: nextWorld.tick }
              }
            }
          };
          keyChanges.push(`${target.name} joined the Concord in ${site.name}`);
        }
      }
    }

    // Derive site influence from membership, with small smoothing so it doesn't jitter.
    const nextMemberCount = Object.values(nextWorld.npcs).filter((n) => n.alive && n.siteId === siteId && n.cult.member).length;
    const derived = aliveCount > 0 ? clamp(Math.round((nextMemberCount / aliveCount) * 100), 0, 100) : 0;
    const smoothed = clamp(Math.round(site.cultInfluence * 0.7 + derived * 0.3), 0, 100);

    const updated: SettlementSiteState = { ...site, cultInfluence: smoothed };
    nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [siteId]: updated } };

    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind: "world.cult.influence",
      visibility: "system",
      siteId,
      message: `Cult influence updated at ${site.name}`,
      data: { cultInfluence: smoothed, members: nextMemberCount, alive: aliveCount }
    });

    // Incident generator (low-level harm).
    const incidentChance =
      CULT_INCIDENT_BASE_CHANCE_PER_DAY * (smoothed / 100) * (site.eclipsingPressure / 100) * anchorBlock;

    if (ctx.rng.chance(incidentChance)) {
      const incidentType = pickIncidentType(ctx);
      let incidentEffects: Record<string, unknown> = { type: incidentType };

      let mutated = nextWorld.sites[siteId] as SettlementSiteState;

      if (incidentType === "arson_fields") {
        const dmg = 0.08 + ctx.rng.int(0, 6) / 100; // 0.08..0.14
        mutated = { ...mutated, fieldsCondition: clamp(mutated.fieldsCondition - dmg, 0, 1), unrest: clamp(mutated.unrest + 3, 0, 100) };
        incidentEffects = { ...incidentEffects, fieldsDamage: dmg };
        keyChanges.push(`${site.name} fields burned (-${dmg.toFixed(2)} condition)`);
      }

      if (incidentType === "theft_food") {
        const type: FoodType = ctx.rng.chance(0.5) ? "grain" : ctx.rng.chance(0.5) ? "fish" : "meat";
        const stealAmt = ctx.rng.int(4, 18);
        // Remove from newest lots first (crude, but reflects targeted theft).
        const lots = [...mutated.food[type]];
        let remaining = stealAmt;
        for (let i = lots.length - 1; i >= 0 && remaining > 0; i--) {
          const lot = lots[i];
          const take = Math.min(lot.amount, remaining);
          lot.amount -= take;
          remaining -= take;
          if (lot.amount <= 0) lots.splice(i, 1);
        }
        mutated = { ...mutated, food: { ...mutated.food, [type]: lots }, unrest: clamp(mutated.unrest + 2, 0, 100) };
        incidentEffects = { ...incidentEffects, foodType: type, amount: stealAmt - remaining };
        keyChanges.push(`${site.name} suffered food theft (${type})`);
      }

      if (incidentType === "murder") {
        const adultLoss = mutated.cohorts.adults > 0 ? 1 : 0;
        // Also kill a named NPC when possible (named NPCs are a subset of the population).
        const killRes = killRandomNpcInSite(nextWorld, siteId, ctx.rng, { tick: nextWorld.tick, cause: "murder" });
        nextWorld = killRes.world;
        // Trauma spikes for the site after a murder (people react).
        for (const n of Object.values(nextWorld.npcs)) {
          if (n.alive && n.siteId === siteId) {
            nextWorld = {
              ...nextWorld,
              npcs: {
                ...nextWorld.npcs,
                [n.id]: { ...n, trauma: clamp(n.trauma + 12, 0, 100) }
              }
            };
          }
        }
        mutated = {
          ...mutated,
          cohorts: { ...mutated.cohorts, adults: mutated.cohorts.adults - adultLoss },
          unrest: clamp(mutated.unrest + 6, 0, 100),
          morale: clamp(mutated.morale - 4, 0, 100)
        };
        incidentEffects = { ...incidentEffects, adultLoss, victimNpcId: killRes.victimId };
        if (adultLoss) keyChanges.push(`${site.name} suffered a murder (+unrest)`);
      }

      if (incidentType === "intimidation") {
        mutated = { ...mutated, unrest: clamp(mutated.unrest + 4, 0, 100) };
        // Intimidation/torture-like pressure: pick one NPC and spike trauma.
        const candidates = Object.values(nextWorld.npcs).filter((n) => n.alive && n.siteId === siteId);
        if (candidates.length) {
          const victim = candidates[ctx.rng.int(0, candidates.length - 1)]!;
          nextWorld = {
            ...nextWorld,
            npcs: {
              ...nextWorld.npcs,
              [victim.id]: { ...victim, trauma: clamp(victim.trauma + 18, 0, 100), forcedActiveUntilTick: nextWorld.tick + 48 }
            }
          };
          incidentEffects = { ...incidentEffects, victimNpcId: victim.id };
          keyChanges.push(`${victim.name} was brutalized in ${site.name}`);
        } else {
          keyChanges.push(`${site.name} intimidated by cult agents`);
        }
      }

      nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [siteId]: mutated } };

      events.push({
        id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
        tick: nextWorld.tick,
        kind: "world.incident",
        visibility: "system",
        siteId,
        message: `Incident at ${site.name}: ${incidentType}`,
        data: incidentEffects
      });
    }
  }

  return { world: nextWorld, events, keyChanges };
}


