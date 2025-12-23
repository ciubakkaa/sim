import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SimRuntime } from "./runtime";
import type { ControlAction, ViewerServerMessage } from "./protocol";

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


