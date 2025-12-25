import assert from "node:assert/strict";
import { createWorld } from "../worldSeed";
import { tickHour } from "../tick";
import type { Attempt, SimEvent, WorldState } from "../types";
import { resolveAndApplyAttempt } from "../attempts";
import { createConfig, resetConfig, setConfig } from "../config";
import { updateChronicleFromEvents } from "../systems/narrative";
import { createMemoriesFromEvents } from "../systems/memory";
import { createSecretsFromEvents } from "../systems/secrets";
import { applyOperationProgressFromEvents } from "../systems/factionOps";
import { syncEntitiesFromNpcs } from "../entities";

export type V2SmokeScenarioName =
  | "heal_debt"
  | "investigate_knowledge"
  | "kidnap_chronicle"
  | "planning_inventory_steal"
  | "revenge_arc"
  | "information_intrigue"
  | "economic_desperation"
  | "cult_operation";

function patchNpc(world: WorldState, npcId: string, patch: any): WorldState {
  const npc = world.npcs[npcId];
  assert.ok(npc, "npc must exist");
  return { ...world, npcs: { ...world.npcs, [npcId]: { ...npc, ...patch } } };
}

function patchSite(world: WorldState, siteId: string, patch: any): WorldState {
  const site = world.sites[siteId];
  assert.ok(site, "site must exist");
  return { ...world, sites: { ...world.sites, [siteId]: { ...(site as any), ...(patch as any) } } };
}

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

function freezeAllExcept(world: WorldState, exceptIds: string[], busyUntilTick = 1_000_000_000): WorldState {
  const keep = new Set(exceptIds);
  let next = world;
  for (const n of Object.values(world.npcs)) {
    if (!n.alive) continue;
    if (keep.has(n.id)) continue;
    next = patchNpc(next, n.id, { busyUntilTick });
  }
  return next;
}

function stepOneTickWithAttempt(
  world: WorldState,
  attempt: Omit<Attempt, "tick">,
  ctx: { rng: any }
): { world: WorldState; events: SimEvent[] } {
  // Minimal deterministic tick slice:
  // - advance tick
  // - resolve one attempt with caller-provided RNG
  // - run v2 "after attempt" systems that impact scenario assertions
  let seq = 0;
  const nextEventSeq = () => ++seq;

  const w1: WorldState = { ...world, tick: world.tick + 1 };
  const att: Attempt = { ...(attempt as any), tick: w1.tick };
  const res = resolveAndApplyAttempt(w1, att, { rng: ctx.rng, nextEventSeq });

  let w2 = res.world;
  const events: SimEvent[] = [...res.events];

  // v2: secrets
  w2 = createSecretsFromEvents(w2, events, nextEventSeq);
  // v2: op progress (may emit milestone events)
  {
    const opProg = applyOperationProgressFromEvents(w2, events, nextEventSeq);
    w2 = opProg.world;
    events.push(...opProg.events);
  }
  // v2: narrative
  w2 = updateChronicleFromEvents(w2, events, nextEventSeq);
  // v2: memories
  {
    const mem = createMemoriesFromEvents(w2, events, nextEventSeq);
    w2 = mem.world;
    events.push(...mem.memoryEvents);
  }
  // v2: entities derived view
  w2 = syncEntitiesFromNpcs(w2);

  return { world: w2, events };
}

export type HealDebtResult = {
  scenario: "heal_debt";
  seed: number;
  siteId: string;
  healerId: string;
  targetId: string;
  world: WorldState;
  events: SimEvent[];
};

