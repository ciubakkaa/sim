/**
 * Known belief predicates used by the simulation.
 *
 * Keep this list in sync with:
 * - action definition beliefWeights
 * - state triggers (beliefGained)
 * - belief creation rules
 */
export const BELIEF_PREDICATES = [
  // Generic
  "did",
  "experienced",

  // Crime/violence + danger
  "witnessed_crime",
  "cult_activity_nearby",
  "identified_cult_member",

  // Narrative / world knowledge
  "divine_sign",
  "discovered_location",
  "heard_rumor",
  "heroic_act",
  "community_in_need",
  "good_omen",
  "good_harvest",
  "raid_repelled",
  "leadership_opportunity",
  "strangers_at_home",
  "was_betrayed",
  "resisted_eclipsing",

  // Death observability
  "npc_died",

  // Family dynamics
  "threat_to_family",
  "murdered_family"
] as const;

export type BeliefPredicate = (typeof BELIEF_PREDICATES)[number];

export function isBeliefPredicate(x: string): x is BeliefPredicate {
  return (BELIEF_PREDICATES as readonly string[]).includes(x);
}


