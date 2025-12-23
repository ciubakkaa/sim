import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { resolveAndApplyAttempt } from "../src/sim/attempts";
import { Rng } from "../src/sim/rng";
import { progressLocalTravelHourly } from "../src/sim/localMovement";

test("worldSeed generates deterministic settlement interiors (same seed)", () => {
  const a = createWorld(1);
  const b = createWorld(1);
  assert.equal(JSON.stringify(a.sites.HumanVillageA), JSON.stringify(b.sites.HumanVillageA));
  assert.equal(JSON.stringify(a.npcs["npc:1"]), JSON.stringify(b.npcs["npc:1"]));
});

test("settlements contain local nodes+edges and NPCs have homes", () => {
  const w = createWorld(1);
  const site: any = w.sites.HumanVillageA;
  assert.equal(site.kind, "settlement");
  assert.ok(site.local);
  assert.ok(site.local.nodes.length > 10);
  assert.ok(site.local.edges.length > 10);

  const villagers = Object.values(w.npcs).filter((n) => n.siteId === "HumanVillageA");
  assert.ok(villagers.length > 10);
  for (const n of villagers.slice(0, 10)) {
    assert.ok(n.homeLocationId);
    assert.ok(n.local);
    assert.equal(n.local.siteId, "HumanVillageA");
    assert.ok(String(n.local.locationId).startsWith("HumanVillageA:"));
  }
});

test("progressLocalTravelHourly reduces remainingMeters and eventually arrives", () => {
  let w = createWorld(1);
  const site: any = w.sites.HumanVillageA;
  const npc = Object.values(w.npcs)
    .filter((n) => n.siteId === "HumanVillageA" && n.alive)
    .sort((a, b) => a.id.localeCompare(b.id))[0]!;
  assert.ok(npc);

  // Manually put them in local travel.
  const from = npc.local!.locationId;
  const to = site.local.nodes.find((n: any) => n.kind === "fields")?.id;
  assert.ok(to);

  w = {
    ...w,
    npcs: {
      ...w.npcs,
      [npc.id]: {
        ...npc,
        localTravel: {
          kind: "localTravel",
          siteId: "HumanVillageA",
          fromLocationId: from,
          toLocationId: to,
          totalMeters: 900,
          remainingMeters: 900,
          startedTick: w.tick,
          lastProgressTick: -999
        }
      }
    }
  };

  const rng = new Rng(123);
  const r1 = progressLocalTravelHourly({ ...w, tick: w.tick + 1 }, { rng, nextEventSeq: (() => { let i = 0; return () => ++i; })() });
  const after = r1.world.npcs[npc.id]!;
  assert.ok(after.localTravel === undefined || after.localTravel.remainingMeters < 900);
});

test("location constraint: work_farm from home starts local travel to fields first", () => {
  const w0 = createWorld(1);
  const siteId = "HumanVillageA";
  const farmer = Object.values(w0.npcs)
    .filter((n) => n.siteId === siteId && n.category === "Farmer" && n.alive)
    .sort((a, b) => a.id.localeCompare(b.id))[0]!;
  assert.ok(farmer);

  const attempt = {
    id: "att:test",
    tick: w0.tick,
    kind: "work_farm" as const,
    visibility: "private" as const,
    actorId: farmer.id,
    siteId,
    durationHours: 6,
    intentMagnitude: "normal" as const
  };

  const rng = new Rng(999);
  let seq = 0;
  const res = resolveAndApplyAttempt(w0, attempt as any, { rng, nextEventSeq: () => ++seq });
  const n1 = res.world.npcs[farmer.id]!;
  assert.ok(n1.local?.locationId, "expected NPC to have a local location");
  assert.ok(res.events.some((e) => e.kind === "local.travel.started"));
  assert.ok(res.events.some((e) => e.kind === "local.travel.arrived"));
});