export function runScenarioHealDebt(seed = 9101, siteId = "HumanCityPort"): HealDebtResult {
  setConfig(createConfig());
  try {
    let world = createWorld(seed);

    const healerId = findNpcId(world, (n) => n.alive && n.siteId === siteId);
    const targetId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.id !== healerId);

    // Make exactly one wounded candidate at the site to avoid RNG-dependent selection.
    for (const n of Object.values(world.npcs)) {
      if (!n.alive || n.siteId !== siteId) continue;
      if (n.id === targetId) continue;
      world = patchNpc(world, n.id, { hp: n.maxHp });
    }
    world = patchNpc(world, healerId, { busyUntilTick: 0, lastAttemptTick: -999 });
    world = patchNpc(world, targetId, { hp: Math.max(1, world.npcs[targetId]!.maxHp - 25), busyUntilTick: 0, lastAttemptTick: -999 });

    const t0 = world.tick;
    const attempt: Attempt = {
      id: "att:scenario:heal",
      tick: t0 + 1,
      kind: "heal",
      visibility: "private",
      actorId: healerId,
      siteId,
      durationHours: 1,
      intentMagnitude: "normal"
    };

    const res = tickHour(world, { attempts: [attempt] });
    return { scenario: "heal_debt", seed, siteId, healerId, targetId, world: res.world, events: res.events };
  } finally {
    resetConfig();
  }
}

export type InvestigateKnowledgeResult = {
  scenario: "investigate_knowledge";
  seed: number;
  siteId: string;
  guardId: string;
  cultId: string;
  iterations: number;
  world: WorldState;
  events: SimEvent[];
};

export function runScenarioInvestigateKnowledge(
  seed = 9102,
  siteId = "HumanCityPort",
  maxIterations = 50
): InvestigateKnowledgeResult {
  setConfig(createConfig());
  try {
    let world = createWorld(seed);
    world = patchSite(world, siteId, { cultInfluence: 90 });

    const guardId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.category === "GuardMilitia");
    const cultId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.cult?.member);

    world = patchNpc(world, guardId, {
      busyUntilTick: 0,
      lastAttemptTick: -999,
      traits: { ...world.npcs[guardId]!.traits, Suspicion: 100, Discipline: 100 }
    });

    const allEvents: SimEvent[] = [];
    let iterations = 0;
    for (let i = 0; i < maxIterations; i++) {
      iterations = i + 1;
      const t0 = world.tick;
      const attempt: Attempt = {
        id: `att:scenario:investigate:${i}`,
        tick: t0 + 1,
        kind: "investigate",
        visibility: "private",
        actorId: guardId,
        siteId,
        durationHours: 1,
        intentMagnitude: "normal"
      };
      const res = tickHour(world, { attempts: [attempt] });
      world = res.world;
      allEvents.push(...res.events);

      const facts: any[] = world.npcs[guardId]!.knowledge?.facts ?? [];
      const found = facts.some((f) => f.kind === "identified_cult_member" && f.subjectId === cultId);
      if (found) break;
    }

    return { scenario: "investigate_knowledge", seed, siteId, guardId, cultId, iterations, world, events: allEvents };
  } finally {
    resetConfig();
  }
}

export type KidnapChronicleResult = {
  scenario: "kidnap_chronicle";
  seed: number;
  siteId: string;
  actorId: string;
  targetId: string;
  attempts: number;
  world: WorldState;
  events: SimEvent[];
};

export function runScenarioKidnapChronicle(seed = 9103, siteId = "HumanCityPort", maxAttempts = 12): KidnapChronicleResult {
  setConfig(createConfig());
  try {
    let world = createWorld(seed);

    const cultMembers = Object.values(world.npcs).filter((n) => n.alive && n.cult?.member).slice(0, 4);
    assert.ok(cultMembers.length >= 2, "expected at least 2 cult members in seeded world");
    const actorId = cultMembers[0]!.id;

    const targetId = findNpcId(world, (n) => n.alive && !n.cult?.member);

    // Move participants to the same site and bias stats for high kidnap success chance.
    for (const c of cultMembers) {
      world = patchNpc(world, c.id, { siteId, busyUntilTick: 0, lastAttemptTick: -999 });
    }
    world = patchNpc(world, actorId, { traits: { ...world.npcs[actorId]!.traits, Aggression: 100, Discipline: 100, Empathy: 0 } });
    world = patchNpc(world, targetId, { siteId, traits: { ...world.npcs[targetId]!.traits, Courage: 0, Discipline: 0, Suspicion: 0 } });

    const allEvents: SimEvent[] = [];
    let attempts = 0;
    for (let i = 0; i < maxAttempts; i++) {
      attempts = i + 1;
      const t0 = world.tick;
      const attempt: Attempt = {
        id: `att:scenario:kidnap:${i}`,
        tick: t0 + 1,
        kind: "kidnap",
        visibility: "public",
        actorId,
        targetId,
        siteId,
        durationHours: 1,
        intentMagnitude: "major"
      };
      const res = tickHour(world, { attempts: [attempt] });
      world = res.world;
      allEvents.push(...res.events);

      const entries: any[] = (world as any).chronicle?.entries ?? [];
      const got = entries.some((e) => e.kind === "kidnap" && e.primaryNpcId === actorId);
      if (got) break;
    }

    return { scenario: "kidnap_chronicle", seed, siteId, actorId, targetId, attempts, world, events: allEvents };
  } finally {
    resetConfig();
  }
}

