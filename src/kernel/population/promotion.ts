/**
 * Promotion pipeline: promotes unnamed pool individuals to named agents.
 * 
 * This system handles:
 * - Role slot management (tracking which roles need filling)
 * - Vacancy detection (when agents die)
 * - Candidate promotion from population pools
 * - Trainee state management
 * - Training completion and graduation
 */

import type { 
  SiteId, 
  SimTick, 
  NpcState, 
  NpcCategory, 
  TraitKey, 
  WorldState,
  SettlementSiteState,
} from "../../sim/types";
import type { EntityId } from "../kernelTypes";
import type { PopulationPool, PoolState } from "./pools";
import { stableRollId, stableInt, stableFloat } from "../stableRng";

// ============================================================================
// Core Types
// ============================================================================

export interface RoleSlot {
  id: string;
  role: string;
  siteId: SiteId;
  filledBy?: EntityId;
  priority: number;  // Higher = more urgent to fill
}

export interface TraineeState {
  entityId: EntityId;
  role: string;
  siteId: SiteId;
  mentorId?: EntityId;
  startTick: SimTick;
  progressHours: number;
  requiredHours: number;
}

export interface PromotionConfig {
  /** Target number of named agents per site (soft cap) */
  targetNamedAgentsPerSite: Record<string, number>;
  /** Default target if site not specified */
  defaultTargetNamedAgents: number;
  /** Base training hours for most roles */
  trainingHoursBase: number;
  /** Training hours by role complexity */
  trainingHoursByRole: Record<string, number>;
  /** Speed multiplier when mentor present */
  mentorSpeedBonus: number;
  /** Maximum promotions per tick per site */
  maxPromotionsPerTick: number;
  /** Minimum pool size to allow promotions */
  minPoolForPromotion: number;
}

export const DEFAULT_PROMOTION_CONFIG: PromotionConfig = {
  targetNamedAgentsPerSite: {
    "HumanCityPort": 100,
    "ElvenCity": 150,
    "ElvenTownFortified": 60,
    "HumanVillageA": 30,
    "HumanVillageB": 30,
  },
  defaultTargetNamedAgents: 50,
  trainingHoursBase: 120, // 5 days default
  trainingHoursByRole: {
    // Simple roles - shorter training
    "Farmer": 72,           // 3 days
    "Fisher": 72,           // 3 days
    "ElvenCitizen": 72,     // 3 days
    // Moderate roles
    "HunterTrapper": 120,   // 5 days
    "Craftsperson": 120,    // 5 days
    "MerchantSmuggler": 120, // 5 days
    // Complex roles - longer training
    "GuardMilitia": 168,    // 7 days
    "HealerHedgeMage": 168, // 7 days
    "ScoutRanger": 168,     // 7 days
    "ElvenWarriorSentinel": 168, // 7 days
    "Threadwarden": 240,    // 10 days
    "AnchorMage": 240,      // 10 days
  },
  mentorSpeedBonus: 1.5,
  maxPromotionsPerTick: 2,
  minPoolForPromotion: 10,
};

export interface PromotionState {
  roleSlots: RoleSlot[];
  trainees: TraineeState[];
}

// ============================================================================
// Role Definitions
// ============================================================================

/**
 * Defines trait biases for roles when sampling from pool.
 * These bias the random trait generation toward role-appropriate values.
 */
