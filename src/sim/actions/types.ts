import type {
  AttemptKind,
  AttemptMagnitude,
  AttemptVisibility,
  NeedKey,
  NpcCategory,
  NpcState,
  Relationship,
  SettlementSiteState,
  SiteKind
} from "../types";

export type ActionDefinition = {
  kind: AttemptKind;
  preconditions: ActionPrecondition[];
  baseWeight: number; // 0..100 baseline

  needWeights: Partial<Record<NeedKey, number>>;
  traitWeights: Partial<Record<keyof NpcState["traits"], number>>;
  siteConditionWeights: SiteConditionWeight[];
  beliefWeights: BeliefWeight[];
  relationshipWeights: RelationshipWeight[];

  durationHours: number;
  visibility: AttemptVisibility;
  magnitude: AttemptMagnitude;

  targetSelector?: TargetSelector;
};

export type ActionPrecondition =
  | { type: "atSiteKind"; kinds: SiteKind[] }
  | { type: "hasCategory"; categories: NpcCategory[] }
  | { type: "hasCultRole"; roles: NpcState["cult"]["role"][] }
  | { type: "siteCondition"; field: string; op: ">" | "<" | ">=" | "<="; value: number }
  | { type: "npcCondition"; field: string; op: ">" | "<" | ">=" | "<="; value: number }
  | { type: "hasTarget"; selector: TargetSelector }
  | { type: "notBusy" }
  | { type: "notTraveling" }
  | { type: "notDetained" };

export type TargetSelector =
  | { type: "cultMemberAtSite" }
  | { type: "nonCultMemberAtSite" }
  | { type: "detainedAtSite" }
  | { type: "eclipsingReversible" }
  | { type: "lowTrustNpc"; threshold: number }
  | { type: "highFearNpc"; threshold: number }
  | { type: "beliefSubject"; predicate: string }
  | { type: "anyNpcAtSite"; excludeSelf: boolean };

export type SiteConditionWeight = {
  field: keyof SettlementSiteState;
  op: ">" | "<" | ">=" | "<=";
  threshold: number;
  weight: number;
};

export type BeliefWeight = {
  predicate: string;
  weight: number;
};

export type RelationshipWeight = {
  field: keyof Relationship;
  op: ">" | "<";
  threshold: number;
  weight: number;
};


