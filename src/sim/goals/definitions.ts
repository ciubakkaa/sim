import type { GoalDefinition } from "./types";

/**
 * Goals v1: curated catalog for big arcs + a few reusable short-term goal templates.
 * Keep these simple; v1 uses them primarily as scoring weight modifiers + rationale tags.
 */
export const GOAL_DEFINITIONS: GoalDefinition[] = [
  {
    id: "MakeLiving",
    name: "Make a living",
    triggers: [
      { type: "categoryIs", category: "Farmer" },
      { type: "categoryIs", category: "Fisher" },
      { type: "categoryIs", category: "HunterTrapper" },
      { type: "categoryIs", category: "Craftsperson" }
    ],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 50,
    weightModifiers: [
      { goalId: "MakeLiving", actionKind: "work_farm", weightDelta: 25 },
      { goalId: "MakeLiving", actionKind: "work_fish", weightDelta: 25 },
      { goalId: "MakeLiving", actionKind: "work_hunt", weightDelta: 25 },
      { goalId: "MakeLiving", actionKind: "trade", weightDelta: 10 }
    ],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "ProvideForFamily",
    name: "Provide for family",
    triggers: [{ type: "hasFamily", minCount: 1 }],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 60,
    weightModifiers: [
      { goalId: "ProvideForFamily", actionKind: "work_farm", weightDelta: 25 },
      { goalId: "ProvideForFamily", actionKind: "work_fish", weightDelta: 25 },
      { goalId: "ProvideForFamily", actionKind: "work_hunt", weightDelta: 20 },
      { goalId: "ProvideForFamily", actionKind: "trade", weightDelta: 12 },
      { goalId: "ProvideForFamily", actionKind: "travel", weightDelta: 8 }
    ],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "RiseInRank",
    name: "Rise in rank",
    triggers: [{ type: "categoryIs", category: "GuardMilitia" }],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 55,
    weightModifiers: [
      { goalId: "RiseInRank", actionKind: "patrol", weightDelta: 25 },
      { goalId: "RiseInRank", actionKind: "investigate", weightDelta: 18 },
      { goalId: "RiseInRank", actionKind: "arrest", weightDelta: 15 }
    ],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "MaintainOrder",
    name: "Maintain order",
    triggers: [{ type: "categoryIs", category: "GuardMilitia" }],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 65,
    weightModifiers: [
      { goalId: "MaintainOrder", actionKind: "patrol", weightDelta: 30 },
      { goalId: "MaintainOrder", actionKind: "investigate", weightDelta: 18 },
      { goalId: "MaintainOrder", actionKind: "arrest", weightDelta: 14 },
      { goalId: "MaintainOrder", actionKind: "travel", weightDelta: 6 }
    ],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "GainWealth",
    name: "Gain wealth",
    triggers: [
      { type: "categoryIs", category: "MerchantSmuggler" },
      { type: "categoryIs", category: "Craftsperson" }
    ],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 55,
    weightModifiers: [
      { goalId: "GainWealth", actionKind: "trade", weightDelta: 30 },
      { goalId: "GainWealth", actionKind: "work_farm", weightDelta: 10 },
      { goalId: "GainWealth", actionKind: "work_fish", weightDelta: 10 },
      { goalId: "GainWealth", actionKind: "work_hunt", weightDelta: 10 }
    ],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "SelfPreservation",
    name: "Self-preservation",
    triggers: [{ type: "needProlonged", need: "Safety", threshold: 60, hours: 6 }],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 80,
    weightModifiers: [{ goalId: "SelfPreservation", actionKind: "travel", weightDelta: 40 }],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "SeekKnowledge",
    name: "Seek knowledge",
    triggers: [{ type: "categoryIs", category: "ContinuumScholar" }],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 55,
    weightModifiers: [{ goalId: "SeekKnowledge", actionKind: "investigate", weightDelta: 18 }],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "HelpOthers",
    name: "Help others",
    triggers: [{ type: "categoryIs", category: "HealerHedgeMage" }],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 60,
    weightModifiers: [{ goalId: "HelpOthers", actionKind: "heal", weightDelta: 35 }],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "ProtectCommunity",
    name: "Protect community",
    triggers: [
      { type: "categoryIs", category: "ScoutRanger" },
      { type: "categoryIs", category: "ElvenWarriorSentinel" },
      { type: "categoryIs", category: "Threadwarden" },
      { type: "categoryIs", category: "AnchorMage" }
    ],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 60,
    weightModifiers: [
      { goalId: "ProtectCommunity", actionKind: "patrol", weightDelta: 25 },
      { goalId: "ProtectCommunity", actionKind: "investigate", weightDelta: 12 },
      { goalId: "ProtectCommunity", actionKind: "travel", weightDelta: 10 }
    ],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "Predation",
    name: "Predation",
    triggers: [{ type: "categoryIs", category: "BanditRaider" }],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 65,
    weightModifiers: [
      { goalId: "Predation", actionKind: "steal", weightDelta: 25 },
      { goalId: "Predation", actionKind: "raid", weightDelta: 22 },
      { goalId: "Predation", actionKind: "travel", weightDelta: 10 }
    ],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "ServeCult",
    name: "Serve the cult",
    triggers: [{ type: "cultMember", member: true }],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 70,
    weightModifiers: [
      { goalId: "ServeCult", actionKind: "preach_fixed_path", weightDelta: 30 },
      { goalId: "ServeCult", actionKind: "kidnap", weightDelta: 15 },
      { goalId: "ServeCult", actionKind: "forced_eclipse", weightDelta: 18 }
    ],
    successConditions: [],
    failureConditions: []
  },
  {
    id: "SocialBelonging",
    name: "Strengthen belonging",
    triggers: [{ type: "needProlonged", need: "Belonging", threshold: 55, hours: 6 }],
    traitRequirements: {},
    traitFormationBonus: {},
    basePriority: 45,
    weightModifiers: [{ goalId: "SocialBelonging", actionKind: "travel", weightDelta: 20 }],
    successConditions: [],
    failureConditions: []
  }
];


