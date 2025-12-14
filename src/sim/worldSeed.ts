import { Rng } from "./rng";
import { defaultTraits, emptyNeeds } from "./npcs";
import type { FoodStock, NpcCategory, NpcId, NpcState, SiteId, SiteState, WorldMap, WorldState } from "./types";

function emptyFood(): FoodStock {
  return { grain: [], fish: [], meat: [] };
}

function settlement(id: SiteId, name: string, culture: "human" | "elven", init: Partial<SiteState> = {}): SiteState {
  return {
    id,
    kind: "settlement",
    name,
    culture,
    eclipsingPressure: 0,
    anchoringStrength: 0,
    cohorts: { children: 0, adults: 0, elders: 0 },
    housingCapacity: 0,
    sickness: 5,
    hunger: 0,
    unrest: 10,
    morale: 60,
    cultInfluence: 0,
    food: emptyFood(),
    productionPerDay: { grain: 0, fish: 0, meat: 0 },
    fieldsCondition: 1,
    rumors: [],
    deathsToday: {},
    ...(init as any)
  } as any;
}

function terrain(id: SiteId, name: string): SiteState {
  return { id, kind: "terrain", name, culture: "neutral", eclipsingPressure: 0, anchoringStrength: 0 };
}

function special(id: SiteId, name: string): SiteState {
  return { id, kind: "special", name, culture: "neutral", eclipsingPressure: 0, anchoringStrength: 0 };
}

function hideout(id: SiteId, name: string): SiteState {
  return { id, kind: "hideout", name, culture: "neutral", eclipsingPressure: 0, anchoringStrength: 0, hidden: true };
}

/**
 * Create the initial world slice as specified in docs/spec.md (Phases 1.1–1.3).
 *
 * Tick cadence: 1 tick = 1 hour.
 * Map: hand-authored graph with km edges.
 */
