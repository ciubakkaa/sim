/**
 * Core simulation types.
 *
 * NOTE: This codebase is intentionally simulation-first and engine-agnostic.
 * The simulation produces state + events; rendering / input adapters live elsewhere.
 *
 * Tick cadence: 1 tick = 1 hour.
 */

import type { ActiveGoal } from "./goals/types";
import type { ActiveState } from "./states/types";
import type { ProficiencyDomain } from "./proficiency/types";

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

export type LocationId = string;

export type LocationKind =
  | "house"
  | "tavern"
  | "market"
  | "shrine"
  | "guardhouse"
  | "docks"
  | "fields"
  | "library"
  | "clinic"
  | "well"
  | "storage"
  | "gate"
  | "streets";

export type LocalPos = { x: number; y: number };

export type LocalNode = {
  id: LocationId;
  kind: LocationKind;
  name: string;
  pos: LocalPos;
  capacity?: number;
  meta?: Record<string, unknown>;
};

export type LocalEdge = {
  from: LocationId;
  to: LocationId;
  meters: number;
};

export type BuildingInventory = {
  food?: Partial<Record<FoodType, number>>;
  items?: Record<string, number>;
  books?: number;
};

export type BuildingState = {
  id: LocationId;
  inventory: BuildingInventory;
};

export type SettlementLocal = {
  nodes: LocalNode[];
  edges: LocalEdge[];
  buildings: Record<LocationId, BuildingState>;
};

export type Cohorts = {
  children: number;
  adults: number;
  elders: number;
};

export type DeathCause = "starvation" | "illness" | "murder" | "raid" | "unknown";

export type SiteKind = "settlement" | "terrain" | "special" | "hideout";

export type EmotionalState = {
  anger: number; // 0..100
  fear: number; // 0..100
  grief: number; // 0..100
  gratitude: number; // 0..100
  pride: number; // 0..100
  shame: number; // 0..100
  stress: number; // 0..100
};

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
  hunger: number; // 0..100, derived from unmet consumption over time
  unrest: number;
  morale: number;

  // 0..100, devotion/recruitment (not Eclipsing)
  cultInfluence: number;

  // Food lots and production baselines
  food: FoodStock;
  productionPerDay: Record<FoodType, number>;

  // 0..1
  fieldsCondition: number;

  // Task 10: simple daily labor tracking to connect NPC work to production.
  // Reset at the daily production boundary (hour 6).
  laborWorkedToday: Record<FoodType, number>;

  // Rumor buffer (bounded). Used for “heard-about” relationship updates.
  rumors: SiteRumor[];

  // Death counters for the last completed day (cohort-level, not named NPCs).
  deathsToday: Partial<Record<DeathCause, number>>;

  // Phase X: intra-settlement layout + building state (viewer + sim-affecting movement).
  local?: SettlementLocal;
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
  quality?: "road" | "rough";
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

  // v2: optional entity registry (derived view of named NPCs; opt-in).
  // This intentionally mirrors `npcs` for a gradual migration path.
  entities?: Record<EntityId, NpcState>;

  // v2: optional world-level secrets registry (opt-in).
  secrets?: Record<string, Secret>;

  // v2: optional faction operations registry (opt-in).
  operations?: Record<string, FactionOperation>;

  // v2: optional narrative chronicle (opt-in).
  chronicle?: ChronicleState;
};

// v2: Minimal faction operations (opt-in via useFactionOperations).
export type FactionId = "cult" | "guards" | "bandits";

export type OperationType = "kidnap" | "forced_eclipse" | "raid";

export type OperationStatus = "planning" | "active" | "completed" | "failed" | "aborted";

export type OperationPhase = {
  kind: AttemptKind;
  note?: string;
};

