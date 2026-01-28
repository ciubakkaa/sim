/**
 * Kernel Modules Index
 * 
 * This module exports all kernel-compatible wrapper modules that adapt
 * existing simulation processes to the kernel module interface.
 * 
 * Available modules:
 * 
 * Economy:
 * - foodModule: Food production, consumption, and spoilage
 * - unrestModule: Unrest and morale drift
 * 
 * Social:
 * - gossipModule: Belief sharing and rumor ingestion on arrival
 * 
 * Crime:
 * - crimeModule: Crime observation and guard response coordination
 * 
 * Rumors:
 * - rumorModule: Daily rumor decay and inter-settlement spread
 * 
 * Factions:
 * - factionModule: Faction operation creation, progress, and coordination
 * 
 * Population:
 * - populationModule: Population lifecycle (births, deaths, migration, refugees)
 * 
 * Concord/Cult (setting-specific):
 * - eclipsingModule: Eclipsing pressure + completion/progress
 * - anchoringModule: Anchoring strength diffusion
 * - cultModule: Recruitment + incidents (daily)
 */

// Import modules for local use in createCoreModules
import { createFoodModule, FOOD_MODULE_ID } from "./economy/foodModule";
import { createUnrestModule, UNREST_MODULE_ID } from "./economy/unrestModule";
import { createGossipModule, GOSSIP_MODULE_ID } from "./social/gossipModule";
import { createCrimeModule, CRIME_MODULE_ID, type Observation } from "./crime/crimeModule";
import { createRumorModule, RUMOR_MODULE_ID } from "./rumors/rumorModule";
import { createFactionModule, FACTION_MODULE_ID } from "./factions/factionModule";
import { createPopulationModule, POPULATION_MODULE_ID } from "./population/populationModule";
import {
  createEclipsingModule,
  createAnchoringModule,
  createCultModule,
  CONCORD_ECLIPSING_MODULE_ID,
  CONCORD_ANCHORING_MODULE_ID,
  CONCORD_CULT_MODULE_ID,
} from "./concordCult";

// Re-export all modules and their IDs
export {
  // Economy
  createFoodModule,
  FOOD_MODULE_ID,
  createUnrestModule,
  UNREST_MODULE_ID,
  // Social
  createGossipModule,
  GOSSIP_MODULE_ID,
  // Crime
  createCrimeModule,
  CRIME_MODULE_ID,
  type Observation,
  // Rumors
  createRumorModule,
  RUMOR_MODULE_ID,
  // Factions
  createFactionModule,
  FACTION_MODULE_ID,
  // Population
  createPopulationModule,
  POPULATION_MODULE_ID,
  // Concord/Cult (setting-specific)
  createEclipsingModule,
  CONCORD_ECLIPSING_MODULE_ID,
  createAnchoringModule,
  CONCORD_ANCHORING_MODULE_ID,
  createCultModule,
  CONCORD_CULT_MODULE_ID,
};

/**
 * Creates and returns all core modules for the vertical slice scenario.
 * These modules are NOT setting-specific (no cult/Concord).
 */
export function createCoreModules() {
  return [
    createFoodModule(),
    createUnrestModule(),
    createGossipModule(),
    createCrimeModule(),
    createRumorModule(),
    createFactionModule(),
    createPopulationModule(),
  ];
}

/**
 * Creates and returns all Concord/Cult modules.
 * These are setting-specific and should be opted into explicitly.
 */
export function createConcordCultModules() {
  return [
    createEclipsingModule(),
    createAnchoringModule(),
    createCultModule(),
  ];
}
