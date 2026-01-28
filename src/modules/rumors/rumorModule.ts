/**
 * Rumor Module: Wraps rumor decay and spread mechanics.
 * 
 * Handles:
 * - Daily rumor decay (confidence fades over time)
 * - Inter-settlement rumor spread
 * - Rumor mutation during spread
 */

import type { KernelModule } from "../../kernel/hooks";
import type { TickContext, ModuleTickResult } from "../../kernel/kernelTypes";
import { decayRumorsDaily, spreadRumorsDaily } from "../../sim/attempts/rumors";
import { tickToHourOfDay } from "../../sim/types";
import { Rng } from "../../sim/rng";

export const RUMOR_MODULE_ID = "rumors.spread";

/**
 * Rumor module that wraps existing rumor mechanics.
 */
export function createRumorModule(): KernelModule {
  return {
    id: RUMOR_MODULE_ID,
    
    onTickEnd(ctx: TickContext): ModuleTickResult | void {
      // Only process at end of day (hour 23)
      const hourOfDay = tickToHourOfDay(ctx.tick);
      if (hourOfDay !== 23) {
        return;
      }
      
      // Create RNG for spread randomness
      const rng = new Rng((ctx.seed ^ ctx.tick) >>> 0);
      
      // Apply daily decay
      let nextWorld = decayRumorsDaily(ctx.world);
      
      // Apply inter-settlement spread
      nextWorld = spreadRumorsDaily(nextWorld, rng);
      
      if (nextWorld !== ctx.world) {
        return {
          worldUpdates: nextWorld,
        };
      }
    },
  };
}

export default createRumorModule;