export type PlanningInventoryResult = {
  scenario: "planning_inventory_steal";
  seed: number;
  siteId: string;
  npcId: string;
  ticks: number;
  foodGained: number;
  world: WorldState;
  events: SimEvent[];
};

export function runScenarioPlanningInventorySteal(
  seed = 9104,
  siteId = "HumanCityPort",
  maxTicks = 20
): PlanningInventoryResult {
  setConfig(createConfig());
  try {
    let world = createWorld(seed);
    const site: any = world.sites[siteId];
    assert.ok(site && site.kind === "settlement", "scenario requires a settlement site");

    // Pick a non-guard NPC to avoid duty plans.
    const npcId = findNpcId(world, (n) => n.alive && n.siteId === siteId && !String(n.category).includes("Guard"));

    // Force "get_food" planning -> steal step (greed high, integrity low), and maximize steal success chance.
    world = patchNpc(world, npcId, {
      busyUntilTick: 0,
      lastAttemptTick: -999,
      needs: { ...world.npcs[npcId]!.needs, Food: 95 },
      traits: {
        ...world.npcs[npcId]!.traits,
        Greed: 100,
        Integrity: 0,
        Discipline: 100,
        Suspicion: 0
      }
    });
    world = patchSite(world, siteId, { unrest: 100 });

    const allEvents: SimEvent[] = [];
    let ticks = 0;
    let foodGained = 0;

    const foodTotal = (w: WorldState) => {
      const inv: any = w.npcs[npcId]!.inventory;
      const food = inv?.food ?? {};
      return Object.values(food).reduce((a: number, v: any) => a + Number(v ?? 0), 0);
    };
    const before = foodTotal(world);

    for (let i = 0; i < maxTicks; i++) {
      ticks = i + 1;
      const t0 = world.tick;
      const attempt: Attempt = {
        id: `att:scenario:plan_steal:${i}`,
        tick: t0 + 1,
        kind: "steal",
        visibility: "private",
        actorId: npcId,
        siteId,
        durationHours: 1,
        intentMagnitude: "normal"
      };
      const res = tickHour(world, { attempts: [attempt] });
      world = res.world;
      allEvents.push(...res.events);

      const now = foodTotal(world);
      foodGained = now - before;
      if (foodGained > 0) break;
    }

    return { scenario: "planning_inventory_steal", seed, siteId, npcId, ticks, foodGained, world, events: allEvents };
  } finally {
    resetConfig();
  }
}

export function runV2SmokeScenario(name: V2SmokeScenarioName, opts?: { seed?: number; siteId?: string }) {
  const seed = opts?.seed;
  const siteId = opts?.siteId;
  if (name === "heal_debt") return runScenarioHealDebt(seed ?? 9101, siteId ?? "HumanCityPort");
  if (name === "investigate_knowledge") return runScenarioInvestigateKnowledge(seed ?? 9102, siteId ?? "HumanCityPort");
  if (name === "kidnap_chronicle") return runScenarioKidnapChronicle(seed ?? 9103, siteId ?? "HumanCityPort");
  if (name === "planning_inventory_steal") return runScenarioPlanningInventorySteal(seed ?? 9104, siteId ?? "HumanCityPort");
  if (name === "revenge_arc") return runScenarioRevengeArc(seed ?? 9201, siteId ?? "HumanVillageA");
  if (name === "information_intrigue") return runScenarioInformationIntrigue(seed ?? 9202, siteId ?? "HumanCityPort");
  if (name === "economic_desperation") return runScenarioEconomicDesperation(seed ?? 9203, siteId ?? "HumanCityPort");
  if (name === "cult_operation") return runScenarioCultOperation(seed ?? 9204, siteId ?? "HumanCityPort");
  const _exhaustive: never = name;
  return _exhaustive;
}

