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
import { updateGoals } from "./goals/engine";
import { processPendingAttempts, scheduleAttemptIfNeeded } from "./attempts/lifecycle";
import { createMemoriesFromEvents, decayMemoriesDaily } from "./systems/memory";
import { applyPlanProgressFromEvents, updatePlans } from "./systems/planning";
import { applyOperationProgressFromEvents, updateFactionOperationsWithEvents } from "./systems/factionOps";
import { updateChronicleFromEvents } from "./systems/narrative";
import { updatePerception } from "./systems/perception";
import { createSecretsFromEvents } from "./systems/secrets";
import { decayRumorsDaily, spreadRumorsDaily } from "./attempts/rumors";
import { syncEntitiesFromNpcs } from "./entities";
import { decayEmotionsHourly, getEmotions } from "./systems/emotions";
import { emitSignalsFromState } from "./systems/signals";

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

  // v2: Perception snapshot updates (knowledge about who is where).
  const perceived = updatePerception(movedLocal.world, rng);

  const detention = progressDetentionHourly(perceived, { rng, nextEventSeq });
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
      const emotions = npc.alive ? decayEmotionsHourly({ ...npc, emotions: getEmotions(npc) }) : npc.emotions;

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

      const updated = { ...npc, trauma, emotions, homeSiteId, awayFromHomeSinceTick, consecutiveHungerHours, hp, alive, death };
      nextNpcs[npc.id] = { ...updated, needs: computeNpcNeeds(updated, withNeeds) };
    }
    withNeeds = { ...withNeeds, npcs: nextNpcs };
  }

  // Goals: update/maintain parallel goals before attempt generation.
  withNeeds = updateGoals(withNeeds, { rng });

  // Signals: lightweight public "tells" derived from current state (no separate intent state).
  {
    const sig = emitSignalsFromState(withNeeds, nextEventSeq);
    withNeeds = sig.world;
    events.push(...sig.events);
    keyChanges.push(...sig.keyChanges);
  }

  // v2: Minimal planning - create/refresh plans before generating attempts.
  withNeeds = updatePlans(withNeeds, nextEventSeq);

  // v2: Faction operations planning (creates/maintains world.operations).
  {
    const opRes = updateFactionOperationsWithEvents(withNeeds, nextEventSeq);
    withNeeds = opRes.world;
    events.push(...opRes.events);
  }

  // Execute any due pending attempts before generating new ones.
  {
    const pendingRes = processPendingAttempts(withNeeds, { rng, nextEventSeq });
    withNeeds = pendingRes.world;
    events.push(...pendingRes.events);
    keyChanges.push(...pendingRes.keyChanges);
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
    const scheduled = scheduleAttemptIfNeeded(afterAttempts, a, { rng, nextEventSeq });
    if (scheduled.scheduled) {
      afterAttempts = scheduled.world;
      events.push(...scheduled.events);
      keyChanges.push(...scheduled.keyChanges);
      continue;
    }

    const res = resolveAndApplyAttempt(afterAttempts, a, { rng, nextEventSeq });
    afterAttempts = res.world;
    events.push(...res.events);
    keyChanges.push(...res.keyChanges);
    // Completion marker for immediate attempts.
    events.push({
      id: makeId("evt", afterAttempts.tick, nextEventSeq()),
      tick: afterAttempts.tick,
      kind: "attempt.completed",
      visibility: a.visibility,
      siteId: a.siteId,
      message: `Attempt completed: ${a.kind}`,
      data: { attempt: a }
    });
  }

  // Task 13: create beliefs from observed events/attempts before reactive state updates.
  afterAttempts = applyBeliefsFromEvents(afterAttempts, events);

  // v2: plan progress from executed attempts.
  afterAttempts = applyPlanProgressFromEvents(afterAttempts, events);

  // v2: secrets from executed attempts/events.
  afterAttempts = createSecretsFromEvents(afterAttempts, events, nextEventSeq);

  // v2: operation phase progress from executed attempts/events (emit milestone events for narrative).
  {
    const opProg = applyOperationProgressFromEvents(afterAttempts, events, nextEventSeq);
    afterAttempts = opProg.world;
    events.push(...opProg.events);
  }

  // v2: narrative chronicle update from this tick's events.
  afterAttempts = updateChronicleFromEvents(afterAttempts, events, nextEventSeq);

  // Reactive state updates (v2 AI system): triggers from this tick's events and world diffs.
  afterAttempts = updateStates(afterAttempts, withNeeds, events);

  // Notability promotion from notable events (Phase 4.4 minimal).
  afterAttempts = applyNotabilityFromEvents(afterAttempts, events);

  // v2: Create memories from observed events.
  {
    const memResult = createMemoriesFromEvents(afterAttempts, events, nextEventSeq);
    afterAttempts = memResult.world;
    events.push(...memResult.memoryEvents);
  }

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

    // v2: Daily memory decay.
    {
      const memDecay = decayMemoriesDaily(afterAttempts, nextEventSeq);
      afterAttempts = memDecay.world;
      events.push(...memDecay.events);
    }

    // v2: rumor decay + inter-site spread.
    afterAttempts = decayRumorsDaily(afterAttempts);
    afterAttempts = spreadRumorsDaily(afterAttempts, rng);

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

  // v2: keep optional entity registry synced as a derived view of named NPCs.
  afterAttempts = syncEntitiesFromNpcs(afterAttempts);

  return { world: afterAttempts, events, dailySummary };
}


