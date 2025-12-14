/**
 * Core simulation types.
 *
 * NOTE: This codebase is intentionally simulation-first and engine-agnostic.
 * The simulation produces state + events; rendering / input adapters live elsewhere.
 *
 * Tick cadence: 1 tick = 1 hour.
 */

export type SimTick = number; // 1 tick = 1 hour

export type EntityId = string;
export type NpcId = EntityId;
export type SiteId = string;

export type HourOfDay = number; // 0..23

export type FoodType = "grain" | "fish" | "meat";

export type FoodLot = {
  amount: number;
  producedDay: number;
};

export type FoodStock = Record<FoodType, FoodLot[]>;

export type Culture = "human" | "elven" | "neutral";

export type Cohorts = {
  children: number;
  adults: number;
  elders: number;
};

export type SiteKind = "settlement" | "terrain" | "special" | "hideout";

export type BaseSiteState = {
  id: SiteId;
  kind: SiteKind;
  name: string;
  culture: Culture;

  // Fields 0..100
  eclipsingPressure: number;
  anchoringStrength: number;
};

export type SettlementSiteState = BaseSiteState & {
  kind: "settlement";

  cohorts: Cohorts;
  housingCapacity: number;

  // 0..100
  sickness: number;
  unrest: number;
  morale: number;

  // 0..100, devotion/recruitment (not Eclipsing)
  cultInfluence: number;

  // Food lots and production baselines
  food: FoodStock;
  productionPerDay: Record<FoodType, number>;

  // 0..1
  fieldsCondition: number;

  // Rumor buffer (bounded). Used for “heard-about” relationship updates.
  rumors: SiteRumor[];
};

export type TerrainSiteState = BaseSiteState & {
  kind: "terrain";
};

export type SpecialSiteState = BaseSiteState & {
  kind: "special";
};

export type HideoutSiteState = BaseSiteState & {
  kind: "hideout";
  hidden: boolean;
};

export type SiteState =
  | SettlementSiteState
  | TerrainSiteState
  | SpecialSiteState
  | HideoutSiteState;

export type MapEdge = {
  from: SiteId;
  to: SiteId;
  km: number;
};

export type WorldMap = {
  sites: SiteId[];
  edges: MapEdge[];
};

export type WorldState = {
  seed: number;
  tick: SimTick;

  map: WorldMap;
  sites: Record<SiteId, SiteState>;

  // Named NPCs (Phase 4). Cohorts still represent background population.
  npcs: Record<NpcId, NpcState>;
};

export type AttemptKind =
  | "travel"
  | "work_farm"
  | "work_fish"
  | "work_hunt"
  | "trade"
  | "steal"
  | "assault"
  | "kill"
  | "raid"
  | "arrest"
  | "investigate"
  | "heal"
  | "preach_fixed_path"
  | "kidnap"
  | "forced_eclipse"
  | "anchor_sever";

export type AttemptVisibility = "private" | "public";

export type AttemptMagnitude = "minor" | "normal" | "major";

export type Attempt = {
  id: string;
  tick: SimTick;
  kind: AttemptKind;
  visibility: AttemptVisibility;
  actorId: NpcId;
  targetId?: NpcId;
  siteId: SiteId;
  durationHours: number;
  intentMagnitude: AttemptMagnitude;
  resources?: Record<string, unknown>;
};

export type EventKind =
  | "sim.started"
  | "sim.day.ended"
  | "world.food.produced"
  | "world.food.consumed"
  | "world.food.spoiled"
  | "world.population.changed"
  | "world.refugees.arrived"
  | "world.unrest.drifted"
  | "world.morale.drifted"
  | "world.eclipsing.pressure"
  | "world.anchoring.strength"
  | "world.cult.influence"
  | "world.incident"
  | "attempt.recorded";

export type SimEvent = {
  id: string;
  tick: SimTick;
  kind: EventKind;
  visibility: AttemptVisibility | "system";
  siteId?: SiteId;
  message: string;
  data?: Record<string, unknown>;
};

