/**
 * ModuleRegistry: Orchestrates module hooks during tick execution.
 */

import type { KernelModule } from "./hooks";
import type { 
  TickContext, 
  ModuleTickResult, 
  DecisionInput, 
  DecisionOutput,
  ScoreModifier,
  ScoredOption,
  EntityId
} from "./kernelTypes";
import type { KernelEvent } from "./events/eventTypes";

export class ModuleRegistry {
  private modules: KernelModule[] = [];
  
  register(module: KernelModule): void {
    this.modules.push(module);
  }
  
  getModules(): readonly KernelModule[] {
    return this.modules;
  }
  
  runTickStart(ctx: TickContext): void {
    for (const m of this.modules) {
      m.onTickStart?.(ctx);
    }
  }
  
  runTick(ctx: TickContext): ModuleTickResult[] {
    const results: ModuleTickResult[] = [];
    for (const m of this.modules) {
      const result = m.onTick?.(ctx);
      if (result) {
        results.push(result);
      }
    }
    return results;
  }
  
  runAgentDecide(ctx: TickContext, agentId: EntityId, input: DecisionInput): DecisionOutput {
    let output = input;
    for (const m of this.modules) {
      if (m.onAgentDecide) {
        output = m.onAgentDecide(ctx, agentId, output);
      }
    }
    return output;
  }
  
  broadcastEvent(ctx: TickContext, event: KernelEvent): void {
    for (const m of this.modules) {
      m.onEvent?.(ctx, event);
    }
  }
  
  runTickEnd(ctx: TickContext): void {
    for (const m of this.modules) {
      m.onTickEnd?.(ctx);
    }
  }
}

/**
 * Final action selection - happens in kernel, not per module.
 */
export function selectAction(output: DecisionOutput): ScoredOption | null {
  // 1. Filter out blocked actions
  const available = output.options.filter(o => !output.blockedActions.has(o.actionKind));
  
  if (available.length === 0) {
    return null;
  }
  
  // 2. Apply all modifiers to get final scores
  const finalScores = available.map(o => {
    const applicableModifiers = output.modifiers.filter(
      m => m.actionKind === '*' || m.actionKind === o.actionKind
    );
    const modifierSum = applicableModifiers.reduce((sum, m) => sum + m.delta, 0);
    return {
      ...o,
      finalScore: o.baseScore + modifierSum,
    };
  });
  
  // 3. Filter to positive scores
  const positive = finalScores.filter(o => o.finalScore > 0);
  if (positive.length === 0) {
    return available[0] ?? null; // Fallback to first available
  }
  
  // 4. Weighted selection would happen here with RNG
  // For now, return highest score (deterministic selection in kernel)
  positive.sort((a, b) => b.finalScore - a.finalScore);
  return positive[0];
}