export const ROLE_TRAIT_BIASES: Record<string, Partial<Record<TraitKey, number>>> = {
  // Combat roles
  "GuardMilitia": { Discipline: 60, Courage: 60, Integrity: 55 },
  "ScoutRanger": { Courage: 60, Suspicion: 55, Discipline: 55 },
  "ElvenWarriorSentinel": { Discipline: 70, Courage: 70, Integrity: 65 },
  // Leadership roles
  "LocalLeader": { Integrity: 70, Discipline: 65, Ambition: 60 },
  "ElvenLeader": { Discipline: 80, Integrity: 80, Ambition: 55 },
  // Magic/scholarly roles
  "HealerHedgeMage": { Empathy: 70, Integrity: 65, Discipline: 55 },
  "Threadwarden": { Curiosity: 70, Discipline: 70, Integrity: 60 },
  "AnchorMage": { Discipline: 75, Curiosity: 65, Integrity: 60 },
  "ContinuumScholar": { Curiosity: 75, Discipline: 60 },
  // Trade roles
  "MerchantSmuggler": { Greed: 60, Ambition: 55 },
  "Craftsperson": { Discipline: 55, Ambition: 50 },
  // Subsistence roles
  "Farmer": {},
  "Fisher": {},
  "HunterTrapper": { Courage: 60 },
  "ElvenCitizen": { Discipline: 55 },
  // Outlaws
  "BanditRaider": { Greed: 70, Integrity: 20, Aggression: 60 },
  // Cult (typically not promoted, but included for completeness)
  "ConcordDevotee": { NeedForCertainty: 75 },
  "SilentExile": { Fear: 65, Suspicion: 65 },
};

/**
 * Maps roles to their category for NPC creation.
 */
export const ROLE_TO_CATEGORY: Record<string, NpcCategory> = {
  "guard": "GuardMilitia",
  "farmer": "Farmer",
  "fisher": "Fisher",
  "hunter": "HunterTrapper",
  "merchant": "MerchantSmuggler",
  "healer": "HealerHedgeMage",
  "craftsperson": "Craftsperson",
  "scout": "ScoutRanger",
  "leader": "LocalLeader",
  "warrior": "ElvenWarriorSentinel",
  "threadwarden": "Threadwarden",
  "anchor_mage": "AnchorMage",
  "scholar": "ContinuumScholar",
  "elven_leader": "ElvenLeader",
  "citizen": "ElvenCitizen",
};

/**
 * Default role distribution by site culture.
 * Used when determining what roles to prioritize for promotion.
 */
export const DEFAULT_ROLE_DISTRIBUTION: Record<"human" | "elven", string[]> = {
  human: ["Farmer", "GuardMilitia", "Fisher", "HunterTrapper", "Craftsperson", "MerchantSmuggler"],
  elven: ["ElvenCitizen", "ElvenWarriorSentinel", "Threadwarden", "ContinuumScholar"],
};

// ============================================================================
// State Management
// ============================================================================

export function createEmptyPromotionState(): PromotionState {
  return {
    roleSlots: [],
    trainees: [],
  };
}

/**
 * Initialize role slots from existing named NPCs in the world.
 * This creates slots for each named NPC, allowing vacancy tracking.
 */
export function initializeRoleSlotsFromWorld(world: WorldState): RoleSlot[] {
  const slots: RoleSlot[] = [];
  let slotSeq = 0;
  
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive) continue;
    
    slots.push({
      id: `slot:${++slotSeq}`,
      role: npc.category,
      siteId: npc.siteId,
      filledBy: npc.id,
      priority: getRolePriority(npc.category),
    });
  }
  
  return slots;
}

/**
 * Get priority for filling a role slot.
 * Higher priority = more important to fill quickly.
 */
export function getRolePriority(role: string): number {
  switch (role) {
    // Critical roles - highest priority
    case "LocalLeader":
    case "ElvenLeader":
      return 100;
    // Security roles - high priority
    case "GuardMilitia":
    case "ElvenWarriorSentinel":
    case "ScoutRanger":
      return 80;
    // Essential services - medium-high priority
    case "HealerHedgeMage":
    case "Threadwarden":
    case "AnchorMage":
      return 70;
    // Economic roles - medium priority
    case "Farmer":
    case "Fisher":
    case "HunterTrapper":
    case "Craftsperson":
    case "MerchantSmuggler":
      return 50;
    // Scholarly roles - lower priority
    case "ContinuumScholar":
    case "ElvenCitizen":
      return 30;
    // Default
    default:
      return 40;
  }
}

// ============================================================================
// Vacancy Detection
// ============================================================================

/**
 * Find vacant role slots (roles where the assigned NPC has died).
 * Returns slots sorted by priority (highest first).
 */
