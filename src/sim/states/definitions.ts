import type { ReactiveStateDefinition } from "./types";

export const STATE_DEFINITIONS: ReactiveStateDefinition[] = [
  // ============ NEGATIVE STATES ============
  {
    id: "grieving",
    name: "Grieving",
    triggers: [
      { type: "npcDied", relationship: "family" },
      { type: "npcDied", relationship: "highLoyalty" }
    ],
    weightModifiers: [
      { actionKind: "work_farm", weightDelta: -30 },
      { actionKind: "work_fish", weightDelta: -30 },
      { actionKind: "work_hunt", weightDelta: -30 },
      { actionKind: "trade", weightDelta: -20 },
      { actionKind: "travel", weightDelta: -15 },
      { actionKind: "*", weightDelta: -10 }
    ],
    baseDurationHours: 168,
    decayRateModifier: 0.5,
    resistanceTraits: { Discipline: 0.3 },
    priority: 10,
    stackable: false
  },
  {
    id: "vengeful",
    name: "Vengeful",
    triggers: [
      { type: "witnessedAttempt", kind: "kill", asVictim: false },
      { type: "witnessedAttempt", kind: "assault", asVictim: true }
    ],
    weightModifiers: [
      { actionKind: "assault", weightDelta: 40 },
      { actionKind: "kill", weightDelta: 30 },
      { actionKind: "investigate", weightDelta: 20 }
    ],
    baseDurationHours: 72,
    decayRateModifier: 0.8,
    resistanceTraits: { Empathy: 0.4, Discipline: 0.2 },
    priority: 20,
    stackable: false,
    conflictGroup: "emotional_response"
  },
  {
    id: "fearful",
    name: "Fearful",
    triggers: [
      { type: "witnessedAttempt", kind: "kill", asVictim: false },
      { type: "witnessedAttempt", kind: "raid", asVictim: false },
      { type: "siteDestroyed", relationship: "any" }
    ],
    weightModifiers: [
      { actionKind: "travel", weightDelta: 30 },
      { actionKind: "assault", weightDelta: -40 },
      { actionKind: "investigate", weightDelta: -20 },
      { actionKind: "patrol", weightDelta: -15 }
    ],
    baseDurationHours: 48,
    decayRateModifier: 1.0,
    resistanceTraits: { Courage: 0.5 },
    priority: 15,
    stackable: false,
    conflictGroup: "emotional_response"
  },
  {
    id: "displaced",
    name: "Displaced",
    triggers: [{ type: "siteDestroyed", relationship: "home" }],
    weightModifiers: [
      { actionKind: "travel", weightDelta: 50 },
      { actionKind: "*", weightDelta: -20 }
    ],
    baseDurationHours: 336,
    decayRateModifier: 0.3,
    resistanceTraits: {},
    priority: 25,
    stackable: false
  },
  {
    id: "paranoid",
    name: "Paranoid",
    triggers: [
      { type: "witnessedAttempt", kind: "kidnap", asVictim: false },
      { type: "beliefGained", predicate: "cult_activity_nearby" },
      { type: "needThreshold", need: "Safety", op: ">", value: 80, duration: 48 }
    ],
    weightModifiers: [
      { actionKind: "investigate", weightDelta: 35 },
      { actionKind: "patrol", weightDelta: 25 },
      { actionKind: "trade", weightDelta: -30 },
      { actionKind: "travel", weightDelta: -20 }
    ],
    baseDurationHours: 96,
    decayRateModifier: 0.7,
    resistanceTraits: { Courage: 0.3, Empathy: 0.2 },
    priority: 12,
    stackable: false
  },
  {
    id: "wounded",
    name: "Wounded",
    triggers: [{ type: "npcCondition", field: "hp", op: "<", value: 50 }],
    weightModifiers: [
      { actionKind: "heal", weightDelta: 40 },
      { actionKind: "assault", weightDelta: -50 },
      { actionKind: "kill", weightDelta: -50 },
      { actionKind: "raid", weightDelta: -40 },
      { actionKind: "work_farm", weightDelta: -20 },
      { actionKind: "work_hunt", weightDelta: -30 },
      { actionKind: "travel", weightDelta: -15 }
    ],
    baseDurationHours: 72,
    decayRateModifier: 0.5,
    resistanceTraits: { Discipline: 0.2 },
    priority: 30,
    stackable: false
  },
  {
    id: "desperate",
    name: "Desperate",
    triggers: [
      { type: "needThreshold", need: "Food", op: ">", value: 85, duration: 24 },
      { type: "needThreshold", need: "Safety", op: ">", value: 90, duration: 12 }
    ],
    weightModifiers: [
      { actionKind: "steal", weightDelta: 50 },
      { actionKind: "raid", weightDelta: 40 },
      { actionKind: "assault", weightDelta: 20 },
      { actionKind: "*", weightDelta: 10 }
    ],
    baseDurationHours: 24,
    decayRateModifier: 1.5,
    resistanceTraits: { Integrity: 0.4, Discipline: 0.2 },
    priority: 35,
    stackable: false,
    conflictGroup: "survival_mode"
  },
  {
    id: "humiliated",
    name: "Humiliated",
    triggers: [
      { type: "witnessedAttempt", kind: "steal", asVictim: true },
      { type: "witnessedAttempt", kind: "arrest", asVictim: true }
    ],
    weightModifiers: [
      { actionKind: "travel", weightDelta: 25 },
      { actionKind: "trade", weightDelta: -30 },
      { actionKind: "preach_fixed_path", weightDelta: -40 }
    ],
    baseDurationHours: 48,
    decayRateModifier: 1.0,
    resistanceTraits: { Courage: 0.3 },
    priority: 8,
    stackable: false
  },
  {
    id: "suspicious",
    name: "Suspicious",
    triggers: [
      { type: "beliefGained", predicate: "witnessed_crime" },
      { type: "relationshipChanged", field: "trust", direction: "decreased" }
    ],
    weightModifiers: [
      { actionKind: "investigate", weightDelta: 25 },
      { actionKind: "trade", weightDelta: -15 },
      { actionKind: "patrol", weightDelta: 15 }
    ],
    baseDurationHours: 72,
    decayRateModifier: 1.0,
    resistanceTraits: { Empathy: 0.3 },
    priority: 6,
    stackable: true
  },

  // ============ NEUTRAL STATES ============
  {
    id: "traveling",
    name: "On Journey",
    triggers: [{ type: "startedTravel" }],
    weightModifiers: [
      { actionKind: "work_farm", weightDelta: -100 },
      { actionKind: "work_fish", weightDelta: -100 },
      { actionKind: "work_hunt", weightDelta: -20 },
      { actionKind: "trade", weightDelta: -50 }
    ],
    baseDurationHours: 0,
    decayRateModifier: 0,
    resistanceTraits: {},
    priority: 50,
    stackable: false
  },
  {
    id: "resting",
    name: "Resting",
    triggers: [
      { type: "needThreshold", need: "Health", op: ">", value: 60, duration: 8 },
      { type: "timeOfDay", hours: [22, 23, 0, 1, 2, 3, 4, 5] }
    ],
    weightModifiers: [
      { actionKind: "*", weightDelta: -30 },
      { actionKind: "heal", weightDelta: 20 }
    ],
    baseDurationHours: 8,
    decayRateModifier: 2.0,
    resistanceTraits: { Discipline: 0.5 },
    priority: 5,
    stackable: false
  },
  {
    id: "curious",
    name: "Curious",
    triggers: [
      { type: "beliefGained", predicate: "discovered_location" },
      { type: "beliefGained", predicate: "heard_rumor" }
    ],
    weightModifiers: [
      { actionKind: "investigate", weightDelta: 30 },
      { actionKind: "travel", weightDelta: 25 },
      { actionKind: "trade", weightDelta: 15 }
    ],
    baseDurationHours: 48,
    decayRateModifier: 1.2,
    resistanceTraits: {},
    priority: 4,
    stackable: false
  },
  {
    id: "focused",
    name: "Focused",
    triggers: [
      { type: "repeatedAction", kind: "work_farm", count: 3, window: 24 },
      { type: "repeatedAction", kind: "work_fish", count: 3, window: 24 },
      { type: "repeatedAction", kind: "investigate", count: 2, window: 12 }
    ],
    weightModifiers: [{ actionKind: "travel", weightDelta: -20 }],
    baseDurationHours: 12,
    decayRateModifier: 1.5,
    resistanceTraits: {},
    priority: 7,
    stackable: false,
    conflictGroup: "energy_level"
  },
  {
    id: "homesick",
    name: "Homesick",
    triggers: [{ type: "awayFromHome", hours: 72 }],
    weightModifiers: [
      { actionKind: "travel", weightDelta: 35 },
      { actionKind: "*", weightDelta: -10 }
    ],
    baseDurationHours: 168,
    decayRateModifier: 0.3,
    resistanceTraits: { Curiosity: 0.3, Ambition: 0.2 },
    priority: 15,
    stackable: false
  },
  {
    id: "watchful",
    name: "Watchful",
    triggers: [
      { type: "siteCondition", field: "unrest", op: ">", value: 40 },
      { type: "siteCondition", field: "eclipsingPressure", op: ">", value: 50 }
    ],
    weightModifiers: [
      { actionKind: "patrol", weightDelta: 20 },
      { actionKind: "investigate", weightDelta: 15 },
      { actionKind: "work_farm", weightDelta: -10 },
      { actionKind: "work_fish", weightDelta: -10 }
    ],
    baseDurationHours: 24,
    decayRateModifier: 1.0,
    resistanceTraits: {},
    priority: 10,
    stackable: false
  },

  // ============ POSITIVE STATES ============
  {
    id: "inspired",
    name: "Inspired",
    triggers: [
      { type: "witnessedAttempt", kind: "heal", asVictim: true },
      { type: "beliefGained", predicate: "heroic_act" },
      { type: "relationshipChanged", field: "loyalty", direction: "increased" }
    ],
    weightModifiers: [
      { actionKind: "work_farm", weightDelta: 25 },
      { actionKind: "work_fish", weightDelta: 25 },
      { actionKind: "work_hunt", weightDelta: 25 },
      { actionKind: "heal", weightDelta: 30 },
      { actionKind: "patrol", weightDelta: 20 }
    ],
    baseDurationHours: 48,
    decayRateModifier: 1.2,
    resistanceTraits: {},
    priority: 8,
    stackable: false,
    conflictGroup: "energy_level"
  },
  {
    id: "grateful",
    name: "Grateful",
    triggers: [
      { type: "witnessedAttempt", kind: "heal", asVictim: true },
      { type: "receivedHelp" }
    ],
    weightModifiers: [
      { actionKind: "trade", weightDelta: 30 },
      { actionKind: "heal", weightDelta: 25 },
      { actionKind: "assault", weightDelta: -20 },
      { actionKind: "steal", weightDelta: -40 }
    ],
    baseDurationHours: 72,
    decayRateModifier: 0.8,
    resistanceTraits: {},
    priority: 6,
    stackable: true,
    conflictGroup: "social_mood"
  },
  {
    id: "confident",
    name: "Confident",
    triggers: [
      { type: "attemptSucceeded", kind: "assault" },
      { type: "attemptSucceeded", kind: "arrest" },
      { type: "attemptSucceeded", kind: "investigate" }
    ],
    weightModifiers: [
      { actionKind: "assault", weightDelta: 15 },
      { actionKind: "investigate", weightDelta: 20 },
      { actionKind: "arrest", weightDelta: 20 },
      { actionKind: "patrol", weightDelta: 15 },
      { actionKind: "travel", weightDelta: 10 }
    ],
    baseDurationHours: 24,
    decayRateModifier: 1.5,
    resistanceTraits: {},
    priority: 5,
    stackable: false
  },
  {
    id: "zealous",
    name: "Zealous",
    triggers: [
      { type: "attemptSucceeded", kind: "preach_fixed_path" },
      { type: "beliefGained", predicate: "divine_sign" }
    ],
    weightModifiers: [
      { actionKind: "preach_fixed_path", weightDelta: 40 },
      { actionKind: "kidnap", weightDelta: 25 },
      { actionKind: "forced_eclipse", weightDelta: 20 },
      { actionKind: "work_farm", weightDelta: -20 },
      { actionKind: "trade", weightDelta: -15 }
    ],
    baseDurationHours: 48,
    decayRateModifier: 0.7,
    resistanceTraits: { Empathy: 0.3, Curiosity: 0.2 },
    priority: 18,
    stackable: false
  },
  {
    id: "protective",
    name: "Protective",
    triggers: [
      { type: "npcCondition", field: "familyNearby", op: "=", value: 1 },
      { type: "beliefGained", predicate: "threat_to_family" }
    ],
    weightModifiers: [
      { actionKind: "patrol", weightDelta: 35 },
      { actionKind: "assault", weightDelta: 25 },
      { actionKind: "investigate", weightDelta: 20 },
      { actionKind: "travel", weightDelta: -30 }
    ],
    baseDurationHours: 72,
    decayRateModifier: 0.6,
    resistanceTraits: {},
    priority: 22,
    stackable: false
  },
  {
    id: "prosperous",
    name: "Prosperous",
    triggers: [
      { type: "siteCondition", field: "hunger", op: "<", value: 20 },
      { type: "attemptSucceeded", kind: "trade" }
    ],
    weightModifiers: [
      { actionKind: "trade", weightDelta: 25 },
      { actionKind: "travel", weightDelta: 15 },
      { actionKind: "steal", weightDelta: -30 },
      { actionKind: "raid", weightDelta: -30 }
    ],
    baseDurationHours: 48,
    decayRateModifier: 1.0,
    resistanceTraits: { Greed: -0.3 },
    priority: 4,
    stackable: false,
    conflictGroup: "survival_mode"
  },
  {
    id: "resolute",
    name: "Resolute",
    triggers: [
      { type: "attemptSucceeded", kind: "anchor_sever" },
      { type: "beliefGained", predicate: "resisted_eclipsing" }
    ],
    weightModifiers: [
      { actionKind: "anchor_sever", weightDelta: 30 },
      { actionKind: "investigate", weightDelta: 25 },
      { actionKind: "patrol", weightDelta: 20 },
      { actionKind: "preach_fixed_path", weightDelta: -40 }
    ],
    baseDurationHours: 96,
    decayRateModifier: 0.5,
    resistanceTraits: {},
    priority: 16,
    stackable: false
  },
  {
    id: "bonded",
    name: "Bonded",
    triggers: [
      { type: "relationshipChanged", field: "trust", direction: "increased" },
      { type: "relationshipChanged", field: "loyalty", direction: "increased" }
    ],
    weightModifiers: [
      { actionKind: "trade", weightDelta: 20 },
      { actionKind: "heal", weightDelta: 15 },
      { actionKind: "assault", weightDelta: -15 },
      { actionKind: "steal", weightDelta: -25 }
    ],
    baseDurationHours: 72,
    decayRateModifier: 0.8,
    resistanceTraits: {},
    priority: 5,
    stackable: true,
    conflictGroup: "social_mood"
  },
  {
    id: "triumphant",
    name: "Triumphant",
    triggers: [
      { type: "attemptSucceeded", kind: "raid" },
      { type: "attemptSucceeded", kind: "kill" }
    ],
    weightModifiers: [
      { actionKind: "raid", weightDelta: 30 },
      { actionKind: "assault", weightDelta: 25 },
      { actionKind: "steal", weightDelta: 20 },
      { actionKind: "work_farm", weightDelta: -25 }
    ],
    baseDurationHours: 24,
    decayRateModifier: 1.5,
    resistanceTraits: { Empathy: 0.4 },
    priority: 12,
    stackable: false
  },
  {
    id: "dutiful",
    name: "Dutiful",
    triggers: [
      { type: "siteCondition", field: "unrest", op: ">", value: 50 },
      { type: "beliefGained", predicate: "community_in_need" }
    ],
    weightModifiers: [
      { actionKind: "patrol", weightDelta: 30 },
      { actionKind: "work_farm", weightDelta: 25 },
      { actionKind: "work_fish", weightDelta: 25 },
      { actionKind: "heal", weightDelta: 20 },
      { actionKind: "travel", weightDelta: -20 }
    ],
    baseDurationHours: 72,
    decayRateModifier: 0.7,
    resistanceTraits: { Greed: -0.2 },
    priority: 14,
    stackable: false
  },
  {
    id: "hopeful",
    name: "Hopeful",
    triggers: [
      { type: "siteCondition", field: "morale", op: ">", value: 70 },
      { type: "beliefGained", predicate: "good_omen" }
    ],
    weightModifiers: [
      { actionKind: "work_farm", weightDelta: 20 },
      { actionKind: "work_fish", weightDelta: 20 },
      { actionKind: "trade", weightDelta: 20 },
      { actionKind: "travel", weightDelta: 15 },
      { actionKind: "steal", weightDelta: -20 },
      { actionKind: "assault", weightDelta: -15 }
    ],
    baseDurationHours: 48,
    decayRateModifier: 1.0,
    resistanceTraits: {},
    priority: 3,
    stackable: false
  },

  // ============ EXPANDED STATES (Requirement 20) ============
  {
    id: "exhausted",
    name: "Exhausted",
    triggers: [
      { type: "repeatedAction", kind: "travel", count: 5, window: 48 },
      { type: "repeatedAction", kind: "work_farm", count: 6, window: 24 },
      { type: "repeatedAction", kind: "work_fish", count: 6, window: 24 },
      { type: "npcCondition", field: "consecutiveWorkHours", op: ">", value: 16 }
    ],
    weightModifiers: [
      { actionKind: "*", weightDelta: -25 },
      { actionKind: "assault", weightDelta: -40 },
      { actionKind: "kill", weightDelta: -40 },
      { actionKind: "raid", weightDelta: -35 },
      { actionKind: "travel", weightDelta: -30 },
      { actionKind: "heal", weightDelta: 15 }
    ],
    baseDurationHours: 24,
    decayRateModifier: 1.5,
    resistanceTraits: { Discipline: 0.3 },
    priority: 28,
    stackable: false,
    conflictGroup: "energy_level"
  },
  {
    id: "sick",
    name: "Sick/Ill",
    triggers: [
      { type: "siteCondition", field: "sickness", op: ">", value: 60 },
      { type: "npcCondition", field: "hp", op: "<", value: 30 }
    ],
    weightModifiers: [
      { actionKind: "heal", weightDelta: 50 },
      { actionKind: "*", weightDelta: -30 },
      { actionKind: "work_farm", weightDelta: -40 },
      { actionKind: "work_fish", weightDelta: -40 },
      { actionKind: "work_hunt", weightDelta: -50 },
      { actionKind: "travel", weightDelta: -35 },
      { actionKind: "assault", weightDelta: -60 },
      { actionKind: "raid", weightDelta: -60 }
    ],
    baseDurationHours: 72,
    decayRateModifier: 0.4,
    resistanceTraits: { Discipline: 0.2 },
    priority: 32,
    stackable: false
  },
  {
    id: "starving",
    name: "Starving",
    triggers: [{ type: "needThreshold", need: "Food", op: ">", value: 95, duration: 12 }],
    weightModifiers: [
      { actionKind: "steal", weightDelta: 70 },
      { actionKind: "raid", weightDelta: 60 },
      { actionKind: "work_farm", weightDelta: 50 },
      { actionKind: "work_fish", weightDelta: 50 },
      { actionKind: "work_hunt", weightDelta: 55 },
      { actionKind: "trade", weightDelta: 40 },
      { actionKind: "assault", weightDelta: 30 },
      { actionKind: "patrol", weightDelta: -50 },
      { actionKind: "investigate", weightDelta: -50 },
      { actionKind: "preach_fixed_path", weightDelta: -60 }
    ],
    baseDurationHours: 12,
    decayRateModifier: 2.0,
    resistanceTraits: { Discipline: 0.2, Integrity: 0.3 },
    priority: 40,
    stackable: false,
    conflictGroup: "survival_mode"
  },
  {
    id: "corrupted",
    name: "Corrupted/Tempted",
    triggers: [
      { type: "siteCondition", field: "cultInfluence", op: ">", value: 50 },
      { type: "beliefGained", predicate: "divine_sign" },
      { type: "witnessedAttempt", kind: "preach_fixed_path", asVictim: true }
    ],
    weightModifiers: [
      { actionKind: "preach_fixed_path", weightDelta: 20 },
      { actionKind: "patrol", weightDelta: -15 },
      { actionKind: "investigate", weightDelta: -20 },
      { actionKind: "arrest", weightDelta: -25 },
      { actionKind: "anchor_sever", weightDelta: -30 }
    ],
    baseDurationHours: 96,
    decayRateModifier: 0.6,
    resistanceTraits: { Curiosity: 0.3, Discipline: 0.2 },
    priority: 11,
    stackable: false
  },
  {
    id: "defiant",
    name: "Defiant",
    triggers: [
      { type: "witnessedAttempt", kind: "arrest", asVictim: true },
      { type: "witnessedAttempt", kind: "kidnap", asVictim: true },
      { type: "attemptSucceeded", kind: "anchor_sever" }
    ],
    weightModifiers: [
      { actionKind: "assault", weightDelta: 30 },
      { actionKind: "investigate", weightDelta: 25 },
      { actionKind: "patrol", weightDelta: 20 },
      { actionKind: "anchor_sever", weightDelta: 35 },
      { actionKind: "preach_fixed_path", weightDelta: -40 },
      { actionKind: "travel", weightDelta: -15 }
    ],
    baseDurationHours: 48,
    decayRateModifier: 0.8,
    resistanceTraits: { Empathy: 0.2 },
    priority: 19,
    stackable: false,
    conflictGroup: "emotional_response"
  },
  {
    id: "mourning",
    name: "Mourning",
    triggers: [{ type: "npcDied", relationship: "any" }],
    weightModifiers: [
      { actionKind: "work_farm", weightDelta: -15 },
      { actionKind: "work_fish", weightDelta: -15 },
      { actionKind: "trade", weightDelta: -10 },
      { actionKind: "*", weightDelta: -5 }
    ],
    baseDurationHours: 48,
    decayRateModifier: 1.2,
    resistanceTraits: { Discipline: 0.4 },
    priority: 6,
    stackable: true
  },
  {
    id: "ambitious",
    name: "Ambitious",
    triggers: [
      { type: "witnessedEvent", kind: "kill" },
      { type: "beliefGained", predicate: "leadership_opportunity" },
      { type: "siteCondition", field: "unrest", op: ">", value: 70 }
    ],
    weightModifiers: [
      { actionKind: "preach_fixed_path", weightDelta: 35 },
      { actionKind: "trade", weightDelta: 25 },
      { actionKind: "heal", weightDelta: 20 },
      { actionKind: "patrol", weightDelta: 15 },
      { actionKind: "work_farm", weightDelta: -20 },
      { actionKind: "work_fish", weightDelta: -20 }
    ],
    baseDurationHours: 168,
    decayRateModifier: 0.5,
    resistanceTraits: { Empathy: 0.2 },
    priority: 13,
    stackable: false
  },
  {
    id: "territorial",
    name: "Territorial",
    triggers: [
      { type: "beliefGained", predicate: "strangers_at_home" },
      { type: "siteCondition", field: "recentArrivals", op: ">", value: 3 }
    ],
    weightModifiers: [
      { actionKind: "patrol", weightDelta: 40 },
      { actionKind: "investigate", weightDelta: 30 },
      { actionKind: "assault", weightDelta: 15 },
      { actionKind: "trade", weightDelta: -25 },
      { actionKind: "travel", weightDelta: -30 }
    ],
    baseDurationHours: 72,
    decayRateModifier: 1.0,
    resistanceTraits: { Empathy: 0.3, Curiosity: 0.2 },
    priority: 16,
    stackable: false
  },
  {
    id: "celebratory",
    name: "Celebratory",
    triggers: [
      { type: "beliefGained", predicate: "raid_repelled" },
      { type: "beliefGained", predicate: "good_harvest" },
      { type: "siteCondition", field: "morale", op: ">", value: 85 }
    ],
    weightModifiers: [
      { actionKind: "trade", weightDelta: 30 },
      { actionKind: "travel", weightDelta: 20 },
      { actionKind: "work_farm", weightDelta: 15 },
      { actionKind: "work_fish", weightDelta: 15 },
      { actionKind: "steal", weightDelta: -30 },
      { actionKind: "assault", weightDelta: -25 },
      { actionKind: "raid", weightDelta: -35 }
    ],
    baseDurationHours: 24,
    decayRateModifier: 1.5,
    resistanceTraits: {},
    priority: 4,
    stackable: false
  },
  {
    id: "distrustful",
    name: "Distrustful",
    triggers: [
      { type: "witnessedAttempt", kind: "steal", asVictim: true },
      { type: "relationshipChanged", field: "trust", direction: "decreased" },
      { type: "beliefGained", predicate: "was_betrayed" }
    ],
    weightModifiers: [
      { actionKind: "trade", weightDelta: -40 },
      { actionKind: "investigate", weightDelta: 30 },
      { actionKind: "patrol", weightDelta: 20 },
      { actionKind: "travel", weightDelta: -15 }
    ],
    baseDurationHours: 120,
    decayRateModifier: 0.6,
    resistanceTraits: { Empathy: 0.3 },
    priority: 9,
    stackable: true,
    conflictGroup: "social_mood"
  }
];


