/**
 * Gossip Module: Handles social interaction and belief sharing.
 * 
 * Provides:
 * - Belief sharing when NPCs arrive at locations
 * - Gossip generation from witnessed events
 * - Trust/fear relationship updates from social interactions
 */

import type { KernelModule } from "../../kernel/hooks";
import type { TickContext, ModuleTickResult, DecisionInput, DecisionOutput, EntityId } from "../../kernel/kernelTypes";
import type { KernelEvent } from "../../kernel/events/eventTypes";
import type { NpcState, SettlementSiteState } from "../../sim/types";
import { shareBeliefsOnArrival, ingestRumorsOnArrival, isSettlement } from "../../sim/attempts/rumors";

export const GOSSIP_MODULE_ID = "social.gossip";

/**
 * Track NPCs that just arrived at a site (for belief sharing).
 */
interface GossipModuleState {
  arrivedThisTick: Map<string, string>; // npcId -> siteId
}

/**
 * Gossip module that handles social information flow.
 */
export function createGossipModule(): KernelModule {
  const state: GossipModuleState = {
    arrivedThisTick: new Map(),
  };
  
  return {
    id: GOSSIP_MODULE_ID,
    
    onTickStart(ctx: TickContext): void {
      // Clear arrivals from previous tick
      state.arrivedThisTick.clear();
    },
    
    onEvent(ctx: TickContext, event: KernelEvent): void {
      // Track arrivals for gossip sharing
      if (event.kind === "local.travel.arrived" || event.kind === "travel.arrived") {
        const npcId = event.data?.npcId as string | undefined;
        const siteId = event.siteId;
        if (npcId && siteId) {
          state.arrivedThisTick.set(npcId, siteId);
        }
      }
    },
    
    onTickEnd(ctx: TickContext): ModuleTickResult | void {
      // Process gossip for NPCs that arrived this tick
      if (state.arrivedThisTick.size === 0) {
        return;
      }
      
      let nextWorld = ctx.world;
      
      for (const [npcId, siteId] of state.arrivedThisTick) {
        const npc = nextWorld.npcs[npcId as EntityId];
        const site = nextWorld.sites[siteId];
        
        if (!npc || !npc.alive || !isSettlement(site)) {
          continue;
        }
        
        // NPC shares their beliefs as rumors
        const updatedSite = shareBeliefsOnArrival(npc, site as SettlementSiteState, nextWorld);
        nextWorld = {
          ...nextWorld,
          sites: { ...nextWorld.sites, [siteId]: updatedSite },
        };
        
        // NPC ingests rumors from the site
        const updatedNpc = ingestRumorsOnArrival(npc, updatedSite, nextWorld);
        nextWorld = {
          ...nextWorld,
          npcs: { ...nextWorld.npcs, [npcId]: updatedNpc },
        };
      }
      
      if (nextWorld !== ctx.world) {
        return {
          worldUpdates: nextWorld,
        };
      }
    },
  };
}

export default createGossipModule;
