/**
 * Population Module: Wraps population process and promotion pipeline.
 * 
 * Handles:
 * - Daily population changes (births, deaths, migration)
 * - Refugee arrivals (cohort and named)
 * - Named NPC promotion from pools
 * - Training progress for trainees
 * - Training completion and graduation
 */

import type { KernelModule } from "../../kernel/hooks";
import type { TickContext, ModuleTickResult } from "../../kernel/kernelTypes";
import type { ProcessContext } from "../../sim/processes/types";
import type { SimEvent, WorldState, NpcState } from "../../sim/types";
import { applyPopulationProcessDaily } from "../../sim/processes/populationProcess";
import { Rng } from "../../sim/rng";
import { 
  type PromotionState,
  type PromotionConfig,
  type PromotionEvent,
  createEmptyPromotionState,
  initializeRoleSlotsFromWorld,
  checkPromotions,
  applyGraduation,
  DEFAULT_PROMOTION_CONFIG,
} from "../../kernel/population/promotion";
import { 
  type PoolState,
  initializePoolsFromWorld,
  adjustPoolCount,
} from "../../kernel/population/pools";

export const POPULATION_MODULE_ID = "population.lifecycle";

/**
 * Module state for tracking promotion pipeline across ticks.
 */
export interface PopulationModuleState {
  promotionState: PromotionState;
  poolState: PoolState;
  initialized: boolean;
}

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
 * Convert promotion events to sim events.
 */
function promotionEventToSimEvent(
  pe: PromotionEvent,
  purpose: string
): Omit<SimEvent, "id"> {
  return {
    tick: pe.tick,
    kind: "world.population.changed",
    visibility: "system",
    siteId: pe.siteId,
    message: pe.message,
    data: {
      promotionEventType: pe.type,
      entityId: pe.entityId,
      role: pe.role,
      mentorId: pe.mentorId,
      purpose,
    },
  };
}

/**
 * Population module that wraps the existing population process and promotion pipeline.
 */
export function createPopulationModule(
  config: PromotionConfig = DEFAULT_PROMOTION_CONFIG
): KernelModule {
  // Module-level state (persists across ticks)
  let moduleState: PopulationModuleState = {
    promotionState: createEmptyPromotionState(),
    poolState: { pools: {} },
    initialized: false,
  };
  
  return {
    id: POPULATION_MODULE_ID,
    
    onTickStart(ctx: TickContext): void {
      // Initialize state on first tick
      if (!moduleState.initialized) {
        moduleState.promotionState = {
          ...moduleState.promotionState,
          roleSlots: initializeRoleSlotsFromWorld(ctx.world),
        };
        moduleState.poolState = initializePoolsFromWorld(ctx.world.sites as any);
        moduleState.initialized = true;
      }
    },
    
    onTick(ctx: TickContext): ModuleTickResult | void {
      const processCtx = createProcessContext(ctx);
      const allEvents: SimEvent[] = [];
      let updatedWorld: WorldState = ctx.world;
      
      // 1. Run the existing daily population process
      const dailyResult = applyPopulationProcessDaily(updatedWorld, processCtx);
      
      // Emit events through kernel context for proper ID generation
      for (const event of dailyResult.events) {
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
      
      if (dailyResult.world !== updatedWorld) {
        updatedWorld = dailyResult.world;
        allEvents.push(...dailyResult.events);
      }
      
      // 2. Run the promotion pipeline
      const promotionResult = checkPromotions(
        updatedWorld,
        moduleState.promotionState,
        moduleState.poolState,
        config
      );
      
      // Update module state
      moduleState.promotionState = promotionResult.state;
      
      // Add new NPCs to world
      if (promotionResult.newNpcs.length > 0) {
        const updatedNpcs: Record<string, NpcState> = { ...updatedWorld.npcs };
        for (const newNpc of promotionResult.newNpcs) {
          updatedNpcs[newNpc.id] = newNpc;
        }
        updatedWorld = { ...updatedWorld, npcs: updatedNpcs };
        
        // Also update entities registry if it exists
        if (updatedWorld.entities) {
          updatedWorld.entities = updatedNpcs as any;
        }
        
        // Decrement pool counts for promoted individuals
        for (const newNpc of promotionResult.newNpcs) {
          moduleState.poolState = adjustPoolCount(
            moduleState.poolState,
            newNpc.siteId,
            -1
          );
        }
      }
      
      // Apply graduation effects
      if (promotionResult.graduatedIds.length > 0) {
        updatedWorld = applyGraduation(updatedWorld, promotionResult.graduatedIds);
      }
      
      // Emit promotion events
      for (const pe of promotionResult.events) {
        const simEvent = promotionEventToSimEvent(pe, `promotion.${pe.type}`);
        ctx.emitEvent({
          kind: simEvent.kind,
          tick: simEvent.tick,
          siteId: simEvent.siteId,
          visibility: simEvent.visibility,
          message: simEvent.message,
          data: simEvent.data,
          purpose: simEvent.data?.purpose as string | undefined,
        });
        
        allEvents.push({
          id: `evt:promotion:${pe.type}:${pe.tick}:${pe.entityId ?? pe.siteId}`,
          ...simEvent,
        });
      }
      
      // Return updates if anything changed
      if (updatedWorld !== ctx.world || allEvents.length > 0) {
        return {
          worldUpdates: updatedWorld,
          events: allEvents,
        };
      }
    },
    
    onTickEnd(ctx: TickContext): void {
      // Sync pool state with world state periodically
      // This helps keep pools accurate if deaths occurred during the tick
      const deadNpcs = Object.values(ctx.world.npcs).filter(n => !n.alive);
      
      // Update role slots for any newly dead NPCs
      const deadIds = new Set(deadNpcs.map(n => n.id));
      moduleState.promotionState = {
        ...moduleState.promotionState,
        roleSlots: moduleState.promotionState.roleSlots.map(slot => {
          if (slot.filledBy && deadIds.has(slot.filledBy)) {
            return { ...slot, filledBy: undefined };
          }
          return slot;
        }),
        // Remove trainees who died
        trainees: moduleState.promotionState.trainees.filter(
          t => !deadIds.has(t.entityId)
        ),
      };
    },
  };
}

/**
 * Get current promotion state (for testing/debugging).
 */
export function getPromotionState(module: KernelModule): PromotionState | undefined {
  // This is a workaround since we can't directly access module internals
  // In practice, state would be exposed through different means
  return undefined;
}

export default createPopulationModule;
