import type { EntityId, LocationId, SimTick, SiteId } from "../types";

// Minimal memory-related types used by `src/sim/systems/memory.ts`.
// We keep these in the v2 runtime model (not the unused `src/sim/types/*` model).

export type EmotionTag =
  | "joy"
  | "sadness"
  | "anger"
  | "fear"
  | "disgust"
  | "surprise"
  | "gratitude"
  | "resentment"
  | "guilt"
  | "shame"
  | "pride"
  | "hope"
  | "anxiety"
  | "grief"
  | "jealousy"
  | "admiration"
  | "contempt"
  | "trust";

export type MemoryEventType =
  | "witnessed_murder"
  | "witnessed_attack"
  | "was_attacked"
  | "was_helped"
  | "helped_someone"
  | "was_robbed"
  | "witnessed_theft"
  | "witnessed_arrest"
  | "was_arrested"
  | "witnessed_death"
  | "lost_loved_one"
  | "made_friend"
  | "was_betrayed"
  | "betrayed_someone"
  | "arrived_at_place"
  | "left_home"
  | "returned_home"
  | "joined_faction"
  | "left_faction"
  | "received_order"
  | "completed_task"
  | "failed_task"
  | "discovered_secret"
  | "heard_rumor"
  | "general";

export type MemoryParticipant = {
  entityId: EntityId;
  name: string;
  role: "self" | "actor" | "target" | "witness" | "helper" | "victim" | "beneficiary";
};

export type EpisodicMemory = {
  id: string;

  tick: SimTick;
  siteId: SiteId;
  locationId?: LocationId;

  eventType: MemoryEventType;
  description: string;

  participants: MemoryParticipant[];

  emotionalImpact: {
    valence: number; // -1..+1
    arousal: number; // 0..1
    emotions: EmotionTag[];
  };

  vividness: number; // 0..100
  importance: number; // 0..100
  retrievalCount: number;
  lastRetrievalTick: SimTick;

  relatedGoalId?: string;
  relatedMemoryIds: string[];
};


