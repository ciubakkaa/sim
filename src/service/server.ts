import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { SimRuntime } from "./runtime";
import type { ControlAction, ViewerServerMessage } from "./protocol";
import { defaultWorldsBaseDir, listSeedRunIds, persistedRunPaths, readRunMeta, readRunSnapshot } from "./persist";

export type ViewerServerOptions = {
  port: number;
  host?: string;
  runtime: SimRuntime;
  corsOrigin?: string; // e.g. http://localhost:5173
};

function setCors(res: ServerResponse, origin?: string) {
  res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function writeJson(res: ServerResponse, status: number, body: unknown, corsOrigin?: string) {
  setCors(res, corsOrigin);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function parseIntParam(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}

function listSeeds(baseDir: string): number[] {
  if (!fs.existsSync(baseDir)) return [];
  const ents = fs.readdirSync(baseDir, { withFileTypes: true });
  const seeds: number[] = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const m = /^seed-(\d+)$/.exec(e.name);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) seeds.push(n);
  }
  seeds.sort((a, b) => a - b);
  return seeds;
}

async function readEventLogStats(eventsPath: string): Promise<{
  totalLines: number;
  firstTick?: number;
  lastTick?: number;
  countsByKind: Record<string, number>;
  attemptByKind: Record<string, number>;
  attemptByActor: Record<string, number>;
}> {
  const countsByKind: Record<string, number> = {};
  const attemptByKind: Record<string, number> = {};
  const attemptByActor: Record<string, number> = {};
  let totalLines = 0;
  let firstTick: number | undefined;
  let lastTick: number | undefined;

  const input = fs.createReadStream(eventsPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    totalLines++;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }

    const tick = typeof e.tick === "number" ? e.tick : undefined;
    if (tick !== undefined) {
      if (firstTick === undefined) firstTick = tick;
      lastTick = tick;
    }

    const kind = typeof e.kind === "string" ? e.kind : "unknown";
    countsByKind[kind] = (countsByKind[kind] ?? 0) + 1;

    if (kind === "attempt.recorded") {
      const a = e.data?.attempt;
      const ak = typeof a?.kind === "string" ? a.kind : undefined;
      const actorId = typeof a?.actorId === "string" ? a.actorId : undefined;
      if (ak) attemptByKind[ak] = (attemptByKind[ak] ?? 0) + 1;
      if (actorId) attemptByActor[actorId] = (attemptByActor[actorId] ?? 0) + 1;
    }
  }

  return { totalLines, firstTick, lastTick, countsByKind, attemptByKind, attemptByActor };
}

function sseWrite(res: ServerResponse, msg: ViewerServerMessage) {
  // Default SSE event name is "message"; we also include a typed event.
  res.write(`event: ${msg.type}\n`);
  res.write(`data: ${JSON.stringify(msg)}\n\n`);
}

function isControlAction(x: any): x is ControlAction {
  if (!x || typeof x !== "object") return false;
  const a = (x as any).action;
  if (a === "pause" || a === "play" || a === "step" || a === "reset") return true;
  if (a === "setSpeed") return typeof (x as any).msPerTick === "number";
  if (a === "setSeed") return typeof (x as any).seed === "number";
  return false;
}

