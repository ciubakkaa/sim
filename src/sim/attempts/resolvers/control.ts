import type { Attempt, FoodType, NpcState, SettlementSiteState, WorldState } from "../../types";
import { clamp } from "../../util";
import type { ResolveCtx, ResolveResult } from "./helpers";
import { makeHelpers } from "./helpers";
import { isSettlement } from "../rumors";
import { markBusy } from "../../busy";
import { totalFood, addFoodLot } from "../../food";
import { tickToDay } from "../../types";
import { getConfig } from "../../config";
import { addCoins, addFood, takeFood } from "../../systems/inventory";

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function pickMostAbundantFoodType(site: SettlementSiteState): FoodType {
  const totals = totalFood(site.food);
  const types: FoodType[] = ["grain", "fish", "meat"];
  types.sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0) || a.localeCompare(b));
  return types[0]!;
}

function marketBuyPricePerUnit(site: SettlementSiteState): number {
  const cfg = getConfig();
  const base = cfg.tuning.baseFoodPrice ?? 5;
  const range = cfg.tuning.priceFluctuationRange ?? 0.5;
  const hunger = clamp(site.hunger ?? 0, 0, 100);

  // Hunger multiplier: 0.5x..1.5x by default (range=0.5).
  const hungerMult = 1 + range * ((hunger - 50) / 50);

  // Supply multiplier: lower stored food => pricier.
  const totals = totalFood(site.food);
  const stored = (totals.grain ?? 0) + (totals.fish ?? 0) + (totals.meat ?? 0);
  const pop = (site.cohorts?.children ?? 0) + (site.cohorts?.adults ?? 0) + (site.cohorts?.elders ?? 0);
  const dailyNeed = Math.max(1, pop);
  const daysStored = stored / dailyNeed; // rough
  const supplyMult = clamp(1.4 - Math.min(1.2, daysStored / 6), 0.7, 1.4); // 0.7..1.4

  return clampInt(base * hungerMult * supplyMult, 1, 500);
}

function getTarget(world: WorldState, attempt: Attempt): NpcState | undefined {
  if (!attempt.targetId) return undefined;
  return world.npcs[attempt.targetId];
}

