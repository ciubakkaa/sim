import type { Attempt, DailySummary, SimEvent, TickResult, WorldState } from "./types";
import { tickToDay, tickToHourOfDay } from "./types";
import { Rng } from "./rng";
import { applyAutomaticProcesses } from "./processes";
import { makeId } from "./ids";
import { computeNpcNeeds, selectActiveNpcs } from "./npcs";
import { generateReflexAttempt, resolveAndApplyAttempt } from "./attempts";

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

  // Record attempts (resolution pipeline is added in Phase 3/4; for now we just log).
  for (const a of opts.attempts ?? []) {
    events.push({
      id: makeId("evt", world.tick, nextEventSeq()),
      tick: world.tick,
      kind: "attempt.recorded",
      visibility: a.visibility,
      message: `Attempt recorded: ${a.kind}`,
      data: { attempt: a },
      siteId: a.siteId
    });
  }

  const advancedWorld: WorldState = { ...world, tick: nextTick };

  const proc = applyAutomaticProcesses(advancedWorld, { rng, nextEventSeq });
  events.push(...proc.events);
  keyChanges.push(...proc.keyChanges);

  // Phase 4: update NPC needs, select active NPCs, generate reflex attempts.
  let withNeeds = proc.world;
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

  const hourOfDay = tickToHourOfDay(afterAttempts.tick);
  const isEndOfDay = hourOfDay === 23;

  let dailySummary: DailySummary | undefined;
  if (isEndOfDay) {
    const day = tickToDay(afterAttempts.tick);
    const sites: DailySummary["sites"] = Object.values(afterAttempts.sites).map((s) => {
      const npcsHere = Object.values(afterAttempts.npcs).filter((n) => n.siteId === s.id);
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
        cultInfluence: s.cultInfluence,
        eclipsingPressure: s.eclipsingPressure,
        anchoringStrength: s.anchoringStrength,
        aliveNpcs,
        deadNpcs,
        cultMembers,
        avgTrauma,
        keyChanges: []
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


