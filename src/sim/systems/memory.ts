/**
 * Memory System for SimEngine v2
 * Handles creation, decay, and retrieval of episodic memories.
 */

import type { SimEvent, NpcState, WorldState, EventKind as LegacyEventKind } from "../types";
import type { EntityId, SiteId } from "../types";
import type { EpisodicMemory, EmotionTag, MemoryEventType, MemoryParticipant } from "./memoryTypes";
import { getConfig } from "../config";
import { applyEmotionalImpact, getEmotions } from "./emotions";

// Emit memory events as normal sim events (deterministic IDs).
type V2EventKind = LegacyEventKind | "entity.memory.formed" | "entity.memory.decayed";
type V2SimEvent = Omit<SimEvent, "kind"> & { kind: V2EventKind };

// =============================================================================
// MEMORY CREATION FROM EVENTS
// =============================================================================

/**
 * Create memories from simulation events for NPCs who witnessed them.
 * This is the main entry point called from the tick pipeline.
 */
export function createMemoriesFromEvents(
  world: WorldState,
  events: SimEvent[],
  nextEventSeq: () => number
): { world: WorldState; memoryEvents: SimEvent[] } {
  const config = getConfig();

  const memoryEvents: SimEvent[] = [];
  let updatedNpcs = { ...world.npcs };

  for (const event of events) {
    // Skip non-observable events
    if (!isObservableEvent(event)) continue;

    // Determine who witnessed this event
    const witnesses = getEventWitnesses(event, world);
    
    for (const witnessId of witnesses) {
      const npc = updatedNpcs[witnessId];
      if (!npc || !npc.alive) continue;

      // Create the memory
      const memory = createMemoryFromEvent(event, npc, world);
      if (!memory) continue;

      // Add memory to NPC (with limit enforcement)
      const updatedNpc = addMemoryToNpc(npc, memory, config.limits.maxMemoriesPerEntity);
      // v2: apply emotional impact to persistent emotion state
      const emotions = applyEmotionalImpact({ ...updatedNpc, emotions: getEmotions(updatedNpc) }, memory);
      updatedNpcs[witnessId] = { ...updatedNpc, emotions };

      // Emit memory formation event (using world.incident kind for compatibility)
      if (config.debug.logMemoryFormation) {
        memoryEvents.push({
          id: `evt-mem-${world.tick}-${nextEventSeq()}`,
          kind: "world.incident", // Use existing event kind for compatibility
          tick: world.tick,
          siteId: memory.siteId as string,
          message: `${npc.name} formed memory: ${memory.eventType}`,
          visibility: "private",
          data: {
            type: "memory.formed",
            entityId: npc.id,
            memory: memory,
          },
        });
      }
    }
  }

  return {
    world: { ...world, npcs: updatedNpcs },
    memoryEvents,
  };
}

/**
 * Determine if an event is observable and can create memories.
 */
function isObservableEvent(event: SimEvent): boolean {
  const observableKinds = [
    "attempt.completed",
    "attempt.started",
    "world.incident",
    "npc.died",
    "travel.encounter",
  ];
  return observableKinds.includes(event.kind);
}

/**
 * Get all NPCs who witnessed an event.
 */
function getEventWitnesses(event: SimEvent, world: WorldState): string[] {
  const witnesses: string[] = [];
  const siteId = event.siteId;

  if (!siteId) return witnesses;

  // All NPCs at the site can witness the event
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive) continue;
    if (npc.siteId !== siteId) continue;
    // Skip traveling NPCs
    if (npc.travel && npc.travel.remainingKm > 0) continue;
    
    witnesses.push(npc.id);
  }

  // The actor of an attempt always witnesses it
  const data = event.data as any;
  if (data?.attempt?.actorId && !witnesses.includes(data.attempt.actorId)) {
    const actor = world.npcs[data.attempt.actorId];
    if (actor?.alive) {
      witnesses.push(data.attempt.actorId);
    }
  }

  return witnesses;
}

/**
 * Create a memory from an event for a specific NPC.
 */