export function resolveTrade(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const actor = h.world.npcs[attempt.actorId];
  if (!actor || !actor.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  // Local market buy/sell loop.
  // If a `targetId` is present, treat it as an inter-settlement trade contract and run the
  // Task 19 trade flow (below) instead of local market logic.
  if (!attempt.targetId) {
    const inv = actor.inventory ?? { coins: 0, food: {} };
    const foodNeed = Number((actor.needs as any)?.Food ?? 0);
    const wealthNeed = Number((actor.needs as any)?.Wealth ?? 0);

    const type = pickMostAbundantFoodType(site);
    const priceBuy = marketBuyPricePerUnit(site);
    const priceSell = Math.max(1, Math.floor(priceBuy * 0.8));

    const available = site.food[type].reduce((a, l) => a + l.amount, 0);
    const personal = inv.food?.[type] ?? 0;
    const personalFoodTotal = (inv.food?.grain ?? 0) + (inv.food?.fish ?? 0) + (inv.food?.meat ?? 0);

    // Simple decision: buy when hungry; sell when poor and has food.
    const wantBuy = inv.coins >= priceBuy && available > 0 && (personalFoodTotal < 3 || foodNeed >= 55);
    const wantSell = !wantBuy && personal > 0 && (wealthNeed >= 55 || inv.coins < priceBuy);

    let action: "buy" | "sell" | "none" = "none";
    let qty = 0;
    let totalPrice = 0;

    if (wantBuy) {
      action = "buy";
      const desired = clampInt(Math.ceil(foodNeed / 10) * 2, 1, 18);
      const affordable = clampInt(inv.coins / priceBuy, 0, 9999);
      qty = Math.min(desired, affordable, available);
      totalPrice = qty * priceBuy;
      if (qty > 0) {
        h.apply({ kind: "site.food.take", siteId: site.id, foodType: type, amount: qty, takeFrom: "newest" });
        const withFood = addFood(h.world.npcs[actor.id]!, type, qty);
        const withCoins = addCoins(withFood, -totalPrice);
        h.apply({ kind: "npc.patch", npcId: actor.id, patch: { inventory: withCoins.inventory } as any });
      }
    } else if (wantSell) {
      action = "sell";
      qty = Math.min(personal, clampInt(Math.ceil(wealthNeed / 10) * 2, 1, 12));
      totalPrice = qty * priceSell;
      if (qty > 0) {
        const taken = takeFood(h.world.npcs[actor.id]!, type, qty);
        const paid = addCoins(taken.npc, totalPrice);
        h.apply({ kind: "npc.patch", npcId: actor.id, patch: { inventory: paid.inventory } as any });
        const day = tickToDay(h.world.tick);
        const updatedSite = addFoodLot(site, type, qty, day);
        h.apply({ kind: "site.patch", siteId: site.id, patch: { food: updatedSite.food } as any });
      }
    }

    h.apply({
      kind: "npc.patch",
      npcId: actor.id,
      patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "trade") }
    });

    h.emit(`${actor.name} traded at the market`, {
      market: { action, type, qty, priceBuy, priceSell, totalPrice, available, hunger: site.hunger ?? 0 }
    });
    if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} traded at the market`, 45);
    return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  }

  // Task 19: basic inter-settlement food trade (surplus -> deficit).
  const settlements = h.world.map.sites.map((id) => h.world.sites[id]).filter(isSettlement);
  const day = tickToDay(h.world.tick);

  const popTotal = (s: SettlementSiteState) => s.cohorts.children + s.cohorts.adults + s.cohorts.elders;
  const dailyNeed = (s: SettlementSiteState) => popTotal(s) * 1; // FOOD_PER_CAPITA_PER_DAY=1
  const daysStored = (s: SettlementSiteState) => {
    const need = Math.max(1, dailyNeed(s));
    const totals = totalFood(s.food);
    const stored = totals.grain + totals.fish + totals.meat;
    return stored / need;
  };

  const scored = settlements
    .map((s) => ({ s, days: daysStored(s) }))
    .sort((a, b) => b.days - a.days || a.s.id.localeCompare(b.s.id));
  const exporters = scored.filter((x) => x.days > 7);
  const importers = scored.slice().sort((a, b) => a.days - b.days || a.s.id.localeCompare(b.s.id)).filter((x) => x.days < 3);

  const exporter = exporters[0]?.s;
  const importer = importers[0]?.s;

  const disrupted =
    Boolean(exporter && Object.values(h.world.npcs).some((n) => n.alive && n.siteId === exporter.id && n.category === "BanditRaider")) ||
    Boolean(importer && Object.values(h.world.npcs).some((n) => n.alive && n.siteId === importer.id && n.category === "BanditRaider"));

  const successChance = clamp(80 - (disrupted ? 20 : 0), 0, 100);
  const roll = ctx.rng.int(0, 99);
  const success = roll < successChance;

  let transfer: { from: string; to: string; type: FoodType; amount: number; delivered: number; loss: number } | undefined;
  if (success && exporter && importer && exporter.id !== importer.id) {
    const expTotals = totalFood(exporter.food);
    const expStored = expTotals.grain + expTotals.fish + expTotals.meat;
    const impTotals = totalFood(importer.food);
    const impStored = impTotals.grain + impTotals.fish + impTotals.meat;

    const expSurplus = Math.max(0, Math.floor(expStored - 7 * dailyNeed(exporter)));
    const impDeficit = Math.max(0, Math.ceil(3 * dailyNeed(importer) - impStored));
    const amount = clamp(Math.min(expSurplus, impDeficit, 60), 0, 60);

    if (amount > 0) {
      const types: FoodType[] = ["grain", "fish", "meat"];
      types.sort((a, b) => (expTotals[b] ?? 0) - (expTotals[a] ?? 0) || a.localeCompare(b));
      const type = types[0]!;

      const delivered = Math.max(0, Math.floor(amount * 0.9)); // Task 19: 10% loss
      const loss = amount - delivered;

      h.apply({ kind: "site.food.take", siteId: exporter.id, foodType: type, amount, takeFrom: "newest" });

      const impNext = addFoodLot(importer, type, delivered, day);
      h.apply({ kind: "site.patch", siteId: importer.id, patch: { food: impNext.food } as any });

      transfer = { from: exporter.id, to: importer.id, type, amount, delivered, loss };
    }
  }

  const deltaMorale = ctx.rng.int(0, 2);
  const deltaUnrest = ctx.rng.int(0, 1) ? -1 : 0;
  h.apply({
    kind: "site.patch",
    siteId: site.id,
    patch: {
      morale: clamp(site.morale + deltaMorale, 0, 100),
      unrest: clamp(site.unrest + deltaUnrest, 0, 100)
    } as Partial<SettlementSiteState>
  });
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "trade") }
  });

  // Small commission into personal inventory.
  if (success && transfer?.amount) {
    const commission = Math.max(1, Math.floor(transfer.amount / 10));
    const updated = addCoins(h.world.npcs[actor.id]!, commission);
    h.apply({ kind: "npc.patch", npcId: actor.id, patch: { inventory: updated.inventory } as any });
  }

  h.emit(`${actor.name} traded in ${site.name}`, { deltaMorale, deltaUnrest, success, roll, successChance, disrupted, transfer });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} traded`, 50);

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveArrest(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const site = h.world.sites[attempt.siteId];
  if (!isSettlement(site)) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const actor = h.world.npcs[attempt.actorId];
  const target = getTarget(h.world, attempt);
  if (!actor || !actor.alive || !target || !target.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (actor.siteId !== attempt.siteId || target.siteId !== attempt.siteId) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (target.status?.detained) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const score = actor.traits.Discipline * 0.6 + actor.traits.Suspicion * 0.4;
  const resist = target.traits.Courage * 0.5 + target.traits.Aggression * 0.25 + target.traits.Fear * 0.25;
  const chance = clamp(score - resist + 55, 10, 90);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  const detentionHours = success ? ctx.rng.int(24, 48) : 0;
  const nextTrauma = success ? clamp(target.trauma + 6, 0, 100) : clamp(target.trauma + 2, 0, 100);
  const detained = success
    ? { byNpcId: actor.id, atSiteId: attempt.siteId, startedTick: h.world.tick, untilTick: h.world.tick + detentionHours }
    : undefined;

  const unrestDelta = success ? 1 : 2;
  h.apply({
    kind: "site.patch",
    siteId: site.id,
    patch: { unrest: clamp(site.unrest + unrestDelta, 0, 100) } as Partial<SettlementSiteState>
  });
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "arrest") }
  });
  h.apply({
    kind: "npc.patch",
    npcId: target.id,
    patch: {
      trauma: nextTrauma,
      forcedActiveUntilTick: success ? h.world.tick + 24 : target.forcedActiveUntilTick,
      status: { ...(target.status ?? {}), detained } as any
    } as Partial<NpcState>
  });

  h.emit(`${actor.name} attempted an arrest`, { success, roll, chance, detentionHours, targetId: target.id });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} arrested ${target.name}`, success ? 75 : 40);

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}

export function resolveKidnap(world: WorldState, attempt: Attempt, ctx: ResolveCtx): ResolveResult {
  const h = makeHelpers(world, attempt, ctx);
  const actor = h.world.npcs[attempt.actorId];
  const target = getTarget(h.world, attempt);
  if (!actor || !actor.alive || !target || !target.alive) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (actor.siteId !== attempt.siteId || target.siteId !== attempt.siteId) return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  if (target.status?.detained) return { world: h.world, events: h.events, keyChanges: h.keyChanges };

  const score = actor.traits.Aggression * 0.45 + actor.traits.Discipline * 0.35 + (100 - actor.traits.Empathy) * 0.2;
  const resist = target.traits.Courage * 0.55 + target.traits.Discipline * 0.25 + target.traits.Suspicion * 0.2;
  // Task 12: raise baseline kidnap success chance (15% -> 25% equivalent bump).
  const baseChance = clamp(score - resist + 55, 5, 85);

  // Task 18: coordination bonus for kidnapping (multiple cult members present).
  const cultHere = Object.values(h.world.npcs).filter((n) => n.alive && n.siteId === attempt.siteId && n.cult.member);
  const extraCult = Math.max(0, cultHere.length - 1); // exclude actor
  const coordBonus = Math.min(30, extraCult * 10);
  const chance = clamp(baseChance + coordBonus, 5, 95);
  const roll = ctx.rng.int(0, 99);
  const success = roll < chance;

  if (!success) {
    const bumpedSite = h.world.sites[attempt.siteId];
    if (isSettlement(bumpedSite)) {
      h.apply({
        kind: "site.patch",
        siteId: bumpedSite.id,
        patch: { unrest: clamp(bumpedSite.unrest + 2, 0, 100) } as Partial<SettlementSiteState>
      });
    }
    h.apply({
      kind: "npc.patch",
      npcId: actor.id,
      patch: {
        lastAttemptTick: attempt.tick,
        trauma: clamp(actor.trauma + 2, 0, 100),
        ...markBusy(actor, h.world.tick, attempt.durationHours, "kidnap")
      }
    });
    h.apply({
      kind: "npc.patch",
      npcId: target.id,
      patch: { trauma: clamp(target.trauma + 4, 0, 100), forcedActiveUntilTick: h.world.tick + 24 }
    });
    h.emit(`${actor.name} attempted a kidnapping`, { success: false, roll, chance, baseChance, coordBonus, extraCult, targetId: target.id });
    if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} attempted to kidnap ${target.name}`, 70);
    return { world: h.world, events: h.events, keyChanges: h.keyChanges };
  }

  const detentionHours = ctx.rng.int(24, 72);

  const bumpedSite = h.world.sites[attempt.siteId];
  if (isSettlement(bumpedSite)) {
    h.apply({
      kind: "site.patch",
      siteId: bumpedSite.id,
      patch: { unrest: clamp(bumpedSite.unrest + 4, 0, 100) } as Partial<SettlementSiteState>
    });
  }
  h.apply({
    kind: "npc.patch",
    npcId: actor.id,
    patch: { lastAttemptTick: attempt.tick, ...markBusy(actor, h.world.tick, attempt.durationHours, "kidnap") }
  });
  h.apply({
    kind: "npc.patch",
    npcId: target.id,
    patch: {
      status: {
        ...(target.status ?? {}),
        detained: { byNpcId: actor.id, atSiteId: attempt.siteId, startedTick: h.world.tick, untilTick: h.world.tick + detentionHours }
      } as any,
      trauma: clamp(target.trauma + 18, 0, 100),
      forcedActiveUntilTick: h.world.tick + 48
    } as Partial<NpcState>
  });

  h.emit(`${actor.name} kidnapped ${target.name}`, { success: true, roll, chance, baseChance, coordBonus, extraCult, detentionHours, targetId: target.id });
  if (attempt.visibility === "public") h.addPublicRumor(`${actor.name} kidnapped ${target.name}`, 85);

  return { world: h.world, events: h.events, keyChanges: h.keyChanges };
}


