/**
 * Faction Module: Wraps faction operations for the kernel module system.
 * 
 * Handles:
 * - Faction operation creation and planning
 * - Operation progress tracking
 * - Phase advancement from completed attempts
 * - Weight modifiers for faction members
 */

import type { KernelModule } from "../../kernel/hooks";
import type { TickContext, ModuleTickResult, DecisionInput, DecisionOutput, ScoreModifier, EntityId } from "../../kernel/kernelTypes";
import type { KernelEvent } from "../../kernel/events/eventTypes";
import type { SimEvent } from "../../sim/types";
import { 
  updateFactionOperationsWithEvents, 
  applyOperationProgressFromEvents,
  operationWeightModifiersForNpc 
} from "../../sim/systems/factionOps";

export const FACTION_MODULE_ID = "factions.operations";

/**
 * Track events this tick for operation progress.
 */
interface FactionModuleState {
  eventsThisTick: SimEvent[];
}

/**
 * Faction module that wraps existing faction operation mechanics.
 */
export function createFactionModule(): KernelModule {
  const state: FactionModuleState = {
    eventsThisTick: [],
  };
  
  let eventSeq = 0;
  const nextEventSeq = () => ++eventSeq;
  
  return {
    id: FACTION_MODULE_ID,
    
    onTickStart(ctx: TickContext): void {
      // Reset event tracking for this tick
      state.eventsThisTick = [];
      eventSeq = 0;
    },
    
    onTick(ctx: TickContext): ModuleTickResult | void {
      // Create/update faction operations
      const result = updateFactionOperationsWithEvents(ctx.world, nextEventSeq);
      
      // Emit events through kernel context
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
          purpose: event.data?.operationId as string | undefined,
        });
      }
      
      if (result.world !== ctx.world) {
        return {
          worldUpdates: result.world,
          events: result.events,
        };
      }
    },
    
    onEvent(ctx: TickContext, event: KernelEvent): void {
      // Convert KernelEvent to SimEvent for tracking
      // Cast kind as SimEvent expects EventKind which is a union type
      const simEvent: SimEvent = {
        id: event.id,
        tick: event.tick,
        kind: event.kind as SimEvent["kind"],
        visibility: event.visibility,
        siteId: event.siteId,
        message: event.message,
        data: event.data,
      };
      state.eventsThisTick.push(simEvent);
    },
    
    onAgentDecide(ctx: TickContext, agentId: EntityId, input: DecisionInput): DecisionOutput {
      const npc = ctx.world.npcs[agentId];
      if (!npc || !npc.alive) {
        return input;
      }
      
      // Get operation-based weight modifiers for this NPC
      const opModifiers = operationWeightModifiersForNpc(npc, ctx.world);
      
      if (opModifiers.length === 0) {
        return input;
      }
      
      // Convert to kernel ScoreModifiers
      const modifiers: ScoreModifier[] = [...input.modifiers];
      for (const mod of opModifiers) {
        modifiers.push({
          moduleId: FACTION_MODULE_ID,
          actionKind: mod.actionKind,
          delta: mod.weightDelta,
          reason: `Faction operation: ${mod.goalId}`,
        });
      }
      
      return {
        ...input,
        modifiers,
      };
    },
    
    onTickEnd(ctx: TickContext): ModuleTickResult | void {
      // Apply operation progress from this tick's events
      if (state.eventsThisTick.length === 0) {
        return;
      }
      
      const result = applyOperationProgressFromEvents(ctx.world, state.eventsThisTick, nextEventSeq);
      
      // Emit progress events through kernel context
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
          purpose: event.data?.operationId as string | undefined,
        });
      }
      
      if (result.world !== ctx.world) {
        return {
          worldUpdates: result.world,
          events: result.events,
        };
      }
    },
  };
}

export default createFactionModule;