// =============================================================================
// Phase F scenarios (formerly placeholders)
// =============================================================================

export type RevengeArcResult = {
  scenario: "revenge_arc";
  seed: number;
  siteId: string;
  killerId: string;
  victimId: string;
  witnessId: string;
  world: WorldState;
  events: SimEvent[];
};

export function runScenarioRevengeArc(seed = 9201, siteId = "HumanVillageA"): RevengeArcResult {
  setConfig(createConfig());
  try {
    let world = createWorld(seed);

    const killerId = findNpcId(world, (n) => n.alive && n.siteId === siteId);
    const victimId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.id !== killerId);
    const witnessId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.id !== killerId && n.id !== victimId);

    world = freezeAllExcept(world, [killerId, victimId, witnessId]);

    // Bias for deterministic kill success: maximize offense, minimize defense.
    world = patchNpc(world, killerId, {
      busyUntilTick: 0,
      lastAttemptTick: -999,
      traits: { ...world.npcs[killerId]!.traits, Aggression: 100, Courage: 100, Discipline: 100 }
    });
    world = patchNpc(world, victimId, {
      busyUntilTick: 0,
      lastAttemptTick: -999,
      traits: { ...world.npcs[victimId]!.traits, Courage: 0, Discipline: 0, Aggression: 0 },
      hp: 5,
      maxHp: Math.max(10, world.npcs[victimId]!.maxHp)
    });
    world = patchNpc(world, witnessId, { busyUntilTick: 0, lastAttemptTick: -999 });

    // Force success: roll 0 for (0..99)
    const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 0 : a), chance: () => false } as any;

    const res = stepOneTickWithAttempt(
      world,
      {
        id: "att:scenario:revenge_arc:kill",
        kind: "kill",
        visibility: "public",
        actorId: killerId,
        targetId: victimId,
        siteId,
        durationHours: 1,
        intentMagnitude: "major"
      },
      { rng }
    );

    return { scenario: "revenge_arc", seed, siteId, killerId, victimId, witnessId, world: res.world, events: res.events };
  } finally {
    resetConfig();
  }
}

export type InformationIntrigueResult = {
  scenario: "information_intrigue";
  seed: number;
  siteId: string;
  actorId: string;
  observerId: string;
  world: WorldState;
  events: SimEvent[];
};

export function runScenarioInformationIntrigue(seed = 9202, siteId = "HumanCityPort"): InformationIntrigueResult {
  setConfig(createConfig());
  try {
    let world = createWorld(seed);

    // Actor: a cult member (so we can later correlate with identified_cult_member facts if needed).
    const actorId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.cult?.member);
    const observerId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.id !== actorId);

    world = freezeAllExcept(world, [actorId, observerId]);
    world = patchNpc(world, actorId, { busyUntilTick: 0, lastAttemptTick: -999 });
    world = patchNpc(world, observerId, { busyUntilTick: 0, lastAttemptTick: -999 });

    // Private theft creates a world secret + actor learns it (asymmetric info).
    const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 0 : a), chance: () => false } as any;
    const res = stepOneTickWithAttempt(
      world,
      {
        id: "att:scenario:intrigue:steal",
        kind: "steal",
        visibility: "private",
        actorId,
        siteId,
        durationHours: 1,
        intentMagnitude: "normal"
      } as any,
      { rng }
    );

    return { scenario: "information_intrigue", seed, siteId, actorId, observerId, world: res.world, events: res.events };
  } finally {
    resetConfig();
  }
}

export type EconomicDesperationResult = {
  scenario: "economic_desperation";
  seed: number;
  siteId: string;
  npcId: string;
  before: { coins: number; foodTotal: number };
  after: { coins: number; foodTotal: number };
  world: WorldState;
  events: SimEvent[];
};

