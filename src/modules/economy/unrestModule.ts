/**
 * Unrest Module: Wraps applyUnrestProcessHourly for the kernel module system.
 * 
 * Handles:
 * - Hourly unrest drift based on hunger, cult influence, pressure, sickness
 * - Morale drift (inverse of unrest)
 */

import type { KernelModule } from "../../kernel/hooks";
import type { TickContext, ModuleTickResult } from "../../kernel/kernelTypes";
import type { ProcessContext } from "../../sim/processes/types";
import { applyUnrestProcessHourly } from "../../sim/processes/unrestProcess";
import { Rng } from "../../sim/rng";

export const UNREST_MODULE_ID = "economy.unrest";

/**
 * Creates a ProcessContext from a TickContext for compatibility with existing process functions.
 */
function createProcessContext(ctx: TickContext): ProcessContext {
  const rng = new Rng((ctx.seed ^ ctx.tick) >>> 0);
  
  let eventSeq = 0;
  const nextEventSeq = () => ++eventSeq;
  
  return { rng, nextEventSeq };
}

/**
 * Unrest module that wraps the existing unrest process.
 */
export function createUnrestModule(): KernelModule {
  return {
    id: UNREST_MODULE_ID,
    
    onTick(ctx: TickContext): ModuleTickResult | void {
      const processCtx = createProcessContext(ctx);
      const result = applyUnrestProcessHourly(ctx.world, processCtx);
      
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

export default createUnrestModule;