export function findVacancies(state: PromotionState, deadEntityIds: Set<EntityId>): RoleSlot[] {
  return state.roleSlots.filter(slot => {
    if (!slot.filledBy) return true;
    if (deadEntityIds.has(slot.filledBy)) return true;
    return false;
  }).sort((a, b) => b.priority - a.priority);
}

/**
 * Check if a site needs more named agents.
 * Compares current alive named count against target.
 */
export function siteNeedsPromotion(
  world: WorldState,
  siteId: SiteId,
  config: PromotionConfig = DEFAULT_PROMOTION_CONFIG
): { needed: boolean; deficit: number } {
  const target = config.targetNamedAgentsPerSite[siteId] ?? config.defaultTargetNamedAgents;
  
  let currentCount = 0;
  for (const npc of Object.values(world.npcs)) {
    if (npc.alive && npc.siteId === siteId) {
      currentCount++;
    }
  }
  
  const deficit = target - currentCount;
  return { needed: deficit > 0, deficit };
}

/**
 * Get all dead entity IDs from the world.
 */
export function getDeadEntityIds(world: WorldState): Set<EntityId> {
  const dead = new Set<EntityId>();
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive) {
      dead.add(npc.id);
    }
  }
  return dead;
}

// ============================================================================
// Candidate Sampling
// ============================================================================

/**
 * Parameters for sampling a candidate from the population pool.
 */
export interface CandidateSampleParams {
  siteId: SiteId;
  role: string;
  tick: SimTick;
  seed: number;
  culture: "human" | "elven" | "neutral";
  pool?: PopulationPool;
}

/**
 * Result of sampling a candidate.
 */
export interface CandidateSample {
  name: string;
  category: NpcCategory;
  traits: Record<TraitKey, number>;
  notability: number;
}

/**
 * Human name components for random generation.
 */
const HUMAN_FIRST_NAMES = ["Alden", "Mara", "Jon", "Tessa", "Bran", "Lysa", "Edrin", "Sera", "Dane", "Rook", "Fenn", "Kara", "Cass", "Thom", "Elise", "Gareth", "Nora", "Pike", "Quinn", "Vera"];
const HUMAN_LAST_NAMES = ["Ashford", "Evershore", "Briar", "Stone", "Wells", "Hearth", "North", "Crowe", "Reed", "Hale", "Marsh", "Dale", "Brook", "Forge", "Shore"];
const ELF_PREFIXES = ["Leth", "Syl", "Vael", "Ari", "Kael", "Thal", "Eli", "Myrr", "Sael", "Iri", "Ael", "Cel", "Dae", "Fae"];
const ELF_SUFFIXES = ["varin", "thir", "lorn", "sara", "deth", "mire", "wen", "dor", "reth", "syl", "nar", "ril", "wyn"];

/**
 * Sample a candidate from the population pool.
 * Generates deterministic traits and name based on seed.
 */
export function sampleCandidate(params: CandidateSampleParams): CandidateSample {
  const { siteId, role, tick, seed, culture } = params;
  
  // Determine category from role
  const category = (role as NpcCategory) || "Farmer";
  
  // Generate deterministic name
  const nameRollId = stableRollId({ tick, siteId, purpose: `promotion.name.${role}` });
  const name = generateName(seed, nameRollId, culture);
  
  // Generate traits with role bias
  const traits = generateTraits(seed, tick, siteId, role);
  
  // Calculate notability based on role
  const notability = getBaseNotability(category);
  
  return {
    name,
    category,
    traits,
    notability,
  };
}

/**
 * Generate a name based on culture.
 */
function generateName(seed: number, rollId: string, culture: "human" | "elven" | "neutral"): string {
  if (culture === "elven") {
    const prefixIdx = stableInt(seed, rollId + ".prefix", 0, ELF_PREFIXES.length - 1);
    const suffixIdx = stableInt(seed, rollId + ".suffix", 0, ELF_SUFFIXES.length - 1);
    return `${ELF_PREFIXES[prefixIdx]}${ELF_SUFFIXES[suffixIdx]}`;
  } else {
    const firstIdx = stableInt(seed, rollId + ".first", 0, HUMAN_FIRST_NAMES.length - 1);
    const lastIdx = stableInt(seed, rollId + ".last", 0, HUMAN_LAST_NAMES.length - 1);
    return `${HUMAN_FIRST_NAMES[firstIdx]} ${HUMAN_LAST_NAMES[lastIdx]}`;
  }
}

