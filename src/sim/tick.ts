import type { Attempt, DailySummary, SimEvent, TickResult, WorldState } from "./types";
import { tickToDay, tickToHourOfDay } from "./types";
import { Rng } from "./rng";
import { applyAutomaticProcesses } from "./processes";
import { makeId } from "./ids";
import { computeNpcNeeds, selectActiveNpcs } from "./npcs";
import { generateReflexAttempt, resolveAndApplyAttempt } from "./attempts";
import { progressTravelHourly, isNpcTraveling } from "./movement";
import { progressDetentionHourly, progressEclipsingHourly } from "./eclipsing";
import { decayBeliefsDaily } from "./beliefs";
import { applyNotabilityFromEvents, decayNotabilityDaily } from "./notability";
import { updateStates } from "./states/engine";

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

  const detention = progressDetentionHourly(moved.world, { rng, nextEventSeq });
  events.push(...detention.events);
  keyChanges.push(...detention.keyChanges);

  const eclipsing = progressEclipsingHourly(detention.world, { rng, nextEventSeq });
  events.push(...eclipsing.events);
  keyChanges.push(...eclipsing.keyChanges);

  // Phase 4: update NPC needs, select active NPCs, generate reflex attempts.
  let withNeeds = eclipsing.world;
  {
    const nextNpcs = { ...withNeeds.npcs };
    for (const npc of Object.values(withNeeds.npcs)) {
      // Small trauma decay each hour (details fade, emotion fades slowly).
      const trauma = npc.alive ? Math.max(0, npc.trauma - 0.2) : npc.trauma;
      nextNpcs[npc.id] = { ...npc, trauma, needs: computeNpcNeeds({ ...npc, trauma }, withNeeds) };
    }
    withNeeds = { ...withNeeds, npcs: nextNpcs };
  }

  // Include externally supplied attempts (e.g. future player/adapter), plus reflex attempts.
  const reflexAttempts: Attempt[] = [];
  {
    const active = selectActiveNpcs(withNeeds, rng);
    const activeIds = Array.from(active.activeNpcIds).sort();
    for (const npcId of activeIds) {
      const npc = withNeeds.npcs[npcId];
      if (!npc) continue;
      const a = generateReflexAttempt(npc, withNeeds, rng);
      if (a) reflexAttempts.push(a);
    }
  }

  let afterAttempts = withNeeds;
  // Resolve supplied attempts first (stable), then reflex attempts.
  const allAttempts = [...(opts.attempts ?? []), ...reflexAttempts];
  for (const a of allAttempts) {
    const res = resolveAndApplyAttempt(afterAttempts, a, { rng, nextEventSeq });
    afterAttempts = res.world;
    events.push(...res.events);
    keyChanges.push(...res.keyChanges);
  }

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


