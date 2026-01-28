/**
 * Kernel v0 Vertical Slice Scenario
 * 
 * A minimal scenario for validating the kernel architecture:
 * - 1 region, 3 towns connected in a triangle
 * - 50 named agents distributed (guards, farmers, merchants, etc.)
 * - 2 factions (guards, bandits) with influence per town
 * - NO Concord/cult mechanics
 * 
 * This scenario is designed to test core kernel systems:
 * - Economy (food, unrest)
 * - Social (gossip, relationships)
 * - Crime (steal -> observe -> chase -> arrest)
 * - Rumors (propagation)
 * - Factions (influence drift)
 * - Population (pools + promotion)
 */

import { Rng } from "../rng";
import { defaultTraits, emptyNeeds } from "../npcs";
import type {
  FoodStock,
  NpcCategory,
  NpcId,
  NpcState,
  SettlementSiteState,
  SiteId,
  SiteState,
  WorldMap,
  WorldState,
} from "../types";
import { generateSettlementInterior } from "../settlements/generateInterior";
import { emptyEmotions } from "../systems/emotions";

// ----- Helper Functions -----

function emptyFood(): FoodStock {
  return { grain: [], fish: [], meat: [] };
}

function settlement(
  id: SiteId,
  name: string,
  culture: "human" | "elven",
  init: Partial<SettlementSiteState> = {}
): SettlementSiteState {
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
    cultInfluence: 0, // Always 0 for vertical slice (no cult)
    food: emptyFood(),
    productionPerDay: { grain: 0, fish: 0, meat: 0 },
    fieldsCondition: 1,
    laborWorkedToday: { grain: 0, fish: 0, meat: 0 },
    rumors: [],
    deathsToday: {},
    ...init,
  };
}

function isSettlementSite(s: SiteState): s is SettlementSiteState {
  return s.kind === "settlement";
}

