import type { ActionDefinition } from "./types";

export const ACTION_DEFINITIONS: ActionDefinition[] = [
  // ============ WORK ACTIONS ============
  {
    kind: "work_farm",
    preconditions: [
      { type: "atSiteKind", kinds: ["settlement"] },
      { type: "hasCategory", categories: ["Farmer"] },
      { type: "notBusy" },
      { type: "notTraveling" }
    ],
    baseWeight: 40,
    needWeights: { Food: 0.5, Duty: 0.3 },
    traitWeights: { Discipline: 0.2 },
    siteConditionWeights: [
      { field: "hunger", op: ">", threshold: 50, weight: 20 },
      { field: "fieldsCondition", op: "<", threshold: 0.5, weight: -15 }
    ],
    beliefWeights: [],
    relationshipWeights: [],
    durationHours: 6,
    visibility: "private",
    magnitude: "normal"
  },
  {
    kind: "work_fish",
    preconditions: [
      { type: "atSiteKind", kinds: ["settlement"] },
      { type: "hasCategory", categories: ["Fisher"] },
      { type: "notBusy" },
      { type: "notTraveling" }
    ],
    baseWeight: 40,
    needWeights: { Food: 0.5, Duty: 0.3 },
    traitWeights: { Discipline: 0.2 },
    siteConditionWeights: [{ field: "hunger", op: ">", threshold: 50, weight: 20 }],
    beliefWeights: [],
    relationshipWeights: [],
    durationHours: 6,
    visibility: "private",
    magnitude: "normal"
  },
  {
    kind: "work_hunt",
    preconditions: [
      { type: "hasCategory", categories: ["HunterTrapper"] },
      { type: "notBusy" },
      { type: "notTraveling" }
    ],
    baseWeight: 35,
    needWeights: { Food: 0.6, Safety: -0.2 },
    traitWeights: { Courage: 0.2, Discipline: 0.1 },
    siteConditionWeights: [{ field: "hunger", op: ">", threshold: 60, weight: 25 }],
    beliefWeights: [],
    relationshipWeights: [],
    durationHours: 6,
    visibility: "private",
    magnitude: "normal"
  },

  // ============ TRADE & ECONOMY ============
  {
    kind: "trade",
    preconditions: [
      { type: "atSiteKind", kinds: ["settlement"] },
      { type: "hasCategory", categories: ["MerchantSmuggler", "Craftsperson"] },
      { type: "notBusy" },
      { type: "notTraveling" }
    ],
    baseWeight: 30,
    needWeights: { Wealth: 0.4, Status: 0.2 },
    traitWeights: { Greed: 0.3, Empathy: 0.1 },
    siteConditionWeights: [
      { field: "hunger", op: "<", threshold: 30, weight: 15 },
      { field: "unrest", op: "<", threshold: 40, weight: 10 }
    ],
    beliefWeights: [],
    relationshipWeights: [{ field: "trust", op: ">", threshold: 50, weight: 10 }],
    durationHours: 2,
    visibility: "public",
    magnitude: "normal"
  },
  {
    kind: "steal",
    preconditions: [
      { type: "atSiteKind", kinds: ["settlement"] },
      { type: "notBusy" },
      { type: "notTraveling" },
      { type: "notDetained" }
    ],
    baseWeight: 5,
    needWeights: { Food: 0.6, Wealth: 0.4, Safety: -0.3 },
    traitWeights: { Integrity: -0.5, Greed: 0.4, Courage: 0.2 },
    siteConditionWeights: [
      { field: "hunger", op: ">", threshold: 70, weight: 30 },
      { field: "unrest", op: ">", threshold: 60, weight: 15 }
    ],
    beliefWeights: [],
    relationshipWeights: [],
    durationHours: 1,
    visibility: "private",
    magnitude: "normal"
  },

  // ============ COMBAT & VIOLENCE ============
  {
    kind: "assault",
    preconditions: [
      { type: "notBusy" },
      { type: "notTraveling" },
      { type: "notDetained" },
      { type: "hasTarget", selector: { type: "anyNpcAtSite", excludeSelf: true } }
    ],
    baseWeight: 5,
    needWeights: { Safety: -0.3 },
    traitWeights: { Aggression: 0.5, Empathy: -0.4, Courage: 0.3 },
    siteConditionWeights: [{ field: "unrest", op: ">", threshold: 70, weight: 20 }],
    beliefWeights: [
      { predicate: "witnessed_crime", weight: 25 },
      { predicate: "threat_to_family", weight: 35 }
    ],
    relationshipWeights: [
      { field: "fear", op: ">", threshold: 70, weight: -20 },
      { field: "trust", op: "<", threshold: 20, weight: 15 }
    ],
    durationHours: 1,
    visibility: "public",
    magnitude: "normal",
    targetSelector: { type: "anyNpcAtSite", excludeSelf: true }
  },
  {
    kind: "kill",
    preconditions: [
      { type: "notBusy" },
      { type: "notTraveling" },
      { type: "notDetained" },
      { type: "hasTarget", selector: { type: "anyNpcAtSite", excludeSelf: true } }
    ],
    baseWeight: 0,
    needWeights: {},
    traitWeights: { Aggression: 0.6, Empathy: -0.6, Integrity: -0.4 },
    siteConditionWeights: [],
    beliefWeights: [
      { predicate: "threat_to_family", weight: 50 },
      { predicate: "murdered_family", weight: 60 }
    ],
    relationshipWeights: [{ field: "trust", op: "<", threshold: 10, weight: 20 }],
    durationHours: 1,
    visibility: "public",
    magnitude: "major",
    targetSelector: { type: "anyNpcAtSite", excludeSelf: true }
  },
  {
    kind: "raid",
    preconditions: [
      { type: "atSiteKind", kinds: ["settlement"] },
      { type: "hasCategory", categories: ["BanditRaider"] },
      { type: "notBusy" },
      { type: "notTraveling" },
      { type: "notDetained" }
    ],
    baseWeight: 15,
    needWeights: { Food: 0.5, Wealth: 0.4 },
    traitWeights: { Aggression: 0.4, Greed: 0.3, Empathy: -0.3 },
    siteConditionWeights: [
      { field: "hunger", op: ">", threshold: 60, weight: 25 },
      { field: "unrest", op: ">", threshold: 50, weight: 15 }
    ],
    beliefWeights: [],
    relationshipWeights: [],
    durationHours: 3,
    visibility: "public",
    magnitude: "major"
  },

  // ============ LAW & ORDER ============
  {
    kind: "patrol",
    preconditions: [
      {
        type: "hasCategory",
        categories: ["GuardMilitia", "ScoutRanger", "Threadwarden", "ConcordEnforcer", "ElvenWarriorSentinel"]
      },
      { type: "notBusy" },
      { type: "notTraveling" }
    ],
    baseWeight: 35,
    needWeights: { Duty: 0.5, Safety: 0.2 },
    traitWeights: { Discipline: 0.3, Courage: 0.2 },
    siteConditionWeights: [
      { field: "unrest", op: ">", threshold: 40, weight: 20 },
      { field: "eclipsingPressure", op: ">", threshold: 50, weight: 15 }
    ],
    beliefWeights: [{ predicate: "cult_activity_nearby", weight: 20 }],
    relationshipWeights: [],
    durationHours: 2,
    visibility: "public",
    magnitude: "normal"
  },
  {
    kind: "investigate",
    preconditions: [
      { type: "hasCategory", categories: ["GuardMilitia", "ScoutRanger", "Threadwarden", "LocalLeader"] },
      { type: "notBusy" },
      { type: "notTraveling" }
    ],
    baseWeight: 20,
    needWeights: { Duty: 0.4 },
    traitWeights: { Curiosity: 0.4, Suspicion: 0.3, Discipline: 0.2 },
    siteConditionWeights: [
      { field: "cultInfluence", op: ">", threshold: 25, weight: 25 },
      { field: "unrest", op: ">", threshold: 50, weight: 15 }
    ],
    beliefWeights: [
      { predicate: "cult_activity_nearby", weight: 30 },
      { predicate: "witnessed_crime", weight: 25 }
    ],
    relationshipWeights: [],
    durationHours: 2,
    visibility: "public",
    magnitude: "normal"
  },
  {
    kind: "arrest",
    preconditions: [
      { type: "hasCategory", categories: ["GuardMilitia", "Threadwarden", "ConcordEnforcer"] },
      { type: "notBusy" },
      { type: "notTraveling" },
      { type: "hasTarget", selector: { type: "cultMemberAtSite" } }
    ],
    baseWeight: 25,
    needWeights: { Duty: 0.5 },
    traitWeights: { Discipline: 0.3, Courage: 0.3, Empathy: -0.2 },
    siteConditionWeights: [{ field: "cultInfluence", op: ">", threshold: 60, weight: 30 }],
    beliefWeights: [{ predicate: "cult_activity_nearby", weight: 25 }],
    relationshipWeights: [],
    durationHours: 2,
    visibility: "public",
    magnitude: "normal",
    targetSelector: { type: "cultMemberAtSite" }
  },

  // ============ HEALING & SUPPORT ============
  {
    kind: "heal",
    preconditions: [
      { type: "hasCategory", categories: ["HealerHedgeMage", "AnchorMage"] },
      { type: "notBusy" },
      { type: "notTraveling" }
    ],
    baseWeight: 30,
    needWeights: { Health: 0.3, Duty: 0.3 },
    traitWeights: { Empathy: 0.4, Discipline: 0.2 },
    siteConditionWeights: [{ field: "sickness", op: ">", threshold: 40, weight: 25 }],
    beliefWeights: [],
    relationshipWeights: [{ field: "loyalty", op: ">", threshold: 60, weight: 15 }],
    durationHours: 2,
    visibility: "public",
    magnitude: "normal"
  },

  // ============ CULT ACTIONS ============
  {
    kind: "preach_fixed_path",
    preconditions: [
      { type: "atSiteKind", kinds: ["settlement"] },
      { type: "hasCultRole", roles: ["devotee", "cell_leader"] },
      { type: "notBusy" },
      { type: "notTraveling" },
      { type: "notDetained" }
    ],
    baseWeight: 35,
    needWeights: { Meaning: 0.5, Status: 0.2 },
    traitWeights: { Ambition: 0.3, Empathy: 0.2 },
    siteConditionWeights: [
      { field: "eclipsingPressure", op: ">", threshold: 40, weight: 20 },
      { field: "anchoringStrength", op: "<", threshold: 50, weight: 15 }
    ],
    beliefWeights: [{ predicate: "divine_sign", weight: 25 }],
    relationshipWeights: [],
    durationHours: 2,
    visibility: "public",
    magnitude: "normal"
  },
  {
    kind: "kidnap",
    preconditions: [
      { type: "atSiteKind", kinds: ["settlement"] },
      { type: "hasCultRole", roles: ["devotee", "cell_leader", "enforcer"] },
      { type: "notBusy" },
      { type: "notTraveling" },
      { type: "notDetained" },
      { type: "hasTarget", selector: { type: "nonCultMemberAtSite" } },
      { type: "siteCondition", field: "eclipsingPressure", op: ">=", value: 50 },
      { type: "siteCondition", field: "anchoringStrength", op: "<=", value: 50 }
    ],
    baseWeight: 10,
    needWeights: { Meaning: 0.4 },
    traitWeights: { Aggression: 0.3, Empathy: -0.4, Ambition: 0.3 },
    siteConditionWeights: [
      { field: "eclipsingPressure", op: ">", threshold: 60, weight: 20 },
      { field: "cultInfluence", op: ">", threshold: 50, weight: 15 }
    ],
    beliefWeights: [],
    relationshipWeights: [{ field: "trust", op: "<", threshold: 30, weight: 10 }],
    durationHours: 2,
    visibility: "private",
    magnitude: "normal",
    targetSelector: { type: "nonCultMemberAtSite" }
  },
  {
    kind: "forced_eclipse",
    preconditions: [
      { type: "hasCultRole", roles: ["cell_leader"] },
      { type: "notBusy" },
      { type: "notTraveling" },
      { type: "hasTarget", selector: { type: "detainedAtSite" } },
      { type: "siteCondition", field: "eclipsingPressure", op: ">=", value: 55 },
      { type: "siteCondition", field: "anchoringStrength", op: "<=", value: 45 }
    ],
    baseWeight: 20,
    needWeights: { Meaning: 0.5 },
    traitWeights: { Ambition: 0.4, Empathy: -0.5 },
    siteConditionWeights: [{ field: "eclipsingPressure", op: ">", threshold: 70, weight: 25 }],
    beliefWeights: [{ predicate: "divine_sign", weight: 30 }],
    relationshipWeights: [],
    durationHours: 6,
    visibility: "private",
    magnitude: "major",
    targetSelector: { type: "detainedAtSite" }
  },

  // ============ ANTI-CULT ACTIONS ============
  {
    kind: "anchor_sever",
    preconditions: [
      { type: "hasCategory", categories: ["AnchorMage", "Threadwarden"] },
      { type: "notBusy" },
      { type: "notTraveling" },
      { type: "hasTarget", selector: { type: "eclipsingReversible" } }
    ],
    baseWeight: 40,
    needWeights: { Duty: 0.6 },
    traitWeights: { Discipline: 0.3, Courage: 0.3, Empathy: 0.2 },
    siteConditionWeights: [],
    beliefWeights: [{ predicate: "cult_activity_nearby", weight: 20 }],
    relationshipWeights: [{ field: "loyalty", op: ">", threshold: 50, weight: 15 }],
    durationHours: 2,
    visibility: "public",
    magnitude: "major",
    targetSelector: { type: "eclipsingReversible" }
  },

  // ============ MOVEMENT ============
  {
    kind: "travel",
    preconditions: [{ type: "notBusy" }, { type: "notTraveling" }, { type: "notDetained" }],
    baseWeight: 15,
    needWeights: { Safety: 0.4, Freedom: 0.3 },
    traitWeights: { Curiosity: 0.3, Courage: 0.2 },
    siteConditionWeights: [
      { field: "unrest", op: ">", threshold: 70, weight: 30 },
      { field: "hunger", op: ">", threshold: 80, weight: 25 },
      { field: "eclipsingPressure", op: ">", threshold: 70, weight: 20 }
    ],
    beliefWeights: [
      { predicate: "threat_to_family", weight: 25 },
      { predicate: "discovered_location", weight: 15 }
    ],
    relationshipWeights: [],
    durationHours: 1,
    visibility: "public",
    magnitude: "normal"
  }
];


