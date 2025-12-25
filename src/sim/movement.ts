import { DEFAULT_DAYLIGHT_HOURS } from "./constants";
import { makeId } from "./ids";
import { findEdge } from "./map";
import type { NpcState, SimEvent, SiteId, TravelState, WorldState } from "./types";
import { tickToHourOfDay } from "./types";
import type { Rng } from "./rng";
import { ingestRumorsOnArrival, isSettlement } from "./attempts/rumors";
import { shareBeliefsOnArrival } from "./attempts/rumors";
import { clamp } from "./util";
import type { AttemptConsequence } from "./attempts/consequences";
import { applyConsequences } from "./attempts/applyConsequences";
import { seasonAtTick, travelSpeedMultiplier } from "./seasons";
// richer consequences are applied via applyConsequences (belief/relationship helpers are invoked there)

export function isNpcTraveling(npc: NpcState): boolean {
  return Boolean(npc.travel && npc.travel.remainingKm > 0);
}

function kmThisHour(
  hourOfDay: number,
  edgeQuality: TravelState["edgeQuality"],
  opts: { hp: number; maxHp: number; seasonMult: number }
): number {
  const isDay = hourOfDay >= DEFAULT_DAYLIGHT_HOURS.start && hourOfDay < DEFAULT_DAYLIGHT_HOURS.end;
  const roadBase = isDay ? 4 : 2;
  const base = edgeQuality === "rough" ? (isDay ? 2 : 1) : roadBase;
  // Simple realism: badly injured (low HP) travelers are slower, without needing the full injury system yet.
  const hpRatio = opts.maxHp > 0 ? opts.hp / opts.maxHp : 1;
  const injurySlow = hpRatio < 0.35 ? 0.65 : hpRatio < 0.6 ? 0.8 : 1;
  return base * injurySlow * (opts.seasonMult ?? 1);
}

export function startTravel(
  npc: NpcState,
  world: WorldState,
  to: SiteId
): { npc: NpcState; travel?: TravelState } {
  const from = npc.siteId;
  const edge = findEdge(world.map, from, to);
  if (!edge) return { npc };
  const km = edge.km;
  if (!(km > 0)) return { npc };
  const travel: TravelState = {
    kind: "travel",
    from,
    to,
    totalKm: Math.max(0, km),
    remainingKm: Math.max(0, km),
    edgeQuality: edge.quality ?? "road",
    startedTick: world.tick,
    lastProgressTick: world.tick
  };
  return { npc: { ...npc, travel, local: undefined, localTravel: undefined } };
}

type TravelEncounterKind = "mishap" | "meeting" | "bandits" | "omen";

function encounterChancePerHour(
  hourOfDay: number,
  edgeQuality: TravelState["edgeQuality"],
  ctx: { avgUnrest: number; avgPressure: number }
): number {
  const isDay = hourOfDay >= DEFAULT_DAYLIGHT_HOURS.start && hourOfDay < DEFAULT_DAYLIGHT_HOURS.end;
  const base = isDay ? 0.008 : 0.02; // night is riskier
  const terrain = edgeQuality === "rough" ? 1.35 : 1;
  const unrest = 1 + clamp(ctx.avgUnrest, 0, 100) / 250; // up to +0.4
  const pressure = 1 + clamp(ctx.avgPressure, 0, 100) / 350; // up to +0.29
  return clamp(base * terrain * unrest * pressure, 0, 0.08);
}

function pickEncounter(rng: Rng): TravelEncounterKind {
  const r = rng.int(1, 100);
  if (r <= 40) return "mishap";
  if (r <= 65) return "meeting";
  if (r <= 85) return "bandits";
  return "omen";
}

