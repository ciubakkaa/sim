import fs from "node:fs";
import path from "node:path";
import type { WorldMap, WorldState } from "../sim/types";
import type { MapLayout, ViewerSettings } from "./protocol";

export type PersistRunOptions = {
  seed: number;
  /**
   * Base directory for world persistence. Default: logs/worlds
   * (relative to process cwd).
   */
  baseDir?: string;
  /**
   * Run folder id under seed-<seed>/runs/. Default: timestamp like 20251223-110658Z
   */
  runId?: string;
};

export type PersistedRunPaths = {
  baseDir: string;
  seed: number;
  seedDir: string;
  runId: string;
  runDir: string;
  latestSnapshotPath: string;
  snapshotPath: string;
  eventsPath: string;
  metaPath: string;
};

export type WorldSnapshot = {
  version: 1;
  seed: number;
  createdAt: string; // ISO
  world: WorldState;
  // Optional extras for UI convenience (not required to render roster/traits/factions).
  settings?: ViewerSettings;
  map?: WorldMap;
  layout?: MapLayout;
};

export type RunMeta = {
  version: 1;
  seed: number;
  runId: string;
  startedAt: string; // ISO
  argv?: string[];
  note?: string;
};

export function defaultWorldsBaseDir(): string {
  return path.join("logs", "worlds");
}

export function timestampRunId(d = new Date()): string {
  // 2025-12-14T12:34:56.789Z -> 20251214-123456Z
  const iso = d.toISOString();
  const ymd = iso.slice(0, 10).replaceAll("-", "");
  const hms = iso.slice(11, 19).replaceAll(":", "");
  return `${ymd}-${hms}Z`;
}

export function persistedRunPaths(opts: PersistRunOptions): PersistedRunPaths {
  const baseDir = opts.baseDir ?? defaultWorldsBaseDir();
  const seed = Math.floor(opts.seed);
  const runId = opts.runId ?? timestampRunId();

  const seedDir = path.join(baseDir, `seed-${seed}`);
  const runDir = path.join(seedDir, "runs", runId);
  return {
    baseDir,
    seed,
    seedDir,
    runId,
    runDir,
    latestSnapshotPath: path.join(seedDir, "snapshot.latest.json"),
    snapshotPath: path.join(runDir, "snapshot.json"),
    eventsPath: path.join(runDir, "events.jsonl"),
    metaPath: path.join(runDir, "meta.json")
  };
}

export function ensurePersistedRunDir(opts: PersistRunOptions): PersistedRunPaths {
  const p = persistedRunPaths(opts);
  fs.mkdirSync(p.runDir, { recursive: true });
  return p;
}

function atomicWriteJson(filePath: string, obj: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

export function writeRunSnapshot(paths: PersistedRunPaths, snapshot: WorldSnapshot): void {
  atomicWriteJson(paths.snapshotPath, snapshot);
  atomicWriteJson(paths.latestSnapshotPath, snapshot);
}

export function writeRunMeta(paths: PersistedRunPaths, meta: RunMeta): void {
  atomicWriteJson(paths.metaPath, meta);
}

export function readRunSnapshot(snapshotPath: string): WorldSnapshot {
  const raw = fs.readFileSync(snapshotPath, "utf8");
  return JSON.parse(raw) as WorldSnapshot;
}

export function listSeedRunIds(baseDir: string, seed: number): string[] {
  const seedDir = path.join(baseDir, `seed-${Math.floor(seed)}`);
  const runsDir = path.join(seedDir, "runs");
  if (!fs.existsSync(runsDir)) return [];
  const entries = fs.readdirSync(runsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
}