export function createWorld(seed: number): WorldState {
  const rng = new Rng(seed >>> 0);

  const siteIds: SiteId[] = [
    "ElvenCity",
    "ElvenTownFortified",
    "HumanCityPort",
    "HumanVillageA",
    "HumanVillageB",
    "AncientRuin",
    "CultHideout1",
    "DeepForest",
    "RiverLake",
    "OpenPlains",
    "MountainPass",
    "CoastSea"
  ];

  const map: WorldMap = {
    sites: siteIds,
    edges: [
      { from: "ElvenCity", to: "ElvenTownFortified", km: 12 },
      { from: "ElvenTownFortified", to: "DeepForest", km: 10 },
      { from: "DeepForest", to: "AncientRuin", km: 18 },
      { from: "DeepForest", to: "HumanVillageA", km: 9 },
      { from: "HumanVillageA", to: "HumanCityPort", km: 16 },
      { from: "HumanVillageB", to: "OpenPlains", km: 6 },
      { from: "OpenPlains", to: "HumanCityPort", km: 14 },
      { from: "OpenPlains", to: "RiverLake", km: 8 },
      { from: "RiverLake", to: "HumanVillageB", km: 10 },
      { from: "HumanCityPort", to: "CoastSea", km: 1 },
      { from: "OpenPlains", to: "MountainPass", km: 22 },
      { from: "MountainPass", to: "CultHideout1", km: 6 },
      { from: "CultHideout1", to: "DeepForest", km: 14 }
    ]
  };

  const sites: Record<SiteId, SiteState> = {
    ElvenCity: settlement("ElvenCity", "Leth Sylvarin", "elven", {
      cohorts: { children: 20, adults: 110, elders: 20 },
      housingCapacity: 170,
      unrest: 6,
      morale: 75,
      cultInfluence: 0,
      // Baseline production must be sustainable even with zero agent work.
      productionPerDay: { grain: 95, fish: 35, meat: 55 },
      fieldsCondition: 1
    }),
    ElvenTownFortified: settlement("ElvenTownFortified", "Kethren Hold", "elven", {
      cohorts: { children: 10, adults: 40, elders: 10 },
      housingCapacity: 70,
      unrest: 8,
      morale: 70,
      cultInfluence: 0,
      productionPerDay: { grain: 40, fish: 8, meat: 24 },
      fieldsCondition: 1
    }),
    HumanCityPort: settlement("HumanCityPort", "Harbor of Evershore", "human", {
      cohorts: { children: 40, adults: 220, elders: 40 },
      housingCapacity: 340,
      unrest: 18,
      morale: 58,
      cultInfluence: 5,
      // Port city benefits from fishing and imports (modeled as production for now).
      productionPerDay: { grain: 230, fish: 160, meat: 50 },
      fieldsCondition: 0.95
    }),
    HumanVillageA: settlement("HumanVillageA", "Ashford Hamlet", "human", {
      cohorts: { children: 8, adults: 30, elders: 6 },
      housingCapacity: 52,
      unrest: 14,
      morale: 60,
      cultInfluence: 8,
      productionPerDay: { grain: 38, fish: 0, meat: 12 },
      fieldsCondition: 0.9
    }),
    HumanVillageB: settlement("HumanVillageB", "Lakeside Croft", "human", {
      cohorts: { children: 7, adults: 26, elders: 5 },
      housingCapacity: 45,
      unrest: 12,
      morale: 62,
      cultInfluence: 6,
      productionPerDay: { grain: 22, fish: 26, meat: 8 },
      fieldsCondition: 0.92
    }),
    AncientRuin: special("AncientRuin", "The Ruin of the Fracture"),
    CultHideout1: hideout("CultHideout1", "Hidden Concord Cell"),
    DeepForest: terrain("DeepForest", "Deepwood Expanse"),
    RiverLake: terrain("RiverLake", "Riverlake"),
    OpenPlains: terrain("OpenPlains", "Sunlit Plains"),
    MountainPass: terrain("MountainPass", "Greyspine Pass"),
    CoastSea: terrain("CoastSea", "Evershore Coast")
  };

  // Add starting food stockpiles (5–7 days of buffer) so the world doesn't begin in an empty pantry.
  const addStartingFood = (siteId: SiteId, daysOfFood: number, mix: { grain: number; fish: number; meat: number }) => {
    const s = sites[siteId] as any;
    if (!s || s.kind !== "settlement") return;
    const pop = s.cohorts.children + s.cohorts.adults + s.cohorts.elders;
    const total = Math.round(pop * daysOfFood);
    const grain = Math.round(total * mix.grain);
    const fish = Math.round(total * mix.fish);
    const meat = Math.max(0, total - grain - fish);
    s.food.grain.push({ amount: grain, producedDay: 0 });
    if (fish > 0) s.food.fish.push({ amount: fish, producedDay: 0 });
    if (meat > 0) s.food.meat.push({ amount: meat, producedDay: 0 });
  };

  addStartingFood("HumanCityPort", 7, { grain: 0.55, fish: 0.3, meat: 0.15 });
  addStartingFood("HumanVillageA", 6, { grain: 0.75, fish: 0.0, meat: 0.25 });
  addStartingFood("HumanVillageB", 6, { grain: 0.45, fish: 0.4, meat: 0.15 });
  addStartingFood("ElvenCity", 6, { grain: 0.45, fish: 0.2, meat: 0.35 });
  addStartingFood("ElvenTownFortified", 6, { grain: 0.5, fish: 0.1, meat: 0.4 });

  // Phase 4 named NPC generation (deterministic from seed).
  const npcs: Record<NpcId, NpcState> = {};
  let seq = 0;
  const nextNpcId = () => `npc:${++seq}`;

  const humanFirst = ["Alden", "Mara", "Jon", "Tessa", "Bran", "Lysa", "Edrin", "Sera", "Dane", "Rook", "Fenn", "Kara"];
  const humanLast = ["Ashford", "Evershore", "Briar", "Stone", "Wells", "Hearth", "North", "Crowe", "Reed", "Hale"];
  const elfA = ["Leth", "Syl", "Vael", "Ari", "Kael", "Thal", "Eli", "Myrr", "Sael", "Iri"];
  const elfB = ["varin", "thir", "lorn", "sara", "deth", "mire", "wen", "dor", "reth", "syl"];

  const makeHumanName = () => `${humanFirst[rng.int(0, humanFirst.length - 1)]} ${humanLast[rng.int(0, humanLast.length - 1)]}`;
  const makeElfName = () => `${elfA[rng.int(0, elfA.length - 1)]}${elfB[rng.int(0, elfB.length - 1)]}`;

  const addNpc = (siteId: SiteId, category: NpcCategory, name: string, traitBias: Partial<Record<any, number>> = {}, notability = 10) => {
    const id = nextNpcId();
    const isConcord = category === "ConcordDevotee" || category === "ConcordCellLeaderRitualist" || category === "ConcordEnforcer";
    npcs[id] = {
      id,
      name,
      category,
      siteId,
      alive: true,
      cult: {
        member: isConcord,
        role: category === "ConcordCellLeaderRitualist" ? "cell_leader" : category === "ConcordEnforcer" ? "enforcer" : category === "ConcordDevotee" ? "devotee" : "none",
        joinedTick: isConcord ? 0 : undefined
      },
      trauma: 0,
      traits: defaultTraits(rng, traitBias),
      values: [],
      needs: emptyNeeds(),
      notability,
      lastAttemptTick: -999,
      forcedActiveUntilTick: 0,
      beliefs: [],
      relationships: {}
    };
  };

  const fill = (siteId: SiteId, count: number, plan: { category: NpcCategory; n: number; bias?: any; notability?: number }[], nameFn: () => string) => {
    let remaining = count;
    for (const p of plan) {
      for (let i = 0; i < p.n && remaining > 0; i++) {
        addNpc(siteId, p.category, nameFn(), p.bias ?? {}, p.notability ?? 10);
        remaining--;
      }
    }
    // Fill remainder with generic citizens.
    const defaultCat: NpcCategory = sites[siteId].culture === "elven" ? "ElvenCitizen" : "Farmer";
    while (remaining-- > 0) addNpc(siteId, defaultCat, nameFn());
  };

  // Villages (~30 each)
  fill(
    "HumanVillageA",
    30,
    [
      { category: "LocalLeader", n: 1, bias: { Integrity: 70, Discipline: 65 }, notability: 55 },
      { category: "GuardMilitia", n: 4, bias: { Discipline: 60, Courage: 60 }, notability: 35 },
      { category: "HealerHedgeMage", n: 1, bias: { Empathy: 70, Integrity: 65 }, notability: 45 },
      { category: "Farmer", n: 10 },
      { category: "HunterTrapper", n: 4, bias: { Courage: 60 } },
      { category: "MerchantSmuggler", n: 2, bias: { Greed: 60 } },
      { category: "ConcordDevotee", n: 3, bias: { NeedForCertainty: 75 } }
    ],
    makeHumanName
  );

  fill(
    "HumanVillageB",
    30,
    [
      { category: "LocalLeader", n: 1, bias: { Integrity: 65, Discipline: 60 }, notability: 55 },
      { category: "GuardMilitia", n: 3, bias: { Discipline: 60, Courage: 55 }, notability: 35 },
      { category: "HealerHedgeMage", n: 1, bias: { Empathy: 70 }, notability: 40 },
      { category: "Fisher", n: 6 },
      { category: "Farmer", n: 7 },
      { category: "HunterTrapper", n: 3 },
      { category: "MerchantSmuggler", n: 2, bias: { Greed: 60 } },
      { category: "ConcordDevotee", n: 3, bias: { NeedForCertainty: 72 } }
    ],
    makeHumanName
  );

  // Human port city (~100)
  fill(
    "HumanCityPort",
    100,
    [
      { category: "LocalLeader", n: 2, bias: { Ambition: 65, Integrity: 55 }, notability: 65 },
      { category: "GuardMilitia", n: 12, bias: { Discipline: 60 }, notability: 30 },
      { category: "ScoutRanger", n: 4, bias: { Courage: 60 }, notability: 35 },
      { category: "HealerHedgeMage", n: 3, bias: { Empathy: 65 }, notability: 40 },
      { category: "Craftsperson", n: 10 },
      { category: "MerchantSmuggler", n: 12, bias: { Greed: 65 } },
      { category: "Fisher", n: 10 },
      { category: "Farmer", n: 12 },
      { category: "ConcordDevotee", n: 8, bias: { NeedForCertainty: 75 }, notability: 20 },
      { category: "ConcordCellLeaderRitualist", n: 1, bias: { NeedForCertainty: 85, Discipline: 70 }, notability: 75 },
      { category: "ConcordEnforcer", n: 2, bias: { Aggression: 70 }, notability: 45 },
      { category: "BanditRaider", n: 3, bias: { Greed: 70, Integrity: 20 }, notability: 25 }
    ],
    makeHumanName
  );

  // Elven town (~60)
  fill(
    "ElvenTownFortified",
    60,
    [
      { category: "ElvenLeader", n: 1, bias: { Discipline: 75, Integrity: 75 }, notability: 75 },
      { category: "ElvenWarriorSentinel", n: 12, bias: { Discipline: 70, Courage: 70 }, notability: 35 },
      { category: "Threadwarden", n: 4, bias: { Curiosity: 70, Discipline: 70 }, notability: 55 },
      { category: "AnchorMage", n: 3, bias: { Discipline: 75, Curiosity: 65 }, notability: 55 },
      { category: "ContinuumScholar", n: 4, bias: { Curiosity: 75 }, notability: 50 },
      { category: "SilentExile", n: 2, bias: { Fear: 65, Suspicion: 65 }, notability: 45 }
    ],
    makeElfName
  );

  // Elven city (~150)
  fill(
    "ElvenCity",
    150,
    [
      { category: "ElvenLeader", n: 2, bias: { Discipline: 80, Integrity: 80 }, notability: 80 },
      { category: "ElvenWarriorSentinel", n: 25, bias: { Discipline: 70, Courage: 70 }, notability: 35 },
      { category: "Threadwarden", n: 10, bias: { Curiosity: 75, Discipline: 75 }, notability: 60 },
      { category: "AnchorMage", n: 8, bias: { Discipline: 80, Curiosity: 70 }, notability: 60 },
      { category: "ContinuumScholar", n: 12, bias: { Curiosity: 80 }, notability: 55 },
      { category: "SilentExile", n: 4, bias: { Fear: 60, Suspicion: 70 }, notability: 50 }
    ],
    makeElfName
  );

  // Bandits and tainted near wilderness/hideout to seed trouble.
  for (let i = 0; i < 6; i++) addNpc("MountainPass", "BanditRaider", makeHumanName(), { Greed: 75, Integrity: 25 }, 25);
  for (let i = 0; i < 6; i++) addNpc("CultHideout1", "TaintedThrall", makeHumanName(), { Integrity: 5, Discipline: 30 }, 30);

  return {
    seed,
    tick: 0,
    map,
    sites,
    npcs
  };
}


