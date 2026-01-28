/**
 * Eclipsing Module (Concord): Wraps eclipsing pressure + eclipsing progress.
 *
 * Includes:
 * - Hourly eclipsing pressure diffusion (`applyEclipsingPressureHourly`)
 * - Hourly completion of in-progress eclipsing (`progressEclipsingHourly`)
 */
import type { KernelModule } from "../../kernel/hooks";
import type { TickContext, ModuleTickResult } from "../../kernel/kernelTypes";
import type { ProcessContext } from "../../sim/processes/types";
import { applyEclipsingPressureHourly } from "../../sim/processes/pressureProcess";
import { progressEclipsingHourly } from "../../sim/eclipsing";
import { Rng } from "../../sim/rng";
import { CONCORD_ECLIPSING_MODULE_ID } from "./types";

function createProcessContext(ctx: TickContext): ProcessContext {
  const rng = new Rng((ctx.seed ^ ctx.tick) >>> 0);

  let eventSeq = 0;
  const nextEventSeq = () => ++eventSeq;

  return { rng, nextEventSeq };
}

export function createEclipsingModule(): KernelModule {
  return {
    id: CONCORD_ECLIPSING_MODULE_ID,

    onTick(ctx: TickContext): ModuleTickResult | void {
      const processCtx = createProcessContext(ctx);

      // 1) Pressure diffusion
      const pressure = applyEclipsingPressureHourly(ctx.world, processCtx);

      // 2) Completion/progress of individual eclipsing statuses
      const progressed = progressEclipsingHourly(pressure.world, processCtx);

      const allEvents = [...pressure.events, ...progressed.events];

      for (const event of allEvents) {
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

      const nextWorld = progressed.world;
      return {
        worldUpdates: nextWorld !== ctx.world ? nextWorld : undefined,
        events: allEvents,
      };
    },
  };
}

export default createEclipsingModule;