export type FactionOperation = {
  id: string;
  factionId: FactionId;
  type: OperationType;
  siteId: SiteId;
  targetNpcId?: NpcId;
  leaderNpcId: NpcId;
  participantNpcIds: NpcId[];
  participantRoles?: Partial<Record<NpcId, "leader" | "enforcer" | "scout" | "lookout">>;
  createdTick: SimTick;
  status: OperationStatus;
  // Lightweight scheduling:
  executeAfterTick?: SimTick;
  note?: string;

  // v2+: multi-phase execution (optional, defaults to single phase = `type`)
  phases?: OperationPhase[];
  phaseIndex?: number;
  lastProgressTick?: SimTick;
  failures?: number;
};

// v2: Minimal narrative/chronicle (opt-in via useNarrative).
export type ChronicleEntryKind = "death" | "murder" | "kidnap" | "raid" | "forced_eclipse" | "major_event";

export type ChronicleSignificance = "minor" | "notable" | "major";

export type ChronicleEntry = {
  id: string;
  tick: SimTick;
  kind: ChronicleEntryKind;
  significance: ChronicleSignificance;
  siteId?: SiteId;
  headline: string;
  description: string;
  primaryNpcId?: NpcId;
  otherNpcIds?: NpcId[];
  sourceEventId?: string;
};

export type StoryBeat = {
  id: string;
  tick: SimTick;
  kind: ChronicleEntryKind;
  siteId?: SiteId;
  primaryNpcId?: NpcId;
  description: string;
  sourceEventId?: string;
};

// v2+: minimal narrative arcs/acts (opt-in via useNarrative).
export type NarrativeArcKind = "operation";
export type NarrativeArcStatus = "developing" | "climax" | "resolution" | "concluded" | "abandoned";

export type NarrativeAct = {
  name: string;
  startedTick?: SimTick;
  endedTick?: SimTick;
};

export type NarrativeArc = {
  id: string;
  kind: NarrativeArcKind;
  title: string;
  status: NarrativeArcStatus;
  startTick: SimTick;
  endTick?: SimTick;
  siteId?: SiteId;
  factionId?: FactionId;
  operationId?: string;
  acts: NarrativeAct[];
  actIndex: number;
};

export type ChronicleState = {
  entries: ChronicleEntry[];
  beats: StoryBeat[];
  arcs?: NarrativeArc[];
};

export type TravelState = {
  kind: "travel";
  from: SiteId;
  to: SiteId;
  totalKm: number;
  remainingKm: number;
  edgeQuality: "road" | "rough";
  startedTick: SimTick;
  lastProgressTick: SimTick;
};

export type LocalTravelState = {
  kind: "localTravel";
  siteId: SiteId;
  fromLocationId: LocationId;
  toLocationId: LocationId;
  totalMeters: number;
  remainingMeters: number;
  startedTick: SimTick;
  lastProgressTick: SimTick;
  purposeKind?: AttemptKind;
};

export type AttemptKind =
  | "idle"
  | "travel"
  | "patrol"
  | "defend"
  | "intervene"
  | "recon"
  | "work_farm"
  | "work_fish"
  | "work_hunt"
  | "trade"
  | "gossip"
  | "steal"
  | "blackmail"
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

export type IntentKind =
  | "attack"
  | "raid_plan"
  | "steal"
  | "arrest"
  | "investigate"
  | "travel"
  | "work"
  | "preach"
  | "heal";

export type NpcIntent = {
  id: string;
  kind: IntentKind;
  formedTick: SimTick;
  /**
   * Strength 0..100. Higher increases chance to turn into an attempt later.
   */
  intensity: number;
  executeAtTick?: SimTick;
  targetNpcId?: NpcId;
  targetSiteId?: SiteId;
  lastSignaledTick?: SimTick;
  whyText?: string;
  data?: Record<string, unknown>;
};

export type ScoreContribution = {
  kind:
    | "base"
    | "need"
    | "trait"
    | "emotion"
    | "memory"
    | "belief"
    | "relationship"
    | "siteCondition"
    | "stateMod"
    | "goalMod"
    | "specialCase"
    | "obligation";
  key?: string; // e.g. need name, trait name, predicate, stateId, goalId, obligationId
  delta: number;
  note?: string;
};