/**
 * Generate traits with role-appropriate biases.
 */
function generateTraits(
  seed: number,
  tick: SimTick,
  siteId: SiteId,
  role: string
): Record<TraitKey, number> {
  const bias = ROLE_TRAIT_BIASES[role] ?? {};
  const traits: Record<TraitKey, number> = {
    Fear: 50,
    Ambition: 50,
    Loyalty: 50,
    Greed: 50,
    Empathy: 50,
    Aggression: 50,
    Discipline: 50,
    Curiosity: 50,
    Suspicion: 50,
    NeedForCertainty: 50,
    Courage: 50,
    Integrity: 50,
  };
  
  const traitKeys = Object.keys(traits) as TraitKey[];
  
  for (const key of traitKeys) {
    const baseValue = bias[key] ?? 50;
    const rollId = stableRollId({ tick, siteId, purpose: `promotion.trait.${key}` });
    // Add random variation (-20 to +20) around the base/biased value
    const variation = stableInt(seed, rollId, -20, 20);
    traits[key] = Math.max(0, Math.min(100, baseValue + variation));
  }
  
  return traits;
}

/**
 * Get base notability for a role.
 */
function getBaseNotability(category: NpcCategory): number {
  switch (category) {
    case "LocalLeader":
    case "ElvenLeader":
      return 55;
    case "HealerHedgeMage":
    case "Threadwarden":
    case "AnchorMage":
      return 45;
    case "GuardMilitia":
    case "ScoutRanger":
    case "ElvenWarriorSentinel":
      return 35;
    case "ContinuumScholar":
      return 30;
    case "MerchantSmuggler":
    case "BanditRaider":
      return 25;
    default:
      return 10;
  }
}

// ============================================================================
// Training Management
// ============================================================================

/**
 * Create a new trainee entry.
 */
export function createTrainee(
  entityId: EntityId,
  role: string,
  siteId: SiteId,
  tick: SimTick,
  config: PromotionConfig = DEFAULT_PROMOTION_CONFIG
): TraineeState {
  const requiredHours = config.trainingHoursByRole[role] ?? config.trainingHoursBase;
  
  return {
    entityId,
    role,
    siteId,
    mentorId: undefined,
    startTick: tick,
    progressHours: 0,
    requiredHours,
  };
}

/**
 * Advance training progress for a trainee.
 * Returns updated trainee state.
 */
export function advanceTraining(
  trainee: TraineeState, 
  hasMentor: boolean,
  config: PromotionConfig = DEFAULT_PROMOTION_CONFIG
): TraineeState {
  const hourlyProgress = hasMentor ? config.mentorSpeedBonus : 1;
  return {
    ...trainee,
    progressHours: trainee.progressHours + hourlyProgress,
  };
}

/**
 * Check if training is complete.
 */
export function isTrainingComplete(trainee: TraineeState): boolean {
  return trainee.progressHours >= trainee.requiredHours;
}

/**
 * Assign a mentor to a trainee.
 */
export function assignMentor(trainee: TraineeState, mentorId: EntityId): TraineeState {
  return { ...trainee, mentorId };
}

/**
 * Find a potential mentor for a trainee at the same site.
 * Returns the ID of an eligible mentor, or undefined if none available.
 */
export function findMentor(
  world: WorldState,
  trainee: TraineeState
): EntityId | undefined {
  // Look for alive NPCs at the same site with the same category who aren't already mentoring
  const candidates: NpcState[] = [];
  
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive) continue;
    if (npc.siteId !== trainee.siteId) continue;
    if (npc.id === trainee.entityId) continue;
    if (npc.category !== trainee.role) continue;
    
    candidates.push(npc);
  }
  
  // Prefer NPCs with higher proficiency/experience (approximated by notability)
  candidates.sort((a, b) => b.notability - a.notability);
  
  return candidates[0]?.id;
}

