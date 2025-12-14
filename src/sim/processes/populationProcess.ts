import { REFUGEE_DAILY_BASE_MAX, REFUGEE_DAILY_BASE_MIN } from "../constants";
import { makeId } from "../ids";
import { totalFood } from "../food";
import { clamp } from "../util";
import type { SettlementSiteState, SimEvent, WorldState } from "../types";
import { tickToDay, tickToHourOfDay } from "../types";
import type { ProcessContext, ProcessResult } from "./types";

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

  // Cohort sickness + births + elder deaths (explainable).
  for (const siteId of settlementIds) {
    const site = nextWorld.sites[siteId];
    if (!isSettlement(site)) continue;

    const pop = site.cohorts.children + site.cohorts.adults + site.cohorts.elders;
    if (pop <= 0) continue;

    const totals = totalFood(site.food);
    const total = totals.grain + totals.fish + totals.meat;
    const perCapitaStored = total / pop;

    // Sickness drivers: hunger + overcrowding.
    const overcrowd = Math.max(0, pop - site.housingCapacity);
    const hungerStress = clamp(1 - perCapitaStored / 2, 0, 1); // stressed if <2 units stored per person
    const crowdStress = clamp(overcrowd / Math.max(1, site.housingCapacity), 0, 1);

    let sicknessDelta = Math.round(hungerStress * 6 + crowdStress * 3);
    if (hungerStress < 0.1 && crowdStress < 0.05) sicknessDelta -= 2; // recover when stable
    sicknessDelta += ctx.rng.int(-1, 1);

    const nextSickness = clamp(site.sickness + sicknessDelta, 0, 100);

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
      children: site.cohorts.children + births,
      elders: site.cohorts.elders - deaths
    };

    const updated: SettlementSiteState = {
      ...site,
      sickness: nextSickness,
      cohorts: nextCohorts
    };

    if (deaths > 0) keyChanges.push(`${site.name} lost ${deaths} elders (illness/old age)`);
    if (births > 0) keyChanges.push(`${site.name} had ${births} births`);

    nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [siteId]: updated } };

    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind: "world.population.changed",
      visibility: "system",
      siteId,
      message: `Population updated at ${site.name} (day ${day})`,
      data: { births, deathsOldAge: deaths, sickness: nextSickness, overcrowd }
    });
  }

  return { world: nextWorld, events, keyChanges };
}


