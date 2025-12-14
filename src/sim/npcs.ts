import { HOURS_PER_DAY } from "./constants";
import { getNeighbors } from "./map";
import { clamp } from "./util";
import type {
  NeedKey,
  NpcCategory,
  NpcId,
  NpcState,
  SettlementSiteState,
  SiteId,
  TraitKey,
  WorldState
} from "./types";
import { tickToDay, tickToHourOfDay } from "./types";
import type { Rng } from "./rng";

export type ActiveSelection = {
  activeNpcIds: Set<NpcId>;
};

export function defaultTraits(rng: Rng, bias: Partial<Record<TraitKey, number>> = {}): Record<TraitKey, number> {
  const base = () => clamp(45 + rng.int(-20, 20), 0, 100);
  const traits: Record<TraitKey, number> = {
    Fear: base(),
    Ambition: base(),
    Loyalty: base(),
    Greed: base(),
    Empathy: base(),
    Aggression: base(),
    Discipline: base(),
    Curiosity: base(),
    Suspicion: base(),
    NeedForCertainty: base(),
    Courage: base(),
    Integrity: base()
  };
  for (const k of Object.keys(bias) as TraitKey[]) {
    traits[k] = clamp(bias[k] ?? traits[k], 0, 100);
  }
  return traits;
}

export function emptyNeeds(): Record<NeedKey, number> {
  return {
    Food: 0,
    Safety: 0,
    Health: 0,
    Shelter: 0,
    Belonging: 0,
    Status: 0,
    Wealth: 0,
    Freedom: 0,
    Meaning: 0,
    Duty: 0
  };
}

function isSettlement(site: unknown): site is SettlementSiteState {
  return Boolean(site && (site as SettlementSiteState).kind === "settlement");
}

export function computeNpcNeeds(npc: NpcState, world: WorldState): Record<NeedKey, number> {
  if (!npc.alive) return emptyNeeds();
  const site = world.sites[npc.siteId];
  const needs = emptyNeeds();

  if (isSettlement(site)) {
    const pop = site.cohorts.children + site.cohorts.adults + site.cohorts.elders;
    const foodTotal =
      site.food.grain.reduce((a, l) => a + l.amount, 0) +
      site.food.fish.reduce((a, l) => a + l.amount, 0) +
      site.food.meat.reduce((a, l) => a + l.amount, 0);
    const foodPerCapitaStored = pop > 0 ? foodTotal / pop : 0;

    needs.Food = clamp(Math.round((2 - foodPerCapitaStored) * 35), 0, 100);
    needs.Health = clamp(Math.round(site.sickness), 0, 100);
    needs.Safety = clamp(Math.round(site.unrest * 0.7 + site.eclipsingPressure * 0.35), 0, 100);
    needs.Shelter = clamp(Math.round(Math.max(0, pop - site.housingCapacity) * 4), 0, 100);

    // Meaning: cult influence pulls more if NeedForCertainty is high and anchoring is low.
    const certainty = npc.traits.NeedForCertainty / 100;
    const anchorBlock = 1 - site.anchoringStrength / 100;
    needs.Meaning = clamp(Math.round(site.cultInfluence * certainty * (0.6 + anchorBlock * 0.4)), 0, 100);
  } else {
    // In wilderness nodes: safety tends to be higher, shelter lower.
    needs.Safety = 45;
    needs.Shelter = 60;
  }

  // Role-driven duty
  needs.Duty = clamp(dutyBaseline(npc.category), 0, 100);

  // Trait modulation
  needs.Safety = clamp(needs.Safety + (npc.traits.Fear - 50) * 0.15, 0, 100);
  needs.Food = clamp(needs.Food + (npc.traits.Discipline < 40 ? 5 : 0), 0, 100);
  needs.Meaning = clamp(needs.Meaning + npc.trauma * 0.4, 0, 100);

  return needs;
}

function dutyBaseline(cat: NpcCategory): number {
  switch (cat) {
    case "GuardMilitia":
    case "LocalLeader":
    case "ScoutRanger":
    case "Threadwarden":
    case "AnchorMage":
    case "ContinuumScholar":
    case "ElvenLeader":
    case "ElvenWarriorSentinel":
      return 55;
    case "ConcordCellLeaderRitualist":
    case "ConcordEnforcer":
      return 50;
    default:
      return 10;
  }
}

function isDaytime(hour: number): boolean {
  return hour >= 6 && hour < 20;
}

function rolePrefersNight(cat: NpcCategory): boolean {
  return cat === "BanditRaider" || cat === "MerchantSmuggler" || cat === "ConcordEnforcer";
}

export function selectActiveNpcs(world: WorldState, rng: Rng): ActiveSelection {
  const hour = tickToHourOfDay(world.tick);
  const day = tickToDay(world.tick);
  void day; // reserved for future schedule expansions

  const active = new Set<NpcId>();

  const bySite: Record<SiteId, NpcState[]> = {};
  for (const n of Object.values(world.npcs)) {
    if (!n.alive) continue;
    (bySite[n.siteId] ??= []).push(n);
  }

  const activeBudgetForSite = (siteId: SiteId): number => {
    if (siteId === "HumanVillageA" || siteId === "HumanVillageB") return 30;
    if (siteId === "HumanCityPort") return 40;
    if (siteId === "ElvenCity") return 60;
    if (siteId === "ElvenTownFortified") return 30;
    return 10;
  };

  for (const [siteId, npcs] of Object.entries(bySite)) {
    const budget = Math.min(activeBudgetForSite(siteId), npcs.length);

    const scored = npcs.map((npc) => {
      const needs = npc.needs;
      const survivalUrgency = Math.max(needs.Food, needs.Safety, needs.Health);
      const scheduleOk = rolePrefersNight(npc.category) ? !isDaytime(hour) : isDaytime(hour);
      const scheduleScore = scheduleOk ? 10 : 0;
      const forced = npc.forcedActiveUntilTick > world.tick ? 1000 : 0;
      const notability = npc.notability / 10;
      const urgency = survivalUrgency / 5;
      const tie = rng.next() * 0.01; // deterministic tie-breaker
      return { npc, score: forced + scheduleScore + notability + urgency + tie };
    });

    scored.sort((a, b) => b.score - a.score || a.npc.id.localeCompare(b.npc.id));
    for (const x of scored.slice(0, budget)) active.add(x.npc.id);
  }

  return { activeNpcIds: active };
}

export function pickTravelDestination(world: WorldState, from: SiteId, rng: Rng): SiteId | undefined {
  const neighbors = getNeighbors(world.map, from);
  if (!neighbors.length) return undefined;

  // Prefer lower unrest/pressure in settlements; otherwise random.
  const scored = neighbors.map((n) => {
    const s = world.sites[n.to];
    let danger = s.eclipsingPressure;
    if ((s as any).kind === "settlement") danger += (s as SettlementSiteState).unrest;
    const score = (200 - danger) + (rng.next() * 0.01);
    return { to: n.to, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.to;
}