// ============================================================================
// Promotion Pipeline
// ============================================================================

/**
 * Result of running the promotion check.
 */
export interface PromotionResult {
  /** Updated promotion state */
  state: PromotionState;
  /** Newly created NPCs to add to world */
  newNpcs: NpcState[];
  /** IDs of trainees who completed training */
  graduatedIds: EntityId[];
  /** Events describing what happened */
  events: PromotionEvent[];
}

export interface PromotionEvent {
  type: "vacancy_detected" | "candidate_promoted" | "training_started" | "training_completed" | "mentor_assigned";
  tick: SimTick;
  siteId: SiteId;
  entityId?: EntityId;
  role?: string;
  mentorId?: EntityId;
  message: string;
}

/**
 * Check for and execute promotions.
 * This is the main entry point for the promotion pipeline.
 */
export function checkPromotions(
  world: WorldState,
  state: PromotionState,
  poolState: PoolState,
  config: PromotionConfig = DEFAULT_PROMOTION_CONFIG
): PromotionResult {
  const events: PromotionEvent[] = [];
  const newNpcs: NpcState[] = [];
  const graduatedIds: EntityId[] = [];
  let updatedState = { ...state };
  
  // 1. Find dead entities to detect vacancies
  const deadIds = getDeadEntityIds(world);
  
  // 2. Find vacancies
  const vacancies = findVacancies(updatedState, deadIds);
  
  // Track events for vacancies (only new ones)
  for (const vacancy of vacancies) {
    if (vacancy.filledBy && deadIds.has(vacancy.filledBy)) {
      events.push({
        type: "vacancy_detected",
        tick: world.tick,
        siteId: vacancy.siteId,
        role: vacancy.role,
        message: `Role ${vacancy.role} became vacant at ${vacancy.siteId}`,
      });
    }
  }
  
  // 3. Advance training for existing trainees
  const completedTrainees: TraineeState[] = [];
  const ongoingTrainees: TraineeState[] = [];
  
  for (const trainee of updatedState.trainees) {
    // Check if trainee's NPC still exists and is alive
    const traineeNpc = world.npcs[trainee.entityId];
    if (!traineeNpc || !traineeNpc.alive) {
      // Trainee died, remove from training
      continue;
    }
    
    // Check if mentor is still available
    const hasMentor = trainee.mentorId ? (
      world.npcs[trainee.mentorId]?.alive && 
      world.npcs[trainee.mentorId]?.siteId === trainee.siteId
    ) : false;
    
    const advanced = advanceTraining(trainee, hasMentor, config);
    
    if (isTrainingComplete(advanced)) {
      completedTrainees.push(advanced);
      graduatedIds.push(advanced.entityId);
      
      events.push({
        type: "training_completed",
        tick: world.tick,
        siteId: advanced.siteId,
        entityId: advanced.entityId,
        role: advanced.role,
        message: `${traineeNpc.name} completed training as ${advanced.role}`,
      });
    } else {
      ongoingTrainees.push(advanced);
    }
  }
  
  updatedState.trainees = ongoingTrainees;
  
  // 4. Clear filledBy for dead NPCs in role slots
  updatedState.roleSlots = updatedState.roleSlots.map(slot => {
    if (slot.filledBy && deadIds.has(slot.filledBy)) {
      return { ...slot, filledBy: undefined };
    }
    return slot;
  });
  
  // 5. Check each site for promotion needs
  const sitesNeedingPromotion = new Set<SiteId>();
  
  for (const siteId of Object.keys(world.sites)) {
    const site = world.sites[siteId];
    if (site.kind !== "settlement") continue;
    
    const { needed, deficit } = siteNeedsPromotion(world, siteId, config);
    if (needed && deficit > 0) {
      sitesNeedingPromotion.add(siteId);
    }
  }
  
  // 6. Execute promotions for sites that need them
  let totalPromotionsThisTick = 0;
  
  for (const siteId of sitesNeedingPromotion) {
    if (totalPromotionsThisTick >= config.maxPromotionsPerTick * sitesNeedingPromotion.size) {
      break;
    }
    
    const pool = poolState.pools[siteId];
    if (!pool || pool.count < config.minPoolForPromotion) {
      continue; // Not enough unnamed population to promote from
    }
    
    const site = world.sites[siteId] as SettlementSiteState;
    const culture = site.culture as "human" | "elven" | "neutral";
    
    // Determine what role to promote
    const roleToPromote = selectRoleToPromote(world, siteId, updatedState, culture);
    if (!roleToPromote) continue;
    
    // Sample candidate from pool
    const candidate = sampleCandidate({
      siteId,
      role: roleToPromote,
      tick: world.tick,
      seed: world.seed,
      culture,
      pool,
    });
    
    // Create the new NPC
    const newNpc = createPromotedNpc(
      world,
      siteId,
      candidate,
      world.tick
    );
    
    newNpcs.push(newNpc);
    
    // Create trainee entry
    const trainee = createTrainee(newNpc.id, roleToPromote, siteId, world.tick, config);
    
    // Try to find a mentor
    const mentorId = findMentor(world, trainee);
    const traineeWithMentor = mentorId ? assignMentor(trainee, mentorId) : trainee;
    
    updatedState.trainees.push(traineeWithMentor);
    
    // Create role slot for the new NPC
    updatedState.roleSlots.push({
      id: `slot:promoted:${newNpc.id}`,
      role: roleToPromote,
      siteId,
      filledBy: newNpc.id,
      priority: getRolePriority(roleToPromote),
    });
    
    events.push({
      type: "candidate_promoted",
      tick: world.tick,
      siteId,
      entityId: newNpc.id,
      role: roleToPromote,
      message: `${candidate.name} promoted to ${roleToPromote} at ${site.name}`,
    });
    
    events.push({
      type: "training_started",
      tick: world.tick,
      siteId,
      entityId: newNpc.id,
      role: roleToPromote,
      message: `${candidate.name} began training as ${roleToPromote}`,
    });
    
    if (mentorId) {
      const mentor = world.npcs[mentorId];
      events.push({
        type: "mentor_assigned",
        tick: world.tick,
        siteId,
        entityId: newNpc.id,
        mentorId,
        role: roleToPromote,
        message: `${mentor?.name ?? "Unknown"} assigned as mentor to ${candidate.name}`,
      });
    }
    
    totalPromotionsThisTick++;
  }
  
  return {
    state: updatedState,
    newNpcs,
    graduatedIds,
    events,
  };
}

