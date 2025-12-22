import type { AttemptKind, NeedKey, Relationship, SimTick, TraitKey } from "../types";

export type ReactiveStateDefinition = {
  id: string;
  name: string;
  triggers: StateTrigger[];
  weightModifiers: StateWeightModifier[];
  baseDurationHours: number;
  decayRateModifier: number;
  resistanceTraits: Partial<Record<TraitKey, number>>;
  priority: number;
  stackable: boolean;
  conflictGroup?: string;
};

export type StateTrigger =
  | { type: "witnessedAttempt"; kind: AttemptKind; asVictim?: boolean }
  | { type: "beliefGained"; predicate: string }
  | { type: "relationshipChanged"; field: keyof Relationship; direction: "increased" | "decreased" }
  | { type: "needThreshold"; need: NeedKey; op: ">" | "<"; value: number; duration: number }
  | { type: "siteDestroyed"; relationship: "home" | "any" }
  | { type: "npcDied"; relationship: "family" | "highLoyalty" | "any" }
  | { type: "npcCondition"; field: string; op: ">" | "<" | "=" | ">=" | "<="; value: number }
  | { type: "siteCondition"; field: string; op: ">" | "<" | ">=" | "<="; value: number }
  | { type: "startedTravel" }
  | { type: "timeOfDay"; hours: number[] }
  | { type: "repeatedAction"; kind: AttemptKind; count: number; window: number }
  | { type: "awayFromHome"; hours: number }
  | { type: "attemptSucceeded"; kind: AttemptKind }
  | { type: "receivedHelp" }
  | { type: "witnessedEvent"; kind: AttemptKind };

export type StateWeightModifier = {
  actionKind: AttemptKind | "*";
  weightDelta: number;
};

export type ActiveState = {
  definitionId: string;
  startedTick: SimTick;
  expiresAtTick: SimTick;
  intensity: number; // 0..100
  sourceEvent?: string;
};