function createMemoryFromEvent(
  event: SimEvent,
  npc: NpcState,
  world: WorldState
): EpisodicMemory | null {
  const data = event.data as any;
  const attempt = data?.attempt;

  // Determine memory type and details
  const memoryType = getMemoryTypeFromEvent(event, npc);
  if (!memoryType) return null;

  // Determine participants
  const participants = getParticipantsFromEvent(event, npc, world);

  // Calculate emotional impact based on event type and relationships
  const emotionalImpact = calculateEmotionalImpact(event, npc, world);

  // Calculate importance based on event significance and relationships
  const importance = calculateImportance(event, npc, world);

  // Calculate initial vividness (high for recent, significant events)
  const vividness = Math.min(100, 80 + importance * 0.2);

  // IMPORTANT: memory IDs must be deterministic; do not use Math.random().
  // We tie the memory id to the event id + witness id so it stays stable across runs.
  return {
    id: `mem:${npc.id}:${event.id}`,
    tick: world.tick,
    siteId: (event.siteId ?? npc.siteId) as SiteId,
    locationId: npc.local?.locationId as any, // typed loosely to avoid over-constraining UI-facing logs
    eventType: memoryType,
    description: createMemoryDescription(event, npc, world),
    participants,
    emotionalImpact,
    vividness,
    importance,
    retrievalCount: 0,
    lastRetrievalTick: world.tick,
    relatedMemoryIds: [],
  };
}

/**
 * Map event kind to memory event type.
 */
function getMemoryTypeFromEvent(event: SimEvent, npc: NpcState): MemoryEventType | null {
  const data = event.data as any;
  const attempt = data?.attempt;

  if (event.kind === "npc.died") {
    if (data?.npcId === npc.id) return null; // Dead NPCs don't form memories
    return "witnessed_death";
  }

  if (event.kind === "world.incident") {
    const incidentType = data?.type;
    if (incidentType === "murder") {
      if (data?.victimNpcId === npc.id) return null;
      return "witnessed_murder";
    }
    if (incidentType === "attack" || incidentType === "assault") {
      if (data?.victimNpcId === npc.id) return "was_attacked";
      return "witnessed_attack";
    }
    return "general";
  }

  if (event.kind === "attempt.completed" && attempt) {
    const kind = attempt.kind;
    
    // Actor's perspective
    if (attempt.actorId === npc.id) {
      if (kind === "attack" || kind === "assault") return "witnessed_attack"; // They witnessed their own attack
      if (kind === "steal" || kind === "rob") return "witnessed_theft";
      if (kind === "heal" || kind === "help") return "helped_someone";
      return "general";
    }
    
    // Target's perspective
    if (attempt.targetId === npc.id) {
      if (kind === "attack" || kind === "assault") return "was_attacked";
      if (kind === "steal" || kind === "rob") return "was_robbed";
      if (kind === "heal" || kind === "help") return "was_helped";
      if (kind === "arrest") return "was_arrested";
      return "general";
    }

    // Witness perspective
    if (kind === "attack" || kind === "assault") return "witnessed_attack";
    if (kind === "steal" || kind === "rob") return "witnessed_theft";
    if (kind === "arrest") return "witnessed_arrest";
    return "general";
  }

  if (event.kind === "travel.encounter") {
    return "general";
  }

  return null;
}

/**
 * Get participants from an event.
 */