/**
 * Select which role to promote based on vacancies and site needs.
 */
function selectRoleToPromote(
  world: WorldState,
  siteId: SiteId,
  state: PromotionState,
  culture: "human" | "elven" | "neutral"
): string | undefined {
  // First, check for vacancies at this site
  const deadIds = getDeadEntityIds(world);
  const siteVacancies = state.roleSlots
    .filter(slot => slot.siteId === siteId && (!slot.filledBy || deadIds.has(slot.filledBy)))
    .sort((a, b) => b.priority - a.priority);
  
  if (siteVacancies.length > 0) {
    return siteVacancies[0].role;
  }
  
  // Otherwise, use default distribution for the culture
  const distribution = DEFAULT_ROLE_DISTRIBUTION[culture === "elven" ? "elven" : "human"];
  
  // Count current roles at site
  const roleCounts: Record<string, number> = {};
  for (const npc of Object.values(world.npcs)) {
    if (npc.alive && npc.siteId === siteId) {
      roleCounts[npc.category] = (roleCounts[npc.category] ?? 0) + 1;
    }
  }
  
  // Find the role with the lowest representation
  let minRole: string | undefined;
  let minCount = Infinity;
  
  for (const role of distribution) {
    const count = roleCounts[role] ?? 0;
    if (count < minCount) {
      minCount = count;
      minRole = role;
    }
  }
  
  return minRole ?? distribution[0];
}

/**
 * Create a new NPC from a promoted candidate.
 */
