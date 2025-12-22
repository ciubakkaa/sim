import type { Belief, DeathCause, FoodType, NpcId, NpcState, Relationship, SiteId, SiteRumor, SiteState, SimTick } from "../types";

export type NpcPatch = {
  kind: "npc.patch";
  npcId: NpcId;
  patch: Partial<NpcState>;
};

export type NpcNumberDelta = {
  kind: "npc.number.delta";
  npcId: NpcId;
  key: "hp" | "trauma" | "notability";
  delta: number;
};

export type NpcBeliefAdd = {
  kind: "npc.belief.add";
  npcId: NpcId;
  belief: Belief;
};

export type NpcRelationshipDelta = {
  kind: "npc.relationship.delta";
  npcId: NpcId;
  otherNpcId: NpcId;
  delta: Partial<Relationship>;
  confidence: number; // 0..100
};

export type SitePatch = {
  kind: "site.patch";
  siteId: SiteId;
  patch: Partial<SiteState>;
};

export type NpcKilled = {
  kind: "npc.killed";
  npcId: NpcId;
  tick: SimTick;
  cause: DeathCause;
  byNpcId?: NpcId;
  atSiteId?: SiteId;
};

export type FoodTake = {
  kind: "site.food.take";
  siteId: SiteId;
  foodType: FoodType;
  amount: number;
  takeFrom: "newest" | "oldest";
};

export type SiteRumorAdd = {
  kind: "site.rumor.add";
  siteId: SiteId;
  rumor: SiteRumor;
};

export type AttemptConsequence =
  | NpcPatch
  | NpcNumberDelta
  | NpcBeliefAdd
  | NpcRelationshipDelta
  | SitePatch
  | NpcKilled
  | FoodTake
  | SiteRumorAdd;