function getParticipantsFromEvent(
  event: SimEvent,
  npc: NpcState,
  world: WorldState
): MemoryParticipant[] {
  const participants: MemoryParticipant[] = [];
  const data = event.data as any;
  const attempt = data?.attempt;

  // Add self if relevant
  if (attempt?.actorId === npc.id || attempt?.targetId === npc.id) {
    participants.push({
      entityId: npc.id as EntityId,
      name: npc.name,
      role: attempt?.actorId === npc.id ? "actor" : "target",
    });
  } else {
    participants.push({
      entityId: npc.id as EntityId,
      name: npc.name,
      role: "witness",
    });
  }

  // Add actor if not self
  if (attempt?.actorId && attempt.actorId !== npc.id) {
    const actor = world.npcs[attempt.actorId];
    participants.push({
      entityId: attempt.actorId as EntityId,
      name: actor?.name ?? attempt.actorName ?? "Unknown",
      role: "actor",
    });
  }

  // Add target if not self
  if (attempt?.targetId && attempt.targetId !== npc.id) {
    const target = world.npcs[attempt.targetId];
    participants.push({
      entityId: attempt.targetId as EntityId,
      name: target?.name ?? attempt.targetName ?? "Unknown",
      role: "target",
    });
  }

  // Add incident victim
  if (data?.victimNpcId && data.victimNpcId !== npc.id) {
    const victim = world.npcs[data.victimNpcId];
    participants.push({
      entityId: data.victimNpcId as EntityId,
      name: victim?.name ?? "Unknown",
      role: "victim",
    });
  }

  return participants;
}

/**
 * Calculate emotional impact of an event for an NPC.
 */
function calculateEmotionalImpact(
  event: SimEvent,
  npc: NpcState,
  world: WorldState
): EpisodicMemory["emotionalImpact"] {
  const data = event.data as any;
  const attempt = data?.attempt;
  
  let valence = 0; // -1 to +1
  let arousal = 0.5; // 0 to 1
  const emotions: EmotionTag[] = [];

  // Determine emotional response based on event type
  if (event.kind === "npc.died" || event.kind === "world.incident" && data?.type === "murder") {
    const victimId = data?.npcId ?? data?.victimNpcId;
    const relationship = npc.relationships?.[victimId];
    
    // Use loyalty as a proxy for "affection" when computing relationship-based weights.
    if (relationship && relationship.loyalty > 30) {
      valence = -0.9;
      arousal = 0.9;
      emotions.push("grief", "sadness");
      if (data?.byNpcId || data?.perpetratorNpcId) {
        emotions.push("anger");
      }
    } else {
      valence = -0.3;
      arousal = 0.6;
      emotions.push("fear");
    }
  }

  if (attempt) {
    const kind = attempt.kind;
    
    if (attempt.targetId === npc.id) {
      // Something happened TO us
      if (kind === "attack" || kind === "assault") {
        valence = -0.8;
        arousal = 0.9;
        emotions.push("fear", "anger");
      } else if (kind === "steal" || kind === "rob") {
        valence = -0.6;
        arousal = 0.7;
        emotions.push("anger", "resentment");
      } else if (kind === "heal" || kind === "help") {
        valence = 0.7;
        arousal = 0.5;
        emotions.push("gratitude", "trust");
      }
    } else if (attempt.actorId === npc.id) {
      // We did something
      if (kind === "attack" || kind === "assault") {
        // Trait keys are PascalCase by convention.
        valence = (npc.traits?.Aggression ?? 50) > 60 ? 0.2 : -0.3;
        arousal = 0.7;
      } else if (kind === "help" || kind === "heal") {
        valence = 0.5;
        arousal = 0.4;
        emotions.push("pride");
      }
    } else {
      // We witnessed something
      if (kind === "attack" || kind === "assault") {
        const victimRel = npc.relationships?.[attempt.targetId];
        // Use loyalty as proxy for affection in v1 relationship model
        if (victimRel && victimRel.loyalty > 30) {
          valence = -0.6;
          arousal = 0.8;
          emotions.push("fear", "anger");
        } else {
          valence = -0.2;
          arousal = 0.5;
          emotions.push("fear");
        }
      }
    }
  }

  return { valence, arousal, emotions };
}

/**
 * Calculate importance of a memory.
 */
