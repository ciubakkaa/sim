import type { AttemptKind, NeedKey, NpcCategory, NpcId, Relationship, SimTick, SiteId, TraitKey } from "../types";

export type GoalDefinition = {
  id: string;
  name: string;
  triggers: GoalTrigger[];
  traitRequirements: Partial<Record<TraitKey, { min?: number; max?: number }>>;
  traitFormationBonus: Partial<Record<TraitKey, number>>;
  weightModifiers: GoalWeightModifier[];
  successConditions: GoalCondition[];
  failureConditions: GoalCondition[];
  basePriority: number;
};

export type GoalTrigger =
  | { type: "beliefAbout"; predicate: string; confidence: number }
  | { type: "needProlonged"; need: NeedKey; threshold: number; hours: number }
  | { type: "relationshipWith"; field: keyof Relationship; op: ">" | "<"; value: number }
  | { type: "witnessedEvent"; kind: AttemptKind }
  | { type: "stateActive"; stateId: string }
  | { type: "categoryIs"; category: NpcCategory }
  | { type: "cultMember"; member: boolean }
  | { type: "hasFamily"; minCount: number }
  | { type: "familyAtSameSite"; minCount: number };

export type GoalCondition =
  | { type: "targetDead"; targetField: string }
  | { type: "targetAtSite"; targetField: string }
  | { type: "needBelow"; need: NeedKey; value: number }
  | { type: "beliefCleared"; predicate: string }
  | { type: "ticksPassed"; ticks: number }
  | { type: "atSaferSite" }
  | { type: "hasNewHome" }
  | { type: "categoryIs"; category: NpcCategory }
  | { type: "siteCondition"; field: string; op: "<" | ">"; value: number }
  | { type: "needThreshold"; need: NeedKey; op: ">" | "<"; value: number };

export type GoalWeightModifier = {
  goalId: string;
  actionKind: AttemptKind;
  weightDelta: number;
  requiresTarget?: boolean;
};

export type ActiveGoal = {
  definitionId: string;
  formedTick: SimTick;
  targetNpcId?: NpcId;
  targetSiteId?: SiteId;
  priority: number;
  data: Record<string, unknown>;
};


