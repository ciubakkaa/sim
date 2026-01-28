/**
 * Cult Module (Concord): Wraps recruitment + incidents (`applyCultDaily`).
 *
 * Note: The underlying process is intentionally "daily boundary only"
 * (it returns early unless hour-of-day is 0).
 */
import type { KernelModule } from "../../kernel/hooks";
import type { TickContext, ModuleTickResult } from "../../kernel/kernelTypes";
import type { ProcessContext } from "../../sim/processes/types";
import { applyCultDaily } from "../../sim/processes/cultProcess";
import { Rng } from "../../sim/rng";
import { CONCORD_CULT_MODULE_ID } from "./types";

function createProcessContext(ctx: TickContext): ProcessContext {
  const rng = new Rng((ctx.seed ^ ctx.tick) >>> 0);

  let eventSeq = 0;
  const nextEventSeq = () => ++eventSeq;

  return { rng, nextEventSeq };
}

export function createCultModule(): KernelModule {
  return {
    id: CONCORD_CULT_MODULE_ID,

    onTick(ctx: TickContext): ModuleTickResult | void {
      const processCtx = createProcessContext(ctx);
      const result = applyCultDaily(ctx.world, processCtx);

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

export default createCultModule;