export function progressTravelHourly(
  world: WorldState,
  ctx: { rng: Rng; nextEventSeq: () => number }
): { world: WorldState; events: SimEvent[]; keyChanges: string[] } {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  let nextWorld = world;
  const hour = tickToHourOfDay(world.tick);

  // Stable iteration for deterministic RNG consumption.
  const npcIds = Object.keys(world.npcs).sort();
  for (const npcId of npcIds) {
    const npc = nextWorld.npcs[npcId];
    if (!npc || !npc.alive) continue;
    if (!isNpcTraveling(npc)) continue;
    if (!npc.travel) continue;
    if (npc.travel.lastProgressTick === world.tick) continue;

    const tr = npc.travel;
    const fromSite = nextWorld.sites[tr.from];
    const toSite = nextWorld.sites[tr.to];
    const fromUnrest = isSettlement(fromSite) ? fromSite.unrest : 0;
    const toUnrest = isSettlement(toSite) ? toSite.unrest : 0;
    const fromPressure = fromSite?.eclipsingPressure ?? 0;
    const toPressure = toSite?.eclipsingPressure ?? 0;
    const avgUnrest = (fromUnrest + toUnrest) / 2;
    const avgPressure = (fromPressure + toPressure) / 2;

    const seasonMult = travelSpeedMultiplier(seasonAtTick(world.tick));
    let kmStep = kmThisHour(hour, tr.edgeQuality, { hp: npc.hp, maxHp: npc.maxHp, seasonMult });
    let encounter: { kind: TravelEncounterKind; kmMultiplier: number; consequences: AttemptConsequence[] } | undefined;

    const chance = encounterChancePerHour(hour, tr.edgeQuality, { avgUnrest, avgPressure });
    if (ctx.rng.chance(chance)) {
      const kind = pickEncounter(ctx.rng);
      const consequences: AttemptConsequence[] = [];
      let kmMultiplier = 1;

      if (kind === "mishap") {
        kmMultiplier = 0.35;
        consequences.push({ kind: "npc.number.delta", npcId: npc.id, key: "trauma", delta: ctx.rng.int(1, 3) });
      }

      if (kind === "meeting") {
        // Small calming social contact; also seeds a low-confidence rumor at the destination.
        consequences.push({ kind: "npc.number.delta", npcId: npc.id, key: "trauma", delta: -ctx.rng.int(0, 2) });
        if (isSettlement(toSite)) {
          consequences.push({
            kind: "site.rumor.add",
            siteId: toSite.id,
            rumor: {
              tick: nextWorld.tick,
              kind: "incident",
              siteId: toSite.id,
              confidence: 35,
              label: `Travelers reported strange activity on the road (${tr.from} → ${tr.to})`
            }
          });
        }
      }

      if (kind === "bandits") {
        kmMultiplier = 0.6;
        consequences.push({ kind: "npc.number.delta", npcId: npc.id, key: "trauma", delta: ctx.rng.int(6, 14) });
        consequences.push({ kind: "npc.number.delta", npcId: npc.id, key: "hp", delta: -ctx.rng.int(1, 6) });

        // Make it UI-friendly: add a belief that "bandits attacked me" and a small generalized fear bump
        // via relationship deltas to known bandit-raider NPCs in the origin/destination sites.
        const belief = {
          subjectId: npc.id,
          predicate: "experienced",
          object: "bandit_attack",
          confidence: 80,
          source: "witnessed" as const,
          tick: nextWorld.tick
        };
        consequences.push({ kind: "npc.belief.add", npcId: npc.id, belief });

        // Apply small fear increases toward local bandits (if any are known/present).
        const localBandits = Object.values(nextWorld.npcs).filter(
          (n) => n.alive && n.category === "BanditRaider" && (n.siteId === tr.from || n.siteId === tr.to)
        );
        for (const b of localBandits.slice(0, 3)) {
          consequences.push({ kind: "npc.relationship.delta", npcId: npc.id, otherNpcId: b.id, delta: { fear: +8, trust: -3 }, confidence: 55 });
        }
      }

      if (kind === "omen") {
        // Purely narrative for now (useful for UI), no mechanical impact.
      }

      // Apply encounter effects immediately (so subsequent logic sees updated hp/trauma).
      if (consequences.length) nextWorld = applyConsequences(nextWorld, consequences);
      encounter = { kind, kmMultiplier, consequences };
    }

    if (encounter) {
      const trNow = nextWorld.npcs[npcId]?.travel ?? tr;
      const traveledKm = clamp(trNow.totalKm - trNow.remainingKm, 0, trNow.totalKm);
      const progress01 = trNow.totalKm > 0 ? clamp(traveledKm / trNow.totalKm, 0, 1) : 0;
      events.push({
        id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
        tick: nextWorld.tick,
        kind: "travel.encounter",
        visibility: "public",
        siteId: trNow.from,
        message: `Encounter on the road (${encounter.kind})`,
        data: {
          npcId,
          from: trNow.from,
          to: trNow.to,
          edgeQuality: trNow.edgeQuality,
          progress01,
          encounterKind: encounter.kind,
          encounterChance: chance,
          consequences: encounter.consequences
        }
      });
    }

    kmStep = kmStep * (encounter?.kmMultiplier ?? 1);
    const remaining = Math.max(0, tr.remainingKm - kmStep);
    const arrived = remaining <= 0;

    if (!arrived) {
      const updated: NpcState = {
        ...npc,
        travel: { ...tr, remainingKm: remaining, lastProgressTick: world.tick }
      };
      nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [npc.id]: updated } };
      continue;
    }

    // Arrival: clear travel, update location, and ingest site rumors.
    const updatedBase: NpcState = {
      ...npc,
      siteId: tr.to,
      travel: undefined,
      local: undefined,
      localTravel: undefined
    };

    let updated = updatedBase;
    const dest = nextWorld.sites[tr.to];
    if (isSettlement(dest)) {
      // Phase X: initialize a local location when arriving in a settlement.
      // - if returning home, put them at their homeLocationId (if it exists and belongs to this site)
      // - otherwise place at gate/streets
      const localIdCandidates = [
        updated.homeSiteId === dest.id && updated.homeLocationId ? updated.homeLocationId : undefined,
        `${dest.id}:gate`,
        `${dest.id}:streets`
      ].filter(Boolean) as string[];
      const localNodes = dest.local?.nodes ?? [];
      const exists = (id: string) => localNodes.some((n) => n.id === id);
      const chosen = localIdCandidates.find((id) => exists(id)) ?? (localNodes[0]?.id);
      if (chosen) updated = { ...updated, local: { siteId: dest.id, locationId: chosen } };

      updated = ingestRumorsOnArrival(updated, dest, nextWorld);
      // Spread a tiny amount of gossip cross-site (bounded, no immediate relationship cascade).
      const withGossip = shareBeliefsOnArrival(updated, dest, nextWorld);
      if (withGossip !== dest) {
        nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [dest.id]: withGossip } };
      }
    }

    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [npc.id]: updated } };
    keyChanges.push(`${npc.name} arrived at ${tr.to}`);

    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind: "attempt.recorded",
      visibility: "public",
      siteId: tr.to,
      message: `${npc.name} arrived`,
      data: { travel: tr }
    });
  }

  return { world: nextWorld, events, keyChanges };
}


