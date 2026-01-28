/**
 * Population modules index.
 * 
 * Exports:
 * - populationModule: Handles population lifecycle (births, deaths, migration, refugees)
 * - PopulationModuleState: State type for the module
 */

export { 
  createPopulationModule, 
  POPULATION_MODULE_ID,
  type PopulationModuleState,
} from "./populationModule";