// Simple FNV-1a hash for site IDs
function fnvSite(siteId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < siteId.length; i++) {
    h ^= siteId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ----- Faction Influence -----

/**
 * Per-site faction influence tracking.
 * Guards represent law/order, bandits represent chaos/crime.
 */
export interface FactionInfluence {
  guards: number;   // 0-100: Guard presence and control
  bandits: number;  // 0-100: Bandit activity and territorial control
}

/**
 * Extended site state with faction influence (stored in site.meta or a separate registry).
 */
// ----- Name Generators -----

const HUMAN_FIRST_NAMES = [
  "Aldric", "Brigid", "Cedric", "Dara", "Edmund", "Fiona",
  "Gareth", "Helena", "Ivan", "Jana", "Kira", "Leif",
  "Mira", "Nolan", "Orla", "Petrov", "Quinn", "Rowan",
  "Silas", "Thea", "Ulric", "Vera", "Wynn", "Xander", "Yara", "Zara"
];

const HUMAN_LAST_NAMES = [
  "Ashbrook", "Blackwood", "Copperfield", "Dawnwood", "Eastwell",
  "Fairfield", "Greenhill", "Harlow", "Ironside", "Jasper",
  "Kingsley", "Lakewood", "Millbrook", "Northgate", "Oakhart",
  "Preston", "Quicksilver", "Riverstone", "Stonebridge", "Thornwood"
];

function makeHumanName(rng: Rng): string {
  const first = HUMAN_FIRST_NAMES[rng.int(0, HUMAN_FIRST_NAMES.length - 1)];
  const last = HUMAN_LAST_NAMES[rng.int(0, HUMAN_LAST_NAMES.length - 1)];
  return `${first} ${last}`;
}

// ----- Town Configuration -----

interface TownConfig {
  id: SiteId;
  name: string;
  population: { children: number; adults: number; elders: number };
  housingCapacity: number;
  production: { grain: number; fish: number; meat: number };
  unrest: number;
  morale: number;
  factionInfluence: FactionInfluence;
  npcDistribution: Array<{
    category: NpcCategory;
    count: number;
    traitBias?: Partial<Record<string, number>>;
    notability?: number;
  }>;
}

// Three towns with distinct characteristics
const TOWN_CONFIGS: TownConfig[] = [
  {
    id: "TownMarket" as SiteId,
    name: "Crossroads Market",
    population: { children: 15, adults: 80, elders: 15 },
    housingCapacity: 130,
    production: { grain: 70, fish: 20, meat: 30 },
    unrest: 15,
    morale: 60,
    factionInfluence: { guards: 65, bandits: 20 },
    npcDistribution: [
      // Leaders & Guards - strong guard presence
      { category: "LocalLeader", count: 1, traitBias: { Integrity: 70, Discipline: 65 }, notability: 60 },
      { category: "GuardMilitia", count: 4, traitBias: { Discipline: 60, Courage: 60 }, notability: 35 },
      // Economy
      { category: "MerchantSmuggler", count: 3, traitBias: { Greed: 65 }, notability: 30 },
      { category: "Craftsperson", count: 3, notability: 20 },
      // Food producers
      { category: "Farmer", count: 3 },
      { category: "Fisher", count: 2 },
      { category: "HunterTrapper", count: 2, traitBias: { Courage: 55 } },
      // Other
      { category: "HealerHedgeMage", count: 1, traitBias: { Empathy: 70 }, notability: 40 },
    ],
  },
  {
    id: "TownFarm" as SiteId,
    name: "Ashford Fields",
    population: { children: 10, adults: 50, elders: 10 },
    housingCapacity: 80,
    production: { grain: 100, fish: 5, meat: 20 },
    unrest: 10,
    morale: 65,
    factionInfluence: { guards: 50, bandits: 15 },
    npcDistribution: [
      // Leaders & Guards - moderate guard presence
      { category: "LocalLeader", count: 1, traitBias: { Integrity: 65, Discipline: 60 }, notability: 55 },
      { category: "GuardMilitia", count: 3, traitBias: { Discipline: 55, Courage: 55 }, notability: 30 },
      // Economy - farming focused
      { category: "Farmer", count: 7 },
      { category: "HunterTrapper", count: 2, traitBias: { Courage: 55 } },
      { category: "MerchantSmuggler", count: 1, traitBias: { Greed: 55 } },
      // Other
      { category: "HealerHedgeMage", count: 1, traitBias: { Empathy: 65 }, notability: 35 },
    ],
  },
  {
    id: "TownHarbor" as SiteId,
    name: "Raven's Harbor",
    population: { children: 12, adults: 60, elders: 8 },
    housingCapacity: 95,
    production: { grain: 40, fish: 80, meat: 15 },
    unrest: 25, // Higher unrest due to bandit activity
    morale: 50, // Lower morale
    factionInfluence: { guards: 40, bandits: 45 }, // Contested territory
    npcDistribution: [
      // Leaders & Guards - weaker guard presence
      { category: "LocalLeader", count: 1, traitBias: { Integrity: 55, Ambition: 65 }, notability: 55 },
      { category: "GuardMilitia", count: 2, traitBias: { Discipline: 50, Courage: 50 }, notability: 25 },
      // Economy - fishing and smuggling focused
      { category: "Fisher", count: 4 },
      { category: "MerchantSmuggler", count: 3, traitBias: { Greed: 70 }, notability: 25 },
      { category: "Farmer", count: 2 },
      // Bandits - strong presence
      { category: "BanditRaider", count: 3, traitBias: { Greed: 70, Integrity: 25, Aggression: 65 }, notability: 30 },
      // Other
      { category: "HealerHedgeMage", count: 1, traitBias: { Empathy: 60 }, notability: 35 },
    ],
  },
];

// ----- World Creation -----

/**
 * Create the vertical slice world with 3 towns, 50 agents, and 2 factions.
 * 
 * @param seed - Random seed for deterministic generation
 * @returns WorldState with the scenario setup
 */
export function createVerticalSliceWorld(seed: number): WorldState {
  const rng = new Rng(seed >>> 0);

  // Create site IDs for the triangle
  const siteIds: SiteId[] = ["TownMarket", "TownFarm", "TownHarbor"] as SiteId[];

  // Create triangle map - each town connects to the other two
  const map: WorldMap = {
    sites: siteIds,
    edges: [
      { from: "TownMarket", to: "TownFarm", km: 8, quality: "road" },
      { from: "TownFarm", to: "TownHarbor", km: 12, quality: "rough" },
      { from: "TownHarbor", to: "TownMarket", km: 10, quality: "road" },
    ],
  };

  // Create sites from configs
  const sites: Record<SiteId, SiteState> = {};
  for (const config of TOWN_CONFIGS) {
    sites[config.id] = settlement(config.id, config.name, "human", {
      cohorts: config.population,
      housingCapacity: config.housingCapacity,
      productionPerDay: config.production,
      unrest: config.unrest,
      morale: config.morale,
      // Store faction influence in a way that can be accessed later
      // Note: We use cultInfluence field temporarily for guards, and store bandits separately
      // In a full implementation, we'd extend SiteState properly
    });
  }

  // Add starting food stockpiles (5-7 days of buffer)
  const addStartingFood = (
    siteId: SiteId,
    daysOfFood: number,
    mix: { grain: number; fish: number; meat: number }
  ) => {
    const s = sites[siteId] as SettlementSiteState;
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

  addStartingFood("TownMarket" as SiteId, 6, { grain: 0.55, fish: 0.2, meat: 0.25 });
  addStartingFood("TownFarm" as SiteId, 7, { grain: 0.75, fish: 0.05, meat: 0.2 });
  addStartingFood("TownHarbor" as SiteId, 5, { grain: 0.35, fish: 0.5, meat: 0.15 });

  // Create NPCs
  const npcs: Record<NpcId, NpcState> = {};
  let seq = 0;
  const nextNpcId = () => `npc:vs:${++seq}`;

  const addNpc = (
    siteId: SiteId,
    category: NpcCategory,
    name: string,
    traitBias: Partial<Record<string, number>> = {},
    notability = 10
  ) => {
    const id = nextNpcId();
    
    // NO cult membership in vertical slice
    npcs[id] = {
      id,
      name,
      category,
      siteId,
      homeSiteId: siteId,
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
      cult: {
        member: false,
        role: "none",
        joinedTick: undefined,
      },
      trauma: 0,
      emotions: emptyEmotions(),
      hp: 100,
      maxHp: 100,
      traits: defaultTraits(rng, traitBias as Partial<Record<any, number>>),
      values: [],
      needs: emptyNeeds(),
      notability,
      lastAttemptTick: -999,
      forcedActiveUntilTick: 0,
      busyUntilTick: 0,
      pendingAttempt: undefined,
      beliefs: [],
      relationships: {},
    };
  };

  // Distribute NPCs across towns based on configs
  // Target: ~50 NPCs total
  for (const config of TOWN_CONFIGS) {
    for (const dist of config.npcDistribution) {
      for (let i = 0; i < dist.count; i++) {
        addNpc(
          config.id,
          dist.category,
          makeHumanName(rng),
          dist.traitBias ?? {},
          dist.notability ?? 10
        );
      }
    }
  }

  // Verify we have ~50 NPCs (allow small variance due to distribution)
  const npcCount = Object.keys(npcs).length;
  if (npcCount < 45 || npcCount > 55) {
    console.warn(`VerticalSlice: Expected ~50 NPCs, got ${npcCount}`);
  }

  // Assign 0-2 family members per NPC (deterministic)
  {
    const bySite: Record<SiteId, NpcId[]> = {};
    for (const n of Object.values(npcs)) {
      (bySite[n.siteId] ??= []).push(n.id);
    }

    for (const ids of Object.values(bySite)) {
      ids.sort();
    }

    const MAX_FAMILY = 2;
    for (const ids of Object.values(bySite)) {
      if (ids.length < 2) continue;

      for (const id of ids) {
        const npc = npcs[id]!;
        const desired = rng.int(0, MAX_FAMILY);
        const tries = 12;

        let t = 0;
        while (npc.familyIds.length < desired && t++ < tries) {
          const otherId = ids[rng.int(0, ids.length - 1)]!;
          if (otherId === id) continue;
          const other = npcs[otherId]!;
          if (npc.familyIds.includes(otherId)) continue;
          if (npc.familyIds.length >= MAX_FAMILY) break;
          if (other.familyIds.length >= MAX_FAMILY) continue;

          npc.familyIds.push(otherId);
          other.familyIds.push(id);
        }
      }
    }
  }

  // Generate settlement interiors and assign NPC homes
  {
    const bySite: Record<SiteId, NpcState[]> = {};
    for (const n of Object.values(npcs)) {
      (bySite[n.siteId] ??= []).push(n);
    }
    for (const ids of Object.values(bySite)) {
      ids.sort((a, b) => a.id.localeCompare(b.id));
    }

    for (const s of Object.values(sites)) {
      if (!isSettlementSite(s)) continue;
      const localRng = new Rng((seed ^ fnvSite(s.id)) >>> 0);
      const npcsHere = bySite[s.id] ?? [];
      const built = generateSettlementInterior(localRng, s, npcsHere);
      s.local = built.local;

      for (const n of npcsHere) {
        const homeLoc = built.npcHomeById[n.id] ?? `${s.id}:street:i0`;
        n.homeLocationId = homeLoc;
        n.local = { siteId: s.id, locationId: homeLoc };
        n.localTravel = undefined;
      }
    }
  }

  const world: WorldState = {
    seed,
    tick: 0,
    map,
    sites,
    npcs,
  };

  // Derived entity registry (v2 compatible)
  world.entities = world.npcs;

  return world;
}

// ----- Stats & Utilities -----

/**
 * Get statistics about the vertical slice world for testing/debugging.
 */
export function getVerticalSliceStats(world: WorldState): {
  totalNpcs: number;
  npcsBySite: Record<string, number>;
  npcsByCategory: Record<string, number>;
  guardCount: number;
  banditCount: number;
  merchantCount: number;
  farmerCount: number;
} {
  const npcs = Object.values(world.npcs);
  
  const npcsBySite: Record<string, number> = {};
  const npcsByCategory: Record<string, number> = {};
  
  let guardCount = 0;
  let banditCount = 0;
  let merchantCount = 0;
  let farmerCount = 0;
  
  for (const npc of npcs) {
    // By site
    npcsBySite[npc.siteId] = (npcsBySite[npc.siteId] ?? 0) + 1;
    
    // By category
    npcsByCategory[npc.category] = (npcsByCategory[npc.category] ?? 0) + 1;
    
    // Faction-relevant counts
    if (npc.category === "GuardMilitia") guardCount++;
    if (npc.category === "BanditRaider") banditCount++;
    if (npc.category === "MerchantSmuggler") merchantCount++;
    if (npc.category === "Farmer") farmerCount++;
  }
  
  return {
    totalNpcs: npcs.length,
    npcsBySite,
    npcsByCategory,
    guardCount,
    banditCount,
    merchantCount,
    farmerCount,
  };
}

/**
 * Get faction influence for a site.
 */
export function getFactionInfluence(siteId: SiteId): FactionInfluence | undefined {
  const config = TOWN_CONFIGS.find(c => c.id === siteId);
  return config?.factionInfluence;
}

/**
 * Get all faction influences.
 */
export function getAllFactionInfluences(): Record<SiteId, FactionInfluence> {
  const result: Record<SiteId, FactionInfluence> = {};
  for (const config of TOWN_CONFIGS) {
    result[config.id] = config.factionInfluence;
  }
  return result;
}

// ----- Exports -----

export default createVerticalSliceWorld;
