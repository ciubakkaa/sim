import type { AttemptKind, NpcCategory, TraitKey } from "../types";

export type ProficiencyDomain =
  | "combat"
  | "stealth"
  | "trade"
  | "farming"
  | "healing"
  | "leadership"
  | "investigation"
  | "ritual";

export type CategoryTransition = {
  from: NpcCategory[];
  to: NpcCategory;
  proficiencyRequirements: Partial<Record<ProficiencyDomain, number>>;
  traitRequirements: Partial<Record<TraitKey, { min?: number; max?: number }>>;
  circumstances: TransitionCircumstance[];
};

export type TransitionCircumstance =
  | { type: "siteUnrest"; op: ">" | "<"; value: number }
  | { type: "prolongedState"; stateId: string; hours: number }
  | { type: "repeatedAction"; kind: AttemptKind; count: number }
  | { type: "cultInfluence"; op: ">" | "<"; value: number };


