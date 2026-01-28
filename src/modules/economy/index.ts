/**
 * Economy modules index.
 * 
 * Exports:
 * - foodModule: Handles food production, consumption, and spoilage
 * - unrestModule: Handles unrest and morale drift
 */

export { createFoodModule, FOOD_MODULE_ID } from "./foodModule";
export { createUnrestModule, UNREST_MODULE_ID } from "./unrestModule";
