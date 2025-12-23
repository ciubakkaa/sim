import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SimRuntime } from "../src/service/runtime";
import { startViewerServer } from "../src/service/server";
import { ensurePersistedRunDir, writeRunMeta, writeRunSnapshot } from "../src/service/persist";
import type { WorldSnapshot } from "../src/service/persist";
import { createWorld } from "../src/sim/worldSeed";

function writeJsonl(filePath: string, lines: unknown[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");
}

test("persisted run folder writes snapshot+meta and server can open + stream events", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "simengine-worlds-"));

  const seed = 1;
  const runId = "testRun";
  const p = ensurePersistedRunDir({ seed, baseDir: tmp, runId });

  const nowIso = new Date().toISOString();
  writeRunMeta(p, { version: 1, seed, runId: p.runId, startedAt: nowIso, argv: ["node", "test"] });

  const w0 = createWorld(seed);
  const snap: WorldSnapshot = { version: 1, seed, createdAt: nowIso, world: w0, map: w0.map };
  writeRunSnapshot(p, snap);

  writeJsonl(p.eventsPath, [
    { id: "evt:0:1", tick: 0, kind: "sim.started", visibility: "system", message: "Simulation started (seed=1)", data: { seed } },
    {
      id: "evt:1:1",
      tick: 1,
      kind: "attempt.recorded",
      visibility: "public",
      siteId: "HumanVillageA",
      message: "Someone did something",
      data: { attempt: { actorId: "npc:1", kind: "investigate", intentMagnitude: "normal" } }
    }
  ]);

  const rt = new SimRuntime({ seed: 1, msPerTick: 60_000, paused: true });
  const srv = startViewerServer({ port: 0, host: "127.0.0.1", runtime: rt });

  try {
    // Ensure the server is actually listening before reading `.address()`.
    // Node can return null for `.address()` until the listen callback fires.
    let addr = srv.address();
    if (!addr) {
      await new Promise<void>((resolve, reject) => {
        srv.once("listening", () => resolve());
        srv.once("error", (e) => reject(e));
      });
      addr = srv.address();
    }
    assert.ok(addr && typeof addr === "object");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // list runs
    {
      const url = `${baseUrl}/log/runs?seed=${seed}&baseDir=${encodeURIComponent(tmp)}`;
      const res = await fetch(url);
      assert.equal(res.status, 200);
      const j: any = await res.json();
      assert.equal(j.ok, true);
      assert.deepEqual(j.runIds, [runId]);
    }

    // open run (includes stats)
    let openRunId = "";
    {
      const res = await fetch(`${baseUrl}/log/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed, runId, baseDir: tmp })
      });
      assert.equal(res.status, 200);
      const j: any = await res.json();
      assert.equal(j.ok, true);
      assert.equal(j.seed, seed);
      assert.equal(j.runId, runId);
      assert.equal(j.stats.totalLines, 2);
      assert.equal(j.stats.countsByKind["attempt.recorded"], 1);
      openRunId = j.runId;
    }

    // snapshot
    {
      const url = `${baseUrl}/log/snapshot?seed=${seed}&runId=${encodeURIComponent(openRunId)}&baseDir=${encodeURIComponent(tmp)}`;
      const res = await fetch(url);
      assert.equal(res.status, 200);
      const j: any = await res.json();
      assert.equal(j.seed, seed);
      assert.ok(j.world);
      assert.ok(j.world.npcs);
    }

    // events stream
    {
      const url = `${baseUrl}/log/events?seed=${seed}&runId=${encodeURIComponent(openRunId)}&baseDir=${encodeURIComponent(tmp)}`;
      const res = await fetch(url);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("\"kind\":\"sim.started\""));
      assert.ok(text.includes("\"kind\":\"attempt.recorded\""));
    }
  } finally {
    try {
      srv.close();
    } catch {
      // ignore
    }
    try {
      rt.stop();
    } catch {
      // ignore
    }
  }
});


