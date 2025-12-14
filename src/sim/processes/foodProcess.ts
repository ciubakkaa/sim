import { HOURS_PER_DAY } from "../constants";
import { makeId } from "../ids";
import { addFoodLot, consumeFoodHourly, spoilFoodLots, totalFood } from "../food";
import { clamp } from "../util";
import type { FoodType, SettlementSiteState, SimEvent, WorldState } from "../types";
import { tickToDay } from "../types";
import type { ProcessContext, ProcessResult } from "./types";

function isSettlement(site: unknown): site is SettlementSiteState {
  return Boolean(site && (site as SettlementSiteState).kind === "settlement");
}

export function applyFoodProcessHourly(world: WorldState, ctx: ProcessContext): ProcessResult {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  const day = tickToDay(world.tick);
  const hourOfDay = world.tick % HOURS_PER_DAY;

  let nextWorld = world;

  for (const siteId of world.map.sites) {
    const site = nextWorld.sites[siteId];
    if (!isSettlement(site)) continue;

    // Hourly consumption.
    {
      const popTotal = site.cohorts.children + site.cohorts.adults + site.cohorts.elders;
      const res = consumeFoodHourly(site, popTotal);
      const nextSite = res.site;
      const unmet = res.unmet;

      if (unmet > 0) {
        keyChanges.push(`${nextSite.name} has unmet food need (+${unmet.toFixed(2)}/h)`);
      }

      const consumedTotals = res.consumed;
      events.push({
        id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
        tick: nextWorld.tick,
        kind: "world.food.consumed",
        visibility: "system",
        siteId,
        message: `Food consumed at ${nextSite.name}`,
        data: { consumed: consumedTotals, unmet }
      });

      nextWorld = {
        ...nextWorld,
        sites: { ...nextWorld.sites, [siteId]: nextSite }
      };
    }

    // Daily production at dawn (hour 6).
    if (hourOfDay === 6) {
      const s = nextWorld.sites[siteId] as SettlementSiteState;
      let produced: Partial<Record<FoodType, number>> = {};
      let updated = s;

      const prodGrain = Math.max(0, Math.round(s.productionPerDay.grain * s.fieldsCondition));
      const prodFish = Math.max(0, Math.round(s.productionPerDay.fish));
      const prodMeat = Math.max(0, Math.round(s.productionPerDay.meat));

      if (prodGrain > 0) {
        updated = addFoodLot(updated, "grain", prodGrain, day);
        produced.grain = prodGrain;
      }
      if (prodFish > 0) {
        updated = addFoodLot(updated, "fish", prodFish, day);
        produced.fish = prodFish;
      }
      if (prodMeat > 0) {
        updated = addFoodLot(updated, "meat", prodMeat, day);
        produced.meat = prodMeat;
      }

      if (prodGrain + prodFish + prodMeat > 0) {
        keyChanges.push(`${updated.name} produced food (day ${day})`);
      }

      events.push({
        id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
        tick: nextWorld.tick,
        kind: "world.food.produced",
        visibility: "system",
        siteId,
        message: `Food produced at ${updated.name}`,
        data: { produced, fieldsCondition: updated.fieldsCondition }
      });

      nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [siteId]: updated } };
    }

    // Daily spoilage check at hour 0.
    if (hourOfDay === 0) {
      const s = nextWorld.sites[siteId] as SettlementSiteState;
      const { site: updated, spoiled } = spoilFoodLots(s, day);
      const totalSpoiled = Object.values(spoiled).reduce((a, b) => a + (b ?? 0), 0);
      if (totalSpoiled > 0) {
        keyChanges.push(`${updated.name} food spoiled (${totalSpoiled})`);
      }

      events.push({
        id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
        tick: nextWorld.tick,
        kind: "world.food.spoiled",
        visibility: "system",
        siteId,
        message: totalSpoiled ? `Food spoiled at ${updated.name}` : `No spoilage at ${updated.name}`,
        data: { spoiled }
      });

      nextWorld = { ...nextWorld, sites: { ...nextWorld.sites, [siteId]: updated } };
    }

    // Keep fieldsCondition clamped (it can be modified by incidents later).
    {
      const s = nextWorld.sites[siteId] as SettlementSiteState;
      if (s.fieldsCondition < 0 || s.fieldsCondition > 1) {
        const clamped = clamp(s.fieldsCondition, 0, 1);
        nextWorld = {
          ...nextWorld,
          sites: { ...nextWorld.sites, [siteId]: { ...s, fieldsCondition: clamped } }
        };
      }
    }

    // (Debug helper) ensure food totals are never negative.
    {
      const s = nextWorld.sites[siteId] as SettlementSiteState;
      const totals = totalFood(s.food);
      if (totals.grain < 0 || totals.fish < 0 || totals.meat < 0) {
        throw new Error(`Negative food totals at site ${siteId}`);
      }
    }
  }

  return { world: nextWorld, events, keyChanges };
}


