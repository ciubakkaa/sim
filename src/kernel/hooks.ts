/**
 * Module hook interface for the kernel.
 * 
 * Modules implement this interface to participate in the tick pipeline.
 * Hooks are called in registration order.
 */

import type { 
  TickContext, 
  ModuleTickResult, 
  DecisionInput, 
  DecisionOutput 
} from "./kernelTypes";
import type { KernelEvent } from "./events/eventTypes";
import type { EntityId } from "./kernelTypes";

export interface KernelModule {
  /** Unique identifier for this module */
  id: string;
  
  /** Called once at the start of each tick */
  onTickStart?(ctx: TickContext): void;
  
  /** Module does its hourly work (can inspect world, emit events) */
  onTick?(ctx: TickContext): ModuleTickResult | void;
  
  /** 
   * Optional: influence agent decision scoring.
   * Modules can add options, add modifiers, add to blockedActions.
   * Modules MUST NOT remove options, modifiers, or unblock actions.
   * Final selection happens in kernel.
   */
  onAgentDecide?(ctx: TickContext, agentId: EntityId, input: DecisionInput): DecisionOutput;
  
  /** React to events (for rumor generation, state updates) */
  onEvent?(ctx: TickContext, event: KernelEvent): void;
  
  /** Called once at the end of each tick */
  onTickEnd?(ctx: TickContext): void;
}
