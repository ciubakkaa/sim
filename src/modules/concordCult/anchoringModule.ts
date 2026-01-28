/**
 * Anchoring Module (Concord): Wraps anchoring diffusion/strength updates.
 */
import type { KernelModule } from "../../kernel/hooks";
import type { TickContext, ModuleTickResult } from "../../kernel/kernelTypes";
import type { ProcessContext } from "../../sim/processes/types";
import { applyAnchoringHourly } from "../../sim/processes/anchoringProcess";
import { Rng } from "../../sim/rng";
import { CONCORD_ANCHORING_MODULE_ID } from "./types";

function createProcessContext(ctx: TickContext): ProcessContext {
  const rng = new Rng((ctx.seed ^ ctx.tick) >>> 0);

  let eventSeq = 0;
  const nextEventSeq = () => ++eventSeq;

  return { rng, nextEventSeq };
}

export function createAnchoringModule(): KernelModule {
  return {
    id: CONCORD_ANCHORING_MODULE_ID,

    onTick(ctx: TickContext): ModuleTickResult | void {
      const processCtx = createProcessContext(ctx);
      const result = applyAnchoringHourly(ctx.world, processCtx);

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

export default createAnchoringModule;

