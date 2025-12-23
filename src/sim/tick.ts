import type { Attempt, DailySummary, SimEvent, TickResult, WorldState } from "./types";
import { tickToDay, tickToHourOfDay } from "./types";
import { Rng } from "./rng";
import { applyAutomaticProcesses } from "./processes";
import { makeId } from "./ids";
import { computeNpcNeeds, selectActiveNpcs } from "./npcs";
import { generateScoredAttempt, resolveAndApplyAttempt } from "./attempts";
import { progressTravelHourly, isNpcTraveling } from "./movement";
import { progressLocalTravelHourly } from "./localMovement";
import { progressDetentionHourly, progressEclipsingHourly } from "./eclipsing";
import { decayBeliefsDaily } from "./beliefs";
import { applyNotabilityFromEvents, decayNotabilityDaily } from "./notability";
import { updateStates } from "./states/engine";
import { clamp } from "./util";
import { applyBeliefsFromEvents } from "./beliefs/creation";

export type TickOptions = {
  attempts?: Attempt[];
};

export function tickHour(world: WorldState, opts: TickOptions = {}): TickResult {
  const nextTick = world.tick + 1;
  const rng = new Rng((world.seed ^ nextTick) >>> 0);

  let eventSeq = 0;
  const nextEventSeq = () => ++eventSeq;

  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  if (world.tick === 0) {
    events.push({
      id: makeId("evt", world.tick, nextEventSeq()),
      tick: world.tick,
      kind: "sim.started",
      visibility: "system",
      message: `Simulation started (seed=${world.seed})`,
      data: { seed: world.seed }
    });
  }

  const advancedWorld: WorldState = { ...world, tick: nextTick };

  const proc = applyAutomaticProcesses(advancedWorld, { rng, nextEventSeq });
  events.push(...proc.events);
  keyChanges.push(...proc.keyChanges);

  // Travel progresses with time (Phase 1.2). Travelers aren't considered "in any site" until arrival.
  const moved = progressTravelHourly(proc.world, { rng, nextEventSeq });
  events.push(...moved.events);
  keyChanges.push(...moved.keyChanges);

  // Intra-settlement movement progresses with time (Phase X).
  const movedLocal = progressLocalTravelHourly(moved.world, { rng, nextEventSeq });
  events.push(...movedLocal.events);
  keyChanges.push(...movedLocal.keyChanges);

  const detention = progressDetentionHourly(movedLocal.world, { rng, nextEventSeq });
  events.push(...detention.events);
  keyChanges.push(...detention.keyChanges);

  const eclipsing = progressEclipsingHourly(detention.world, { rng, nextEventSeq });
  events.push(...eclipsing.events);
  keyChanges.push(...eclipsing.keyChanges);

  // Phase 4: update NPC needs, select active NPCs, generate scoring-based attempts.
  let withNeeds = eclipsing.world;
  {
    const nextNpcs = { ...withNeeds.npcs };
    for (const npc of Object.values(withNeeds.npcs)) {
      // Small trauma decay each hour (details fade, emotion fades slowly).
      const trauma = npc.alive ? Math.max(0, npc.trauma - 0.2) : npc.trauma;

      // Home tracking (Task 8):
      // - set awayFromHomeSinceTick when first leaving home
      // - clear it upon returning home
      // - after 7 days away, treat current site as new home and reset belonging pressure
      let homeSiteId = npc.homeSiteId;
      let awayFromHomeSinceTick = npc.awayFromHomeSinceTick;
      const isAway = npc.siteId !== npc.homeSiteId;
      if (npc.alive && isAway) {
        if (awayFromHomeSinceTick === undefined) awayFromHomeSinceTick = withNeeds.tick;
        const hoursAway = withNeeds.tick - awayFromHomeSinceTick;
        if (hoursAway >= 24 * 7) {
          homeSiteId = npc.siteId;
          awayFromHomeSinceTick = undefined;
        }
      } else {
        awayFromHomeSinceTick = undefined;
      }

      // Task 11: named NPC starvation based on sustained site hunger.
      const site = withNeeds.sites[npc.siteId] as any;
      const isHungry =
        npc.alive &&
        site?.kind === "settlement" &&
        !isNpcTraveling(npc) &&
        typeof site.hunger === "number" &&
        site.hunger >= 60;

      const consecutiveHungerHours = isHungry ? (npc.consecutiveHungerHours ?? 0) + 1 : 0;

      const elderProxy =
        npc.category === "LocalLeader" ||
        npc.category === "ContinuumScholar" ||
        npc.category === "ElvenLeader" ||
        npc.category === "ConcordCellLeaderRitualist";
      const childProxy = npc.category === "TaintedThrall"; // weakest proxy bucket for now
      const hungerDamageMult = elderProxy ? 1.5 : childProxy ? 1.25 : 1.0;

      let hp = npc.hp;
      let alive = npc.alive;
      let death = npc.death;

      if (npc.alive && consecutiveHungerHours >= 48 && site?.kind === "settlement") {
        const dmg = Math.round(5 * hungerDamageMult);
        hp = clamp(hp - dmg, 0, npc.maxHp);
        if (hp <= 0) {
          alive = false;
          death = { tick: withNeeds.tick, cause: "starvation", atSiteId: npc.siteId };
          events.push({
            id: makeId("evt", withNeeds.tick, nextEventSeq()),
            tick: withNeeds.tick,
            kind: "npc.died",
            visibility: "system",
            siteId: npc.siteId,
            message: `${npc.name} died of starvation at ${site.name}`,
            data: { npcId: npc.id, cause: "starvation", atSiteId: npc.siteId }
          });
          keyChanges.push(`${npc.name} died of starvation at ${site.name}`);
        }
      }

      const updated = { ...npc, trauma, homeSiteId, awayFromHomeSinceTick, consecutiveHungerHours, hp, alive, death };
      nextNpcs[npc.id] = { ...updated, needs: computeNpcNeeds(updated, withNeeds) };
    }
    withNeeds = { ...withNeeds, npcs: nextNpcs };
  }

  // Include externally supplied attempts (e.g. future player/adapter), plus AI attempts.
  const aiAttempts: Attempt[] = [];
  {
    const active = selectActiveNpcs(withNeeds, rng);
    const activeIds = Array.from(active.activeNpcIds).sort();
    for (const npcId of activeIds) {
      const npc = withNeeds.npcs[npcId];
      if (!npc) continue;
      const a = generateScoredAttempt(npc, withNeeds, rng);
      if (a) aiAttempts.push(a);
    }
  }

  let afterAttempts = withNeeds;
  // Resolve supplied attempts first (stable), then AI attempts.
  const allAttempts = [...(opts.attempts ?? []), ...aiAttempts];
  for (const a of allAttempts) {
    const res = resolveAndApplyAttempt(afterAttempts, a, { rng, nextEventSeq });
    afterAttempts = res.world;
    events.push(...res.events);
    keyChanges.push(...res.keyChanges);
  }

  // Task 13: create beliefs from observed events/attempts before reactive state updates.
  afterAttempts = applyBeliefsFromEvents(afterAttempts, events);

  // Reactive state updates (v2 AI system): triggers from this tick's events and world diffs.
  afterAttempts = updateStates(afterAttempts, withNeeds, events);

  // Notability promotion from notable events (Phase 4.4 minimal).
  afterAttempts = applyNotabilityFromEvents(afterAttempts, events);

  const hourOfDay = tickToHourOfDay(afterAttempts.tick);
  const isEndOfDay = hourOfDay === 23;

  let dailySummary: DailySummary | undefined;
  if (isEndOfDay) {
    // Daily belief decay (Phase 3.5 minimal).
    {
      const nextNpcs = { ...afterAttempts.npcs };
      for (const n of Object.values(afterAttempts.npcs)) {
        if (!n.alive) continue;
        nextNpcs[n.id] = decayBeliefsDaily(n, afterAttempts.tick);
      }
      afterAttempts = { ...afterAttempts, npcs: nextNpcs };
    }

    afterAttempts = decayNotabilityDaily(afterAttempts);

    const day = tickToDay(afterAttempts.tick);
    const sites: DailySummary["sites"] = Object.values(afterAttempts.sites).map((s) => {
      const npcsHere = Object.values(afterAttempts.npcs).filter((n) => n.siteId === s.id && !isNpcTraveling(n));
      const aliveNpcs = npcsHere.filter((n) => n.alive).length;
      const deadNpcs = npcsHere.length - aliveNpcs;
      const cultMembers = npcsHere.filter((n) => n.alive && n.cult.member).length;
      const avgTrauma =
        aliveNpcs > 0
          ? npcsHere.filter((n) => n.alive).reduce((a, n) => a + n.trauma, 0) / aliveNpcs
          : 0;

      if (s.kind !== "settlement") {
        return {
          siteId: s.id,
          name: s.name,
          culture: s.culture,
          eclipsingPressure: s.eclipsingPressure,
          anchoringStrength: s.anchoringStrength,
          aliveNpcs,
          deadNpcs,
          cultMembers,
          avgTrauma,
          keyChanges: []
        };
      }

      const foodTotals = {
        grain: s.food.grain.reduce((a, l) => a + l.amount, 0),
        fish: s.food.fish.reduce((a, l) => a + l.amount, 0),
        meat: s.food.meat.reduce((a, l) => a + l.amount, 0)
      };

      return {
        siteId: s.id,
        name: s.name,
        culture: s.culture,
        cohorts: s.cohorts,
        housingCapacity: s.housingCapacity,
        foodTotals,
        unrest: s.unrest,
        morale: s.morale,
        sickness: s.sickness,
        hunger: s.hunger,
        cultInfluence: s.cultInfluence,
        eclipsingPressure: s.eclipsingPressure,
        anchoringStrength: s.anchoringStrength,
        aliveNpcs,
        deadNpcs,
        cultMembers,
        avgTrauma,
        keyChanges: [],
        deathsToday: s.deathsToday
      };
    });

    dailySummary = {
      tick: afterAttempts.tick,
      day,
      hourOfDay,
    keyChanges: keyChanges.length ? keyChanges : ["No significant changes"],
      sites
  };

  events.push({
      id: makeId("evt", afterAttempts.tick, nextEventSeq()),
      tick: afterAttempts.tick,
    kind: "sim.day.ended",
    visibility: "system",
      message: `Day ${day} ended`,
      data: { summary: dailySummary }
  });
  }

  return { world: afterAttempts, events, dailySummary };
}


