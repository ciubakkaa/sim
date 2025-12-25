import { REFUGEE_DAILY_BASE_MAX, REFUGEE_DAILY_BASE_MIN } from "../constants";
import { makeId } from "../ids";
import { totalFood } from "../food";
import { clamp } from "../util";
import type { SettlementSiteState, SimEvent, WorldState } from "../types";
import { tickToDay, tickToHourOfDay } from "../types";
import type { ProcessContext, ProcessResult } from "./types";
import { defaultTraits, emptyNeeds } from "../npcs";
import { baselineRelationship } from "../relationships";
import { emptyEmotions } from "../systems/emotions";

function isSettlement(site: unknown): site is SettlementSiteState {
  return Boolean(site && (site as SettlementSiteState).kind === "settlement");
}

function pickRefugeeDestination(sites: SettlementSiteState[], rng: ProcessContext["rng"]): SettlementSiteState | undefined {
  // Prefer low unrest, available housing, human culture, and (as a tie-breaker) lower sickness.
  const candidates = sites.filter((s) => s.culture === "human");
  if (!candidates.length) return sites[0];

  const scored = candidates.map((s) => {
    const pop = s.cohorts.children + s.cohorts.adults + s.cohorts.elders;
    const housingSlack = Math.max(0, s.housingCapacity - pop);
    const totals = totalFood(s.food);
    const stored = totals.grain + totals.fish + totals.meat;
    const perCapitaStored = pop > 0 ? stored / pop : 0;
    const foodScore = clamp(perCapitaStored * 20, 0, 60); // reward sites that actually have food stored

    const score = housingSlack * 2 + (100 - s.unrest) + (100 - s.sickness) * 0.2 + foodScore;
    return { s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(3, scored.length));
  return top[rng.int(0, top.length - 1)]?.s;
}

export function applyPopulationProcessDaily(world: WorldState, ctx: ProcessContext): ProcessResult {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  const hour = tickToHourOfDay(world.tick);
  if (hour !== 0) return { world, events, keyChanges }; // daily boundary only

  const day = tickToDay(world.tick);
  let nextWorld = world;

  const settlementIds = world.map.sites.filter((id) => (world.sites[id] as any).kind === "settlement");
  const settlements = settlementIds.map((id) => nextWorld.sites[id]).filter(isSettlement);

  // Reset daily death counters at day boundary.
  for (const siteId of settlementIds) {
    const s = nextWorld.sites[siteId];
    if (!isSettlement(s)) continue;
    nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [siteId]: { ...s, deathsToday: {} } } };
  }

  // Refugee inflow (daily trickle).
  let refugees = ctx.rng.int(REFUGEE_DAILY_BASE_MIN, REFUGEE_DAILY_BASE_MAX);
  if (refugees > 0 && settlements.length) {
    const dest = pickRefugeeDestination(settlements, ctx.rng);
    if (dest) {
      // If the destination is starving/overcrowded, refugees avoid it (they may pass through the valley instead).
      const pop = dest.cohorts.children + dest.cohorts.adults + dest.cohorts.elders;
      const totals = totalFood(dest.food);
      const stored = totals.grain + totals.fish + totals.meat;
      const perCapitaStored = pop > 0 ? stored / pop : 0;
      const overcrowd = Math.max(0, pop - dest.housingCapacity);
      if (perCapitaStored < 0.6 || overcrowd > 0) {
        refugees = 0;
      }
    }
    if (refugees <= 0) {
      // no-op
    } else if (dest) {
      const addedAdults = Math.max(0, Math.round(refugees * 0.7));
      const addedChildren = refugees - addedAdults;
      const updated: SettlementSiteState = {
        ...dest,
        cohorts: {
          ...dest.cohorts,
          adults: dest.cohorts.adults + addedAdults,
          children: dest.cohorts.children + addedChildren
        }
      };

      nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [updated.id]: updated } };
      keyChanges.push(`${updated.name} received ${refugees} refugees`);

      events.push({
        id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
        tick: nextWorld.tick,
        kind: "world.refugees.arrived",
        visibility: "system",
        siteId: updated.id,
        message: `${refugees} refugees arrived at ${updated.name}`,
        data: { refugees, addedAdults, addedChildren }
      });
    }
  }

  // Task 17: Refugee named NPC generation (daily, only for under-populated settlements).
  {
    const totalWorldPop = settlements.reduce((a, s) => a + s.cohorts.children + s.cohorts.adults + s.cohorts.elders, 0);
    const lowWorldPopMult = totalWorldPop < 200 ? 2 : 1;

    const nameFirst = ["Alden", "Mara", "Jon", "Tessa", "Bran", "Lysa", "Edrin", "Sera", "Dane", "Rook", "Fenn", "Kara"];
    const nameLast = ["Ashford", "Evershore", "Briar", "Stone", "Wells", "Hearth", "North", "Crowe", "Reed", "Hale"];
    const makeName = () => `${nameFirst[ctx.rng.int(0, nameFirst.length - 1)]} ${nameLast[ctx.rng.int(0, nameLast.length - 1)]}`;

    const eligible = settlements.filter((s) => {
      const pop = s.cohorts.children + s.cohorts.adults + s.cohorts.elders;
      return s.housingCapacity > 0 && pop < 0.5 * s.housingCapacity;
    });

    for (const dest of eligible) {
      const pop = dest.cohorts.children + dest.cohorts.adults + dest.cohorts.elders;
      const slackRatio = clamp((0.5 * dest.housingCapacity - pop) / Math.max(1, 0.5 * dest.housingCapacity), 0, 1);
      const chance = clamp(0.08 * lowWorldPopMult * (0.5 + slackRatio * 0.5), 0, 0.35);
      if (!ctx.rng.chance(chance)) continue;

      const count = ctx.rng.int(1, 3);
      const createdIds: string[] = [];

      for (let i = 0; i < count; i++) {
        const pick = ctx.rng.next();
        const category = pick < 0.5 ? "Farmer" : pick < 0.75 ? "Fisher" : "Craftsperson";

        const id = makeId("npc", nextWorld.tick, ctx.nextEventSeq());
        const traits = defaultTraits(ctx.rng);
        traits.Fear = clamp(70 + ctx.rng.int(0, 20), 0, 100);
        traits.Suspicion = clamp(traits.Suspicion + 15, 0, 100);

        const npc: any = {
          id,
          name: makeName(),
          category,
          siteId: dest.id,
          homeSiteId: dest.id,
          awayFromHomeSinceTick: undefined,
          familyIds: [],
          activeStates: [],
          goals: [],
          intents: [],
          proficiency: {},
          recentActions: [],
          consecutiveHungerHours: 0,
          stateTriggerMemory: {},
          alive: true,
          cult: { member: false, role: "none" },
          trauma: clamp(10 + ctx.rng.int(0, 15), 0, 100),
          emotions: emptyEmotions(),
          hp: 100,
          maxHp: 100,
          traits,
          values: [],
          needs: emptyNeeds(),
          notability: 10,
          lastAttemptTick: -999,
          forcedActiveUntilTick: 0,
          busyUntilTick: 0,
          pendingAttempt: undefined,
          beliefs: [],
          relationships: {}
        };

        // Reduced trust: seed low-trust relationships to locals at the destination.
        const locals = Object.values(nextWorld.npcs).filter((n) => n.alive && n.siteId === dest.id);
        for (const other of locals) {
          const base = baselineRelationship(npc, other as any, nextWorld);
          npc.relationships[other.id] = {
            trust: clamp(base.trust - 15, 0, 100),
            fear: clamp(base.fear + 10, 0, 100),
            loyalty: clamp(base.loyalty - 5, 0, 100)
          };
        }

        nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [id]: npc } };
        createdIds.push(id);
      }

      if (createdIds.length) {
        keyChanges.push(`${dest.name} received ${createdIds.length} named refugees`);
        events.push({
          id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
          tick: nextWorld.tick,
          kind: "world.refugees.arrived",
          visibility: "system",
          siteId: dest.id,
          message: `${createdIds.length} named refugees arrived at ${dest.name}`,
          data: { namedNpcs: createdIds, chance, worldPop: totalWorldPop }
        });
      }
    }
  }

  // Cohort sickness + births + elder deaths (explainable).
  for (const siteId of settlementIds) {
    const site = nextWorld.sites[siteId];
    if (!isSettlement(site)) continue;

    const pop = site.cohorts.children + site.cohorts.adults + site.cohorts.elders;
    if (pop <= 0) continue;

    const totals = totalFood(site.food);
    const total = totals.grain + totals.fish + totals.meat;
    const perCapitaStored = total / pop;

    // Sickness drivers: hunger (experienced deficit) + overcrowding.
    const overcrowd = Math.max(0, pop - site.housingCapacity);
    const crowdStress = clamp(overcrowd / Math.max(1, site.housingCapacity), 0, 1);

    const hungerMeter = clamp(site.hunger ?? 0, 0, 100);
    const hungerMeterStress = clamp(hungerMeter / 100, 0, 1);

    // Reserve levels (perCapitaStored) should not directly cause sickness while people are eating.
    // Use it only as a *weak* predictor of future risk.
    const reserveStress = clamp(0.6 - perCapitaStored / 3, 0, 0.6); // 0..0.6

    let sicknessDelta = Math.round(hungerMeterStress * 7 + crowdStress * 3 + reserveStress * 2);
    if (hungerMeterStress < 0.05 && crowdStress < 0.05) sicknessDelta -= 2; // recover when fed and not crowded
    sicknessDelta += ctx.rng.int(-1, 1);

    const nextSickness = clamp(site.sickness + sicknessDelta, 0, 100);

    // Starvation deaths (all cohorts): driven by the hunger meter (unmet consumption over time).
    // This is what makes "people died" show up even when there's no combat.
    let deathsStarvationChildren = 0;
    let deathsStarvationAdults = 0;
    let deathsStarvationElders = 0;
    if (hungerMeter >= 70) {
      // 0..~0.8% per day at extreme hunger
      const rate = clamp((hungerMeter - 70) / 30, 0, 1) * 0.008;
      const rollDeaths = (count: number, mult: number) => {
        const expected = count * rate * mult;
        let d = Math.floor(expected);
        if (ctx.rng.next() < expected - d) d++;
        return Math.min(d, count);
      };
      deathsStarvationChildren = rollDeaths(site.cohorts.children, 1.1);
      deathsStarvationAdults = rollDeaths(site.cohorts.adults, 1.0);
      deathsStarvationElders = rollDeaths(site.cohorts.elders, 1.4);
    }

    // Elder deaths: base + sickness multiplier, explained as illness/old age.
    const elder = site.cohorts.elders;
    const baseDeathRate = 0.0009; // per elder per day
    const sicknessMult = 1 + nextSickness / 80; // up to ~2.25x
    const expectedDeaths = elder * baseDeathRate * sicknessMult;
    let deaths = Math.floor(expectedDeaths);
    const frac = expectedDeaths - deaths;
    if (ctx.rng.next() < frac) deaths++;
    deaths = Math.min(deaths, elder);

    // Births: slow, limited by housing slack and stability.
    const adult = site.cohorts.adults;
    const housingSlack = Math.max(0, site.housingCapacity - pop);
    const stability = clamp((100 - site.unrest) / 100, 0, 1);
    const birthRate = 0.00035; // per adult per day
    const expectedBirths = adult * birthRate * stability * clamp(housingSlack / Math.max(1, site.housingCapacity), 0, 1);
    let births = Math.floor(expectedBirths);
    if (ctx.rng.next() < expectedBirths - births) births++;

    const nextCohorts = {
      ...site.cohorts,
      children: site.cohorts.children + births - deathsStarvationChildren,
      adults: site.cohorts.adults - deathsStarvationAdults,
      elders: site.cohorts.elders - deaths - deathsStarvationElders
    };

    const updated: SettlementSiteState = {
      ...site,
      sickness: nextSickness,
      cohorts: nextCohorts,
      deathsToday: {
        ...site.deathsToday,
        illness: (site.deathsToday.illness ?? 0) + deaths,
        starvation:
          (site.deathsToday.starvation ?? 0) +
          deathsStarvationChildren +
          deathsStarvationAdults +
          deathsStarvationElders
      }
    };

    if (deaths > 0) keyChanges.push(`${site.name} lost ${deaths} elders (illness/old age)`);
    const deathsStarvTotal = deathsStarvationChildren + deathsStarvationAdults + deathsStarvationElders;
    if (deathsStarvTotal > 0) keyChanges.push(`${site.name} lost ${deathsStarvTotal} to starvation`);
    if (births > 0) keyChanges.push(`${site.name} had ${births} births`);

    nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [siteId]: updated } };

    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind: "world.population.changed",
      visibility: "system",
      siteId,
      message: `Population updated at ${site.name} (day ${day})`,
      data: {
        births,
        deathsOldAge: deaths,
        deathsStarvation: {
          children: deathsStarvationChildren,
          adults: deathsStarvationAdults,
          elders: deathsStarvationElders
        },
        sickness: nextSickness,
        hunger: hungerMeter,
        overcrowd
      }
    });
  }

  // Daily migration between settlements (cohort-level).
  // People flee hunger/unrest and move toward safety/food/housing.
  {
    const settlements2 = settlementIds.map((id) => nextWorld.sites[id]).filter(isSettlement);
    const byId: Record<string, SettlementSiteState> = Object.fromEntries(settlements2.map((s) => [s.id, s]));

    type Move = { from: string; to: string; adults: number; children: number };
    const moves: Move[] = [];

    const attractiveness = (s: SettlementSiteState) => {
      const pop = s.cohorts.children + s.cohorts.adults + s.cohorts.elders;
      const totals = totalFood(s.food);
      const stored = totals.grain + totals.fish + totals.meat;
      const perCapitaStored = pop > 0 ? stored / pop : 0;
      const housingSlack = Math.max(0, s.housingCapacity - pop);
      return (
        clamp(perCapitaStored * 25, 0, 80) +
        clamp(housingSlack * 0.5, 0, 40) +
        (100 - s.unrest) * 0.4 +
        (100 - s.sickness) * 0.2
      );
    };

    const pickDest = (fromId: string) => {
      const from = byId[fromId];
      const candidates = settlements2.filter((s) => s.id !== fromId && s.culture === from.culture);
      const pool = candidates.length ? candidates : settlements2.filter((s) => s.id !== fromId);
      const scored = pool.map((s) => ({ id: s.id, score: attractiveness(s) + ctx.rng.next() * 0.01 }));
      scored.sort((a, b) => b.score - a.score);
      return scored[0]?.id;
    };

    for (const s of settlements2) {
      const pop = s.cohorts.children + s.cohorts.adults + s.cohorts.elders;
      if (pop <= 0) continue;
      const hunger = clamp(s.hunger ?? 0, 0, 100);
      const fleePressure = clamp(hunger / 100, 0, 1) * 0.8 + clamp(s.unrest / 100, 0, 1) * 0.4;
      const rate = clamp(fleePressure, 0, 1) * 0.02; // up to 2% per day
      const expected = pop * rate;
      let migrants = Math.floor(expected);
      if (ctx.rng.next() < expected - migrants) migrants++;
      if (migrants <= 0) continue;

      const to = pickDest(s.id);
      if (!to) continue;

      const adultsMove = Math.min(s.cohorts.adults, Math.round(migrants * 0.75));
      const childrenMove = Math.min(s.cohorts.children, migrants - adultsMove);
      if (adultsMove + childrenMove <= 0) continue;

      moves.push({ from: s.id, to, adults: adultsMove, children: childrenMove });
    }

    if (moves.length) {
      for (const m of moves) {
        const from = byId[m.from];
        const to = byId[m.to];
        byId[m.from] = {
          ...from,
          cohorts: {
            ...from.cohorts,
            adults: from.cohorts.adults - m.adults,
            children: from.cohorts.children - m.children
          }
        };
        byId[m.to] = {
          ...to,
          cohorts: {
            ...to.cohorts,
            adults: to.cohorts.adults + m.adults,
            children: to.cohorts.children + m.children
          }
        };

        keyChanges.push(`${from.name} -> ${to.name} migrated (${m.adults + m.children})`);
        events.push({
          id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
          tick: nextWorld.tick,
          kind: "world.migration",
          visibility: "system",
          siteId: m.from,
          message: `Migration from ${from.name} to ${to.name}`,
          data: { from: m.from, to: m.to, adults: m.adults, children: m.children }
        });
      }

      nextWorld = {
        ...nextWorld,
        sites: { ...nextWorld.sites, ...Object.fromEntries(Object.entries(byId)) }
      };
    }
  }

  return { world: nextWorld, events, keyChanges };
}