export function startViewerServer(opts: ViewerServerOptions): http.Server {
  const runtime = opts.runtime;
  const corsOrigin = opts.corsOrigin;

  const clients = new Set<ServerResponse>();

  const broadcast = (msg: ViewerServerMessage) => {
    for (const res of clients) {
      try {
        sseWrite(res, msg);
      } catch {
        // Ignore write errors; cleanup happens on 'close'
      }
    }
  };

  runtime.on((msg) => broadcast(msg));
  runtime.start();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "OPTIONS") {
      setCors(res, corsOrigin);
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      writeJson(res, 200, { ok: true }, corsOrigin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/state") {
      writeJson(res, 200, runtime.helloMessage(), corsOrigin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      setCors(res, corsOrigin);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      // Initial hello snapshot
      sseWrite(res, runtime.helloMessage());

      clients.add(res);

      const heartbeat = setInterval(() => {
        try {
          res.write(`event: ping\ndata: {}\n\n`);
        } catch {
          // ignore
        }
      }, 15000);

      req.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });

      return;
    }

    // ---------------------------
    // Log Viewer endpoints (snapshot + events)
    // ---------------------------

    if (req.method === "GET" && url.pathname === "/log/seeds") {
      const baseDir = url.searchParams.get("baseDir") ?? defaultWorldsBaseDir();
      writeJson(res, 200, { ok: true, baseDir, seeds: listSeeds(baseDir) }, corsOrigin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/log/runs") {
      const baseDir = url.searchParams.get("baseDir") ?? defaultWorldsBaseDir();
      const seed = parseIntParam(url.searchParams.get("seed"));
      if (seed === undefined) {
        writeJson(res, 400, { ok: false, error: "Missing/invalid seed" }, corsOrigin);
        return;
      }
      writeJson(res, 200, { ok: true, baseDir, seed, runIds: listSeedRunIds(baseDir, seed) }, corsOrigin);
      return;
    }

    if (req.method === "POST" && url.pathname === "/log/open") {
      let body: any;
      try {
        body = await readJson(req);
      } catch {
        writeJson(res, 400, { ok: false, error: "Invalid JSON body" }, corsOrigin);
        return;
      }

      const baseDir = (body?.baseDir && typeof body.baseDir === "string" ? body.baseDir : undefined) ?? defaultWorldsBaseDir();
      const seed = typeof body?.seed === "number" ? Math.floor(body.seed) : undefined;
      if (seed === undefined || !Number.isFinite(seed)) {
        writeJson(res, 400, { ok: false, error: "Missing/invalid seed" }, corsOrigin);
        return;
      }

      const runIdFromBody = typeof body?.runId === "string" && body.runId ? body.runId : undefined;
      const runId = runIdFromBody ?? listSeedRunIds(baseDir, seed)[0];
      if (!runId) {
        writeJson(res, 404, { ok: false, error: `No runs found for seed ${seed}` }, corsOrigin);
        return;
      }

      const p = persistedRunPaths({ seed, baseDir, runId });
      if (!fs.existsSync(p.snapshotPath) || !fs.existsSync(p.eventsPath)) {
        writeJson(res, 404, { ok: false, error: "Missing snapshot.json or events.jsonl", runDir: p.runDir }, corsOrigin);
        return;
      }

      let snapshot: any;
      try {
        snapshot = readRunSnapshot(p.snapshotPath);
      } catch (err: any) {
        writeJson(res, 500, { ok: false, error: `Failed to read snapshot: ${String(err?.message ?? err)}` }, corsOrigin);
        return;
      }

      let meta: any = undefined;
      if (fs.existsSync(p.metaPath)) {
        try {
          meta = readRunMeta(p.metaPath);
        } catch {
          // ignore bad meta
        }
      }

      let stats: any;
      try {
        stats = await readEventLogStats(p.eventsPath);
      } catch (err: any) {
        writeJson(res, 500, { ok: false, error: `Failed to read events: ${String(err?.message ?? err)}` }, corsOrigin);
        return;
      }

      const npcCount = snapshot?.world?.npcs ? Object.keys(snapshot.world.npcs).length : 0;
      const siteCount = snapshot?.world?.sites ? Object.keys(snapshot.world.sites).length : 0;

      writeJson(
        res,
        200,
        {
          ok: true,
          baseDir,
          seed,
          runId: p.runId,
          runDir: p.runDir,
          snapshotSummary: { createdAt: snapshot?.createdAt, tick: snapshot?.world?.tick ?? 0, npcCount, siteCount },
          meta,
          stats
        },
        corsOrigin
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/log/snapshot") {
      const baseDir = url.searchParams.get("baseDir") ?? defaultWorldsBaseDir();
      const seed = parseIntParam(url.searchParams.get("seed"));
      if (seed === undefined) {
        writeJson(res, 400, { ok: false, error: "Missing/invalid seed" }, corsOrigin);
        return;
      }

      const runIdParam = url.searchParams.get("runId");
      const wantLatest = !runIdParam || runIdParam === "latest";
      const snapshotPath = wantLatest
        ? path.join(baseDir, `seed-${seed}`, "snapshot.latest.json")
        : persistedRunPaths({ seed, baseDir, runId: runIdParam }).snapshotPath;

      if (!fs.existsSync(snapshotPath)) {
        writeJson(res, 404, { ok: false, error: `Snapshot not found: ${snapshotPath}` }, corsOrigin);
        return;
      }

      try {
        const raw = fs.readFileSync(snapshotPath, "utf8");
        setCors(res, corsOrigin);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(raw);
      } catch (err: any) {
        writeJson(res, 500, { ok: false, error: String(err?.message ?? err) }, corsOrigin);
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/log/events") {
      const baseDir = url.searchParams.get("baseDir") ?? defaultWorldsBaseDir();
      const seed = parseIntParam(url.searchParams.get("seed"));
      const runId = url.searchParams.get("runId");
      if (seed === undefined || !runId) {
        writeJson(res, 400, { ok: false, error: "Missing/invalid seed or runId" }, corsOrigin);
        return;
      }

      const p = persistedRunPaths({ seed, baseDir, runId });
      if (!fs.existsSync(p.eventsPath)) {
        writeJson(res, 404, { ok: false, error: `Events not found: ${p.eventsPath}` }, corsOrigin);
        return;
      }

      const kind = url.searchParams.get("kind") || undefined;
      const tickMin = parseIntParam(url.searchParams.get("tickMin"));
      const tickMax = parseIntParam(url.searchParams.get("tickMax"));

      setCors(res, corsOrigin);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");

      // Fast path: no filters, stream file as-is.
      if (!kind && tickMin === undefined && tickMax === undefined) {
        fs.createReadStream(p.eventsPath, { encoding: "utf8" }).pipe(res);
        return;
      }

      const input = fs.createReadStream(p.eventsPath, { encoding: "utf8" });
      const rl = readline.createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of rl) {
          if (!line) continue;
          let e: any;
          try {
            e = JSON.parse(line);
          } catch {
            continue;
          }

          if (kind && e.kind !== kind) continue;
          const t = typeof e.tick === "number" ? e.tick : undefined;
          if (tickMin !== undefined && t !== undefined && t < tickMin) continue;
          if (tickMax !== undefined && t !== undefined && t > tickMax) continue;
          res.write(line + "\n");
        }
        res.end();
      } catch {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/control") {
      let body: any;
      try {
        body = await readJson(req);
      } catch (err) {
        writeJson(res, 400, { ok: false, error: "Invalid JSON body" }, corsOrigin);
        return;
      }

      if (!isControlAction(body)) {
        writeJson(res, 400, { ok: false, error: "Invalid action" }, corsOrigin);
        return;
      }

      const action = body.action;
      if (action === "pause") runtime.pause();
      if (action === "play") runtime.play();
      if (action === "step") runtime.step();
      if (action === "reset") runtime.reset();
      if (action === "setSpeed") runtime.setSpeed(body.msPerTick);
      if (action === "setSeed") runtime.setSeed(body.seed);
      const st = runtime.state;
      writeJson(
        res,
        200,
        { ok: true, settings: st.settings, simTime: runtime.currentSimTime(), clients: clients.size },
        corsOrigin
      );
      return;
    }

    writeJson(res, 404, { ok: false, error: "Not found" }, corsOrigin);
  });

  server.listen(opts.port, opts.host ?? "0.0.0.0");
  return server;
}


