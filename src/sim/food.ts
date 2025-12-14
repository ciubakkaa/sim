import { FOOD_EXPIRY_DAYS, FOOD_PER_CAPITA_PER_DAY } from "./constants";
import type { FoodLot, FoodStock, FoodType, SettlementSiteState } from "./types";

export function totalFood(stock: FoodStock): Record<FoodType, number> {
  return {
    grain: sumLots(stock.grain),
    fish: sumLots(stock.fish),
    meat: sumLots(stock.meat)
  };
}

export function sumLots(lots: FoodLot[]): number {
  let s = 0;
  for (const l of lots) s += l.amount;
  return s;
}

export function addFoodLot(site: SettlementSiteState, type: FoodType, amount: number, producedDay: number): SettlementSiteState {
  if (amount <= 0) return site;
  const lots = site.food[type];
  const nextLots = [...lots, { amount, producedDay }];
  return { ...site, food: { ...site.food, [type]: nextLots } };
}

export function spoilFoodLots(site: SettlementSiteState, day: number): { site: SettlementSiteState; spoiled: Partial<Record<FoodType, number>> } {
  let next = site;
  const spoiled: Partial<Record<FoodType, number>> = {};

  for (const type of Object.keys(FOOD_EXPIRY_DAYS) as FoodType[]) {
    const expiry = FOOD_EXPIRY_DAYS[type];
    const lots = next.food[type];
    let kept: FoodLot[] = [];
    let spoiledAmt = 0;
    for (const lot of lots) {
      if (day - lot.producedDay > expiry) spoiledAmt += lot.amount;
      else kept.push(lot);
    }
    if (spoiledAmt > 0) {
      spoiled[type] = spoiledAmt;
      next = { ...next, food: { ...next.food, [type]: kept } };
    }
  }

  return { site: next, spoiled };
}

/**
 * Consume food FIFO, prioritizing perishable types first.
 * Returns updated site + unmet need amount.
 */
export function consumeFoodHourly(
  site: SettlementSiteState,
  popTotal: number
): { site: SettlementSiteState; unmet: number; consumed: Partial<Record<FoodType, number>> } {
  const need = (popTotal * FOOD_PER_CAPITA_PER_DAY) / 24;
  let remaining = need;

  let next = site;
  const consumed: Partial<Record<FoodType, number>> = {};

  const consumeFrom = (type: FoodType) => {
    if (remaining <= 0) return;
    const lots = next.food[type];
    if (!lots.length) return;

    const newLots: FoodLot[] = [];
    let took = 0;
    for (const lot of lots) {
      if (remaining <= 0) {
        newLots.push(lot);
        continue;
      }
      if (lot.amount <= remaining) {
        remaining -= lot.amount;
        took += lot.amount;
      } else {
        const left = lot.amount - remaining;
        took += remaining;
        remaining = 0;
        newLots.push({ ...lot, amount: left });
      }
    }

    if (took > 0) {
      consumed[type] = (consumed[type] ?? 0) + took;
      next = { ...next, food: { ...next.food, [type]: newLots } };
    }
  };

  // Most perishable first to reduce spoilage waste.
  consumeFrom("fish");
  consumeFrom("meat");
  consumeFrom("grain");

  return { site: next, unmet: Math.max(0, remaining), consumed };
}


