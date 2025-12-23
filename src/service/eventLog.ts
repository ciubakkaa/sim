import fs from "node:fs";
import path from "node:path";
import type { SimEvent } from "../sim/types";

export type EventLog = {
  path: string;
  appendEvents: (events: SimEvent[]) => void;
  close: () => void;
};

export function openEventLog(outPath: string): EventLog {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" });

  const appendEvents = (events: SimEvent[]) => {
    for (const e of events) stream.write(`${JSON.stringify(e)}\n`);
  };

  const close = () => {
    try {
      stream.end();
    } catch {
      // ignore
    }
  };

  return { path: outPath, appendEvents, close };
}


