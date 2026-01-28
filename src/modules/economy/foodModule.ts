/**
 * Food Module: Wraps applyFoodProcessHourly for the kernel module system.
 * 
 * Handles:
 * - Hourly food consumption
 * - Daily food production (at hour 6)
 * - Daily food spoilage (at hour 0)
 * - Hunger tracking
 */

import type { KernelModule } from "../../kernel/hooks";
import type { TickContext, ModuleTickResult } from "../../kernel/kernelTypes";
import type { ProcessContext, ProcessResult } from "../../sim/processes/types";
import { applyFoodProcessHourly } from "../../sim/processes/foodProcess";
import { Rng } from "../../sim/rng";

export const FOOD_MODULE_ID = "economy.food";

/**
 * Creates a ProcessContext from a TickContext for compatibility with existing process functions.
 */
function createProcessContext(ctx: TickContext): ProcessContext {
  // Create RNG instance seeded from tick context
  const rng = new Rng((ctx.seed ^ ctx.tick) >>> 0);
  
  let eventSeq = 0;
  const nextEventSeq = () => ++eventSeq;
  
  return { rng, nextEventSeq };
}

/**
 * Food module that wraps the existing food process.
 */
export function createFoodModule(): KernelModule {
  return {
    id: FOOD_MODULE_ID,
    
    onTick(ctx: TickContext): ModuleTickResult | void {
      const processCtx = createProcessContext(ctx);
      const result = applyFoodProcessHourly(ctx.world, processCtx);
      
      // Emit events through kernel context for proper ID generation
      for (const event of result.events) {
        ctx.emitEvent({
          kind: event.kind,
          tick: event.tick,
          siteId: event.siteId,
          actorId: event.data?.actorId as string | undefined,
          targetId: event.data?.targetId as string | undefined,
          visibility: event.visibility,
          message: event.message,
          data: event.data,
          purpose: event.data?.purpose as string | undefined,
        });
      }
      
      return {
        worldUpdates: result.world !== ctx.world ? result.world : undefined,
        events: result.events,
      };
    },
  };
}

export default createFoodModule;