export type AttemptWhy = {
  /**
   * Short human-readable explanation for logs/UI.
   * Keep it short; detailed breakdown lives in `drivers`.
   */
  text: string;
  /**
   * Active goals on the actor at decision time (parallel goals).
   * These are ids (definition ids).
   */
  activeGoalIds: string[];
  /**
   * Subset of active goals that materially pushed this action choice.
   */
  selectedGoalIds: string[];
  /**
   * Contextual duties/responsibilities not tied to a single long-term goal.
   * Example: guard_duty, cult_duty, subsistence_work.
   */
  obligations: string[];
  /**
   * Score breakdown/top drivers used to generate `text`.
   * Deltas are in the same units as action scoring weights.
   */
  drivers: ScoreContribution[];
};

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
  why?: AttemptWhy;
};

export type EventKind =
  | "sim.started"
  | "sim.day.ended"
  | "npc.died"
  | "travel.encounter"
  | "local.travel.started"
  | "local.travel.arrived"
  | "local.action.performed"
  | "intent.signaled"
  | "opportunity.created"
  | "opportunity.responded"
  | "attempt.started"
  | "attempt.aborted"
  | "attempt.interrupted"
  | "attempt.completed"
  | "world.food.produced"
  | "world.food.consumed"
  | "world.food.spoiled"
  | "world.population.changed"
  | "world.migration"
  | "world.refugees.arrived"
  | "world.unrest.drifted"
  | "world.morale.drifted"
  | "world.eclipsing.pressure"
  | "world.anchoring.strength"
  | "world.cult.influence"
  | "world.incident"
  | "faction.operation.created"
  | "faction.operation.phase"
  | "faction.operation.completed"
  | "faction.operation.aborted"
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
  hunger?: number;
  cultInfluence?: number;
  eclipsingPressure: number;
  anchoringStrength: number;
  // Phase 4 observability (named NPC layer)
  aliveNpcs?: number;
  deadNpcs?: number;
  cultMembers?: number;
  avgTrauma?: number;
  deathsToday?: Partial<Record<DeathCause, number>>;
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

// v2: Social debts are lightweight obligations that influence decisions.
export type SocialDebtKind =
  | "life_saved"
  | "injury_caused"
  | "theft"
  | "favor_granted"
  | "betrayal"
  | "insult"
  | "hospitality"
  | "financial";

export type SocialDebt = {
  id: string;
  otherNpcId: NpcId;
  direction: "owes" | "owed"; // I owe them / they owe me
  debtKind: SocialDebtKind;
  magnitude: number; // 0..100
  reason: string;
  createdTick: SimTick;
  dueTick?: SimTick;
  settledTick?: SimTick;
  settled?: boolean;
};

// v2: Minimal personal inventory (opt-in).
export type NpcInventory = {
  coins: number;
  food: Partial<Record<FoodType, number>>; // personal stash
  items?: Record<string, number>; // reserved for later
};

// v2: Asymmetric knowledge (opt-in).
export type KnowledgeFactKind =
  | "identified_cult_member"
  | "discovered_location"
  | "saw_crime"
  | "heard_rumor"
  | "custom";

export type KnowledgeConfidence = number; // 0..100

export type KnowledgeFact = {
  id: string;
  kind: KnowledgeFactKind;
  subjectId: string; // npcId or siteId depending on kind
  object?: string;
  confidence: KnowledgeConfidence;
  source: "witnessed" | "report" | "rumor" | "deduced";
  tick: SimTick;
};

export type SecretKind = "faction_membership" | "crime" | "location" | "plan" | "custom";

export type Secret = {
  id: string;
  kind: SecretKind;
  subjectId: string;
  details: string;
  createdTick: SimTick;
};