function calculateImportance(
  event: SimEvent,
  npc: NpcState,
  world: WorldState
): number {
  let importance = 30; // Base importance
  const data = event.data as any;
  const attempt = data?.attempt;

  // Death is always important
  if (event.kind === "npc.died" || (event.kind === "world.incident" && data?.type === "murder")) {
    importance = 90;
    
    // Even more important if victim was known
    const victimId = data?.npcId ?? data?.victimNpcId;
    const relationship = npc.relationships?.[victimId];
    // Use loyalty as a proxy for "affection" when computing relationship-based weights.
    if (relationship && relationship.loyalty > 50) {
      importance = 100;
    }
  }

  // Being directly involved increases importance
  if (attempt?.actorId === npc.id || attempt?.targetId === npc.id) {
    importance += 30;
  }

  // Violence is important
  if (attempt?.kind === "attack" || attempt?.kind === "assault") {
    importance += 20;
  }

  // Relationships increase importance
  if (attempt?.actorId && attempt.actorId !== npc.id) {
    const rel = npc.relationships?.[attempt.actorId];
    if (rel) {
    // Use loyalty as a proxy for "affection" when computing relationship-based weights.
      // Use loyalty as a proxy for "affection" when computing relationship-based weights.
      importance += Math.abs(rel.loyalty) * 0.2;
    }
  }

  return Math.min(100, Math.max(0, importance));
}

/**
 * Create a human-readable description of the memory.
 */
function createMemoryDescription(
  event: SimEvent,
  npc: NpcState,
  world: WorldState
): string {
  const data = event.data as any;
  const attempt = data?.attempt;

  if (event.kind === "npc.died") {
    const victim = world.npcs[data?.npcId];
    return `${victim?.name ?? "Someone"} died of ${data?.cause ?? "unknown causes"}`;
  }

  if (event.kind === "world.incident" && data?.type === "murder") {
    const victim = world.npcs[data?.victimNpcId];
    const killer = world.npcs[data?.perpetratorNpcId];
    return `${killer?.name ?? "Someone"} killed ${victim?.name ?? "someone"}`;
  }

  if (attempt) {
    const actor = world.npcs[attempt.actorId];
    const target = attempt.targetId ? world.npcs[attempt.targetId] : null;
    const actorName = actor?.name ?? "Someone";
    const targetName = target?.name ?? "someone";

    if (attempt.targetId === npc.id) {
      return `${actorName} ${attempt.kind}ed me`;
    } else if (attempt.actorId === npc.id) {
      return `I ${attempt.kind}ed ${targetName}`;
    } else {
      return `${actorName} ${attempt.kind}ed ${targetName}`;
    }
  }

  return event.message;
}

/**
 * Add a memory to an NPC, enforcing limits.
 */
function addMemoryToNpc(
  npc: NpcState,
  memory: EpisodicMemory,
  maxMemories: number
): NpcState {
  // Get existing memories or initialize
  const existingMemories: EpisodicMemory[] = (npc as any).episodicMemory ?? [];
  
  // Add new memory
  let newMemories = [...existingMemories, memory];

  // Enforce limit by removing least important, oldest memories
  if (newMemories.length > maxMemories) {
    newMemories = newMemories
      .sort((a, b) => {
        // Keep high importance memories
        const importanceDiff = b.importance - a.importance;
        if (Math.abs(importanceDiff) > 20) return importanceDiff;
        // Otherwise keep more recent
        return b.tick - a.tick;
      })
      .slice(0, maxMemories);
  }

  return {
    ...npc,
    episodicMemory: newMemories,
  } as NpcState;
}

// =============================================================================
// MEMORY DECAY
// =============================================================================

/**
 * Decay memories for all NPCs. Called daily.
 */