function createPromotedNpc(
  world: WorldState,
  siteId: SiteId,
  candidate: CandidateSample,
  tick: SimTick
): NpcState {
  // Generate a unique ID
  const existingIds = Object.keys(world.npcs);
  const maxSeq = existingIds.reduce((max, id) => {
    const match = id.match(/^npc:(\d+)$/);
    if (match) {
      return Math.max(max, parseInt(match[1], 10));
    }
    return max;
  }, 0);
  
  const newId = `npc:${maxSeq + 1}`;
  
  // Check if this is a cult role
  const isConcord = candidate.category === "ConcordDevotee" || 
                    candidate.category === "ConcordCellLeaderRitualist" || 
                    candidate.category === "ConcordEnforcer";
  
  const cultRole = candidate.category === "ConcordCellLeaderRitualist" ? "cell_leader" :
                   candidate.category === "ConcordEnforcer" ? "enforcer" :
                   candidate.category === "ConcordDevotee" ? "devotee" : "none";
  
  const site = world.sites[siteId] as SettlementSiteState;
  const defaultLocationId = site.local?.nodes[0]?.id ?? `${siteId}:street:i0`;
  
  return {
    id: newId,
    name: candidate.name,
    category: candidate.category,
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
      member: isConcord,
      role: cultRole as "none" | "devotee" | "cell_leader" | "enforcer",
      joinedTick: isConcord ? tick : undefined,
    },
    trauma: 0,
    emotions: {
      anger: 0,
      fear: 0,
      grief: 0,
      gratitude: 0,
      pride: 0,
      shame: 0,
      stress: 0,
    },
    hp: 100,
    maxHp: 100,
    traits: candidate.traits,
    values: [],
    needs: {
      Food: 0,
      Safety: 0,
      Health: 0,
      Shelter: 0,
      Belonging: 0,
      Status: 0,
      Wealth: 0,
      Freedom: 0,
      Meaning: 0,
      Duty: 0,
    },
    notability: candidate.notability,
    lastAttemptTick: tick,
    forcedActiveUntilTick: 0,
    busyUntilTick: tick + 24, // Newly promoted are busy for a day
    pendingAttempt: undefined,
    beliefs: [],
    relationships: {},
    homeLocationId: defaultLocationId,
    local: {
      siteId,
      locationId: defaultLocationId,
    },
  };
}

/**
 * Apply graduation effects to NPCs who completed training.
 * This increases proficiency and removes trainee penalty.
 */
export function applyGraduation(
  world: WorldState,
  graduatedIds: EntityId[]
): WorldState {
  if (graduatedIds.length === 0) return world;
  
  let updatedNpcs = { ...world.npcs };
  
  for (const id of graduatedIds) {
    const npc = updatedNpcs[id];
    if (!npc) continue;
    
    // Increase proficiency based on role
    const proficiency = { ...npc.proficiency };
    
    switch (npc.category) {
      case "GuardMilitia":
      case "ElvenWarriorSentinel":
        proficiency.combat = Math.min(100, (proficiency.combat ?? 0) + 20);
        break;
      case "ScoutRanger":
        proficiency.stealth = Math.min(100, (proficiency.stealth ?? 0) + 20);
        proficiency.investigation = Math.min(100, (proficiency.investigation ?? 0) + 10);
        break;
      case "HealerHedgeMage":
        proficiency.healing = Math.min(100, (proficiency.healing ?? 0) + 25);
        break;
      case "MerchantSmuggler":
        proficiency.trade = Math.min(100, (proficiency.trade ?? 0) + 20);
        break;
      case "Farmer":
      case "Fisher":
      case "HunterTrapper":
        proficiency.farming = Math.min(100, (proficiency.farming ?? 0) + 15);
        break;
      case "Threadwarden":
      case "AnchorMage":
        proficiency.ritual = Math.min(100, (proficiency.ritual ?? 0) + 25);
        break;
      case "LocalLeader":
      case "ElvenLeader":
        proficiency.leadership = Math.min(100, (proficiency.leadership ?? 0) + 20);
        break;
    }
    
    // Remove busyUntilTick penalty (graduate is ready for full duty)
    updatedNpcs[id] = {
      ...npc,
      proficiency,
      busyUntilTick: 0,
    };
  }
  
  return { ...world, npcs: updatedNpcs };
}