export type DailySiteSummary = {
  siteId: SiteId;
  name: string;
  culture: Culture;
  cohorts?: Cohorts;
  housingCapacity?: number;
  foodTotals?: Record<FoodType, number>;
  spoiledTotals?: Partial<Record<FoodType, number>>;
  unrest?: number;
  morale?: number;
  sickness?: number;
  cultInfluence?: number;
  eclipsingPressure: number;
  anchoringStrength: number;
  keyChanges: string[];
};

export type DailySummary = {
  tick: SimTick;
  day: number;
  hourOfDay: HourOfDay;
  keyChanges: string[];
  sites: DailySiteSummary[];
};

export type TickResult = {
  world: WorldState;
  events: SimEvent[];
  dailySummary?: DailySummary; // only emitted at end-of-day
};

export type TraitKey =
  | "Fear"
  | "Ambition"
  | "Loyalty"
  | "Greed"
  | "Empathy"
  | "Aggression"
  | "Discipline"
  | "Curiosity"
  | "Suspicion"
  | "NeedForCertainty"
  | "Courage"
  | "Integrity";

export type NeedKey =
  | "Food"
  | "Safety"
  | "Health"
  | "Shelter"
  | "Belonging"
  | "Status"
  | "Wealth"
  | "Freedom"
  | "Meaning"
  | "Duty";

export type ValueTag =
  | "Survival"
  | "Family"
  | "Freedom"
  | "Order"
  | "Faith"
  | "Honor"
  | "Power"
  | "TruthContinuity"
  | "Community";

export type NpcCategory =
  | "Farmer"
  | "Fisher"
  | "HunterTrapper"
  | "Craftsperson"
  | "MerchantSmuggler"
  | "HealerHedgeMage"
  | "GuardMilitia"
  | "LocalLeader"
  | "ScoutRanger"
  | "BanditRaider"
  | "ConcordDevotee"
  | "ConcordCellLeaderRitualist"
  | "ConcordEnforcer"
  | "TaintedThrall"
  | "ElvenCitizen"
  | "ElvenWarriorSentinel"
  | "Threadwarden"
  | "AnchorMage"
  | "ContinuumScholar"
  | "ElvenLeader"
  | "SilentExile";

export type Relationship = {
  trust: number; // 0..100
  fear: number; // 0..100
  loyalty: number; // 0..100
};

export type Belief = {
  subjectId: NpcId;
  predicate: string;
  object: string;
  confidence: number; // 0..100
  source: "witnessed" | "rumor" | "report";
  tick: SimTick;
};

export type SiteRumor = {
  tick: SimTick;
  kind: AttemptKind | "incident";
  actorId?: NpcId;
  targetId?: NpcId;
  siteId: SiteId;
  confidence: number; // 0..100
  label: string;
};

export type NpcState = {
  id: NpcId;
  name: string;
  category: NpcCategory;
  siteId: SiteId;

  alive: boolean;
  death?: {
    tick: SimTick;
    cause: "murder" | "starvation" | "illness" | "raid" | "unknown";
    byNpcId?: NpcId;
    atSiteId?: SiteId;
  };

  // Cult state (Phase 4/early Phase 5)
  cult: {
    member: boolean;
    role: "none" | "devotee" | "cell_leader" | "enforcer";
    joinedTick?: SimTick;
  };

  // Short/medium-term trauma pressure that influences recruitment susceptibility (0..100).
  trauma: number;

  traits: Record<TraitKey, number>;
  values: ValueTag[];
  needs: Record<NeedKey, number>;

  // 0..100
  notability: number;

  // scheduling / throttling
  lastAttemptTick: SimTick;
  forcedActiveUntilTick: SimTick;

  // knowledge + relationships
  beliefs: Belief[]; // bounded
  relationships: Record<NpcId, Relationship>; // materialized on first interaction or heard-about update
};

export function tickToDay(tick: SimTick): number {
  return Math.floor(tick / 24);
}

export function tickToHourOfDay(tick: SimTick): HourOfDay {
  const h = tick % 24;
  return (h < 0 ? h + 24 : h) as HourOfDay;
}