export type SecretKnowledge = {
  secretId: string;
  confidence: KnowledgeConfidence;
  learnedTick: SimTick;
  source: "witnessed" | "report" | "rumor" | "deduced";
};

export type NpcKnowledge = {
  facts: KnowledgeFact[]; // bounded
  secrets: SecretKnowledge[]; // bounded
};

// v2: Minimal plan state (opt-in).
export type PlanGoalKind = "get_food" | "stay_safe" | "do_duty" | "custom";

export type PlanStep = {
  kind: AttemptKind;
  note?: string;
};

export type PlanState = {
  id: string;
  goal: PlanGoalKind;
  createdTick: SimTick;
  steps: PlanStep[];
  stepIndex: number;
  reason: string;
  // v2+: basic robustness fields (optional).
  failures?: number;
  lastProgressTick?: SimTick;
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

  // Home site tracking (Requirement 9). The NPC's permanent home location.
  // Used for Belonging need calculation and home-return behavior.
  homeSiteId: SiteId;

  awayFromHomeSinceTick?: SimTick;
  familyIds: NpcId[];

  // AI state (scoring/states/goals/proficiency; introduced in v2 AI spec).
  activeStates: ActiveState[];
  goals: ActiveGoal[];
  intents: NpcIntent[];
  proficiency: Partial<Record<ProficiencyDomain, number>>;
  recentActions: { kind: AttemptKind; tick: SimTick; why?: AttemptWhy }[]; // rolling window
  consecutiveHungerHours: number;
  stateTriggerMemory: Record<string, SimTick>;

  // Movement (Phase 1.2/4). When set, NPC is considered "in transit" and should not
  // be counted as present in any site for witnessing/active selection.
  travel?: TravelState;

  // Intra-settlement location (Phase X). Only meaningful when at a settlement site.
  homeLocationId?: LocationId;
  local?: {
    siteId: SiteId;
    locationId: LocationId;
  };
  localTravel?: LocalTravelState;

  status?: {
    detained?: {
      byNpcId: NpcId;
      atSiteId: SiteId;
      startedTick: SimTick;
      untilTick: SimTick;
    };
    eclipsing?: {
      initiatedTick: SimTick;
      completeTick: SimTick;
      reversibleUntilTick: SimTick;
    };
  };

  alive: boolean;
  death?: {
    tick: SimTick;
    cause: DeathCause;
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

  // v2: emotional state (0..100). Optional for backward compatibility with older snapshots/tests.
  emotions?: EmotionalState;

  // Simple health meter (0..maxHp). Used for assault/heal outcomes.
  hp: number;
  maxHp: number;

  traits: Record<TraitKey, number>;
  values: ValueTag[];
  needs: Record<NeedKey, number>;

  // 0..100
  notability: number;

  // scheduling / throttling
  lastAttemptTick: SimTick;
  forcedActiveUntilTick: SimTick;
  busyUntilTick: SimTick;
  busyKind?: AttemptKind;

  // Attempt lifecycle (v-next): a started attempt that hasn't reached its consequence-application phase yet.
  pendingAttempt?: {
    startedTick: SimTick;
    executeAtTick: SimTick;
    attempt: Attempt;
  };

  // knowledge + relationships
  beliefs: Belief[]; // bounded
  relationships: Record<NpcId, Relationship>; // materialized on first interaction or heard-about update
  debts?: SocialDebt[]; // v2: optional; only used when enabled
  inventory?: NpcInventory; // v2: optional; only used when enabled
  knowledge?: NpcKnowledge; // v2: optional; only used when enabled
  plan?: PlanState; // v2: optional; only used when enabled
};

export function tickToDay(tick: SimTick): number {
  return Math.floor(tick / 24);
}

export function tickToHourOfDay(tick: SimTick): HourOfDay {
  const h = tick % 24;
  return (h < 0 ? h + 24 : h) as HourOfDay;
}