export function decayMemoriesDaily(
  world: WorldState,
  nextEventSeq: () => number
): { world: WorldState; events: SimEvent[] } {
  const config = getConfig();

  const events: SimEvent[] = [];
  const updatedNpcs = { ...world.npcs };

  // Determinism: iterate NPCs in stable order (affects debug event IDs when logMemoryFormation is on).
  const npcIds = Object.keys(world.npcs).sort();
  for (const id of npcIds) {
    const npc = world.npcs[id]!;
    if (!npc.alive) continue;

    const existingMemories: EpisodicMemory[] = (npc as any).episodicMemory ?? [];
    if (existingMemories.length === 0) continue;

    const decayedMemories: EpisodicMemory[] = [];
    
    for (const memory of existingMemories) {
      const daysSinceRetrieval = (world.tick - memory.lastRetrievalTick) / 24;
      
      // Decay vividness based on time and importance
      const decayRate = config.tuning.memoryDecayRate * (1 - memory.importance / 200);
      const newVividness = Math.max(0, memory.vividness - decayRate * daysSinceRetrieval);

      // Keep memory if above threshold or highly important
      if (newVividness > config.tuning.memoryVividnessThreshold || memory.importance > config.tuning.memoryImportanceThreshold) {
        decayedMemories.push({
          ...memory,
          vividness: newVividness,
        });
      } else if (config.debug.logMemoryFormation) {
        // Memory forgotten - use world.incident for compatibility
        events.push({
          id: `evt-mem-decay-${world.tick}-${nextEventSeq()}`,
          kind: "world.incident",
          tick: world.tick,
          message: `${npc.name} forgot: ${memory.eventType}`,
          visibility: "private",
          data: {
            type: "memory.decayed",
            entityId: npc.id,
            memoryId: memory.id,
            eventType: memory.eventType,
          },
        });
      }
    }

    updatedNpcs[npc.id] = {
      ...npc,
      episodicMemory: decayedMemories,
    } as NpcState;
  }

  return { world: { ...world, npcs: updatedNpcs }, events };
}

// =============================================================================
// MEMORY RETRIEVAL
// =============================================================================

/**
 * Retrieve memories relevant to a given context.
 */
export function retrieveRelevantMemories(
  npc: NpcState,
  context: {
    involvedEntities?: string[];
    siteId?: string;
    eventType?: MemoryEventType;
  },
  limit: number = 5
): EpisodicMemory[] {
  const memories: EpisodicMemory[] = (npc as any).episodicMemory ?? [];
  if (memories.length === 0) return [];

  return memories
    .filter((memory) => {
      // Match by involved entity
      if (context.involvedEntities?.length) {
        const participantIds = memory.participants.map(p => p.entityId as string);
        if (context.involvedEntities.some(id => participantIds.includes(id))) {
          return true;
        }
      }
      // Match by site
      if (context.siteId && memory.siteId === context.siteId) {
        return true;
      }
      // Match by event type
      if (context.eventType && memory.eventType === context.eventType) {
        return true;
      }
      return false;
    })
    .sort((a, b) => {
      // Prioritize by: importance, vividness, recency
      const scoreA = a.importance * 0.5 + a.vividness * 0.3 + (a.tick / 1000) * 0.2;
      const scoreB = b.importance * 0.5 + b.vividness * 0.3 + (b.tick / 1000) * 0.2;
      return scoreB - scoreA;
    })
    .slice(0, limit);
}

/**
 * Get memories about a specific entity.
 */
export function getMemoriesAboutEntity(
  npc: NpcState,
  targetEntityId: string
): EpisodicMemory[] {
  return retrieveRelevantMemories(npc, { involvedEntities: [targetEntityId] }, 10);
}

/**
 * Check if NPC has negative memories about an entity.
 */
export function hasNegativeMemoriesAbout(
  npc: NpcState,
  targetEntityId: string
): boolean {
  const memories = getMemoriesAboutEntity(npc, targetEntityId);
  return memories.some(m => m.emotionalImpact.valence < -0.3);
}

/**
 * Calculate memory-based hostility toward an entity.
 */
export function getMemoryBasedHostility(
  npc: NpcState,
  targetEntityId: string
): number {
  const memories = getMemoriesAboutEntity(npc, targetEntityId);
  if (memories.length === 0) return 0;

  // Sum negative emotional impacts, weighted by importance and vividness
  let hostility = 0;
  for (const memory of memories) {
    if (memory.emotionalImpact.valence < 0) {
      const weight = (memory.importance / 100) * (memory.vividness / 100);
      hostility += Math.abs(memory.emotionalImpact.valence) * weight * 30;
    }
  }

  return Math.min(100, hostility);
}