export function runScenarioEconomicDesperation(seed = 9203, siteId = "HumanCityPort"): EconomicDesperationResult {
  setConfig(createConfig());
  try {
    let world = createWorld(seed);
    const npcId = findNpcId(world, (n) => n.alive && n.siteId === siteId);
    world = freezeAllExcept(world, [npcId]);

    // Ensure the NPC is hungry and has coins to buy.
    world = patchNpc(world, npcId, {
      busyUntilTick: 0,
      lastAttemptTick: -999,
      needs: { ...world.npcs[npcId]!.needs, Food: 90, Wealth: 20 },
      inventory: { coins: 50, food: { grain: 0, fish: 0, meat: 0 } }
    });

    const inv0: any = world.npcs[npcId]!.inventory ?? { coins: 0, food: {} };
    const before = {
      coins: inv0.coins ?? 0,
      foodTotal: (inv0.food?.grain ?? 0) + (inv0.food?.fish ?? 0) + (inv0.food?.meat ?? 0)
    };

    const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 0 : a), chance: () => false } as any;
    const res = stepOneTickWithAttempt(
      world,
      {
        id: "att:scenario:econ:trade_buy",
        kind: "trade",
        visibility: "private",
        actorId: npcId,
        siteId,
        durationHours: 1,
        intentMagnitude: "normal"
      },
      { rng }
    );

    const inv1: any = res.world.npcs[npcId]!.inventory ?? { coins: 0, food: {} };
    const after = {
      coins: inv1.coins ?? 0,
      foodTotal: (inv1.food?.grain ?? 0) + (inv1.food?.fish ?? 0) + (inv1.food?.meat ?? 0)
    };

    return { scenario: "economic_desperation", seed, siteId, npcId, before, after, world: res.world, events: res.events };
  } finally {
    resetConfig();
  }
}

export type CultOperationResult = {
  scenario: "cult_operation";
  seed: number;
  siteId: string;
  opId: string;
  world: WorldState;
  events: SimEvent[];
};

export function runScenarioCultOperation(seed = 9204, siteId = "HumanCityPort"): CultOperationResult {
  setConfig(createConfig());
  try {
    let world = createWorld(seed);
    // Ensure operation can be created here.
    world = patchSite(world, siteId, { eclipsingPressure: 70, anchoringStrength: 20 });

    const leaderId = findNpcId(world, (n) => n.alive && n.cult?.role === "cell_leader");
    const memberId = findNpcId(world, (n) => n.alive && n.cult?.member && n.id !== leaderId);
    const targetId = findNpcId(world, (n) => n.alive && !n.cult?.member);

    world = patchNpc(world, leaderId, { siteId, busyUntilTick: 0, lastAttemptTick: -999 });
    world = patchNpc(world, memberId, { siteId, busyUntilTick: 0, lastAttemptTick: -999 });
    world = patchNpc(world, targetId, { siteId, busyUntilTick: 0, lastAttemptTick: -999 });
    world = freezeAllExcept(world, [leaderId, memberId, targetId]);

    // Tick once normally to let tick pipeline create the op + milestone event.
    const first = tickHour(world);
    world = first.world;
    const allEvents: SimEvent[] = [...first.events];

    const ops = world.operations ?? {};
    const op = Object.values(ops).find((o) => o.factionId === "cult" && o.siteId === siteId);
    assert.ok(op, "expected an operation created");
    const opId = op.id;

    // Force execution of phases via deterministic attempts:
    const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 0 : a), chance: () => false } as any;

    const step1 = stepOneTickWithAttempt(
      world,
      {
        id: "att:scenario:op:kidnap",
        kind: "kidnap",
        visibility: "private",
        actorId: memberId,
        targetId,
        siteId,
        durationHours: 1,
        intentMagnitude: "major"
      },
      { rng }
    );
    world = step1.world;
    allEvents.push(...step1.events);

    const step2 = stepOneTickWithAttempt(
      world,
      {
        id: "att:scenario:op:forced_eclipse",
        kind: "forced_eclipse",
        visibility: "private",
        actorId: memberId,
        targetId,
        siteId,
        durationHours: 1,
        intentMagnitude: "major"
      },
      { rng }
    );
    world = step2.world;
    allEvents.push(...step2.events);

    return { scenario: "cult_operation", seed, siteId, opId, world, events: allEvents };
  } finally {
    resetConfig();
  }
}


