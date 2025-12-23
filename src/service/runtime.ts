import { createWorld } from "../sim/worldSeed";
import { tickHour } from "../sim/tick";
import type { SimEvent, TickResult, WorldState } from "../sim/types";
import { tickToDay, tickToHourOfDay } from "../sim/types";
import type { MapLayout, ViewerSettings, ViewerServerMessage } from "./protocol";
import { computeDeterministicLayout } from "./layout";

export type RuntimeOptions = {
  seed: number;
  msPerTick: number;
  paused?: boolean;
  maxCatchupTicks?: number;
};

export type RuntimeState = {
  settings: ViewerSettings;
  world: WorldState;
  layout: MapLayout;
};

export type RuntimeListener = (msg: ViewerServerMessage) => void;

export class SimRuntime {
  private opts: Required<RuntimeOptions>;
  private interval: NodeJS.Timeout | undefined;
  private lastWallTimeMs = 0;

  private _settings: ViewerSettings;
  private _world: WorldState;
  private _layout: MapLayout;

  private listeners = new Set<RuntimeListener>();

  constructor(opts: RuntimeOptions) {
    this.opts = {
      seed: opts.seed,
      msPerTick: opts.msPerTick,
      paused: opts.paused ?? true,
      maxCatchupTicks: opts.maxCatchupTicks ?? 5
    };
    this._settings = { seed: this.opts.seed, paused: this.opts.paused, msPerTick: this.opts.msPerTick };
    this._world = createWorld(this._settings.seed);
    this._layout = computeDeterministicLayout(this._world.map, this._settings.seed);
  }

  get state(): RuntimeState {
    return { settings: { ...this._settings }, world: this._world, layout: this._layout };
  }

  on(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.interval) return;
    this.lastWallTimeMs = Date.now();
    this.interval = setInterval(() => this.pump(), 50);
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }

  pause(): void {
    if (this._settings.paused) return;
    this._settings = { ...this._settings, paused: true };
    this.emit({ type: "settings", settings: this._settings });
  }

  play(): void {
    if (!this._settings.paused) return;
    this._settings = { ...this._settings, paused: false };
    this.lastWallTimeMs = Date.now();
    this.emit({ type: "settings", settings: this._settings });
  }

  setSpeed(msPerTick: number): void {
    const ms = Math.max(50, Math.floor(msPerTick));
    if (ms === this._settings.msPerTick) return;
    this._settings = { ...this._settings, msPerTick: ms };
    this.emit({ type: "settings", settings: this._settings });
  }

  setSeed(seed: number): void {
    const s = Math.floor(seed);
    if (!Number.isFinite(s)) return;
    this._settings = { ...this._settings, seed: s };
    this._world = createWorld(this._settings.seed);
    this._layout = computeDeterministicLayout(this._world.map, this._settings.seed);
    // Emit a tick message with empty events as a “hard snapshot”
    this.emit({ type: "tick", settings: this._settings, events: [], world: this._world });
  }

  reset(): void {
    this._world = createWorld(this._settings.seed);
    this._layout = computeDeterministicLayout(this._world.map, this._settings.seed);
    this.emit({ type: "tick", settings: this._settings, events: [], world: this._world });
  }

  step(): TickResult {
    const res = tickHour(this._world);
    this._world = res.world;
    this.emit({ type: "tick", settings: this._settings, events: res.events, world: this._world });
    return res;
  }

  helloMessage(): ViewerServerMessage {
    return { type: "hello", settings: this._settings, map: this._world.map, layout: this._layout, world: this._world };
  }

  currentSimTime(): { tick: number; day: number; hourOfDay: number } {
    return { tick: this._world.tick, day: tickToDay(this._world.tick), hourOfDay: tickToHourOfDay(this._world.tick) };
  }

  private pump(): void {
    if (this._settings.paused) return;

    const now = Date.now();
    const elapsed = now - this.lastWallTimeMs;
    if (elapsed < this._settings.msPerTick) return;

    const ticksToRun = Math.min(this.opts.maxCatchupTicks, Math.floor(elapsed / this._settings.msPerTick));
    if (ticksToRun <= 0) return;

    // Advance wall time by the ticks we actually run (prevents drift explosions).
    this.lastWallTimeMs += ticksToRun * this._settings.msPerTick;

    for (let i = 0; i < ticksToRun; i++) this.step();
  }

  private emit(msg: ViewerServerMessage): void {
    for (const l of this.listeners) l(msg);
  }
}

export function npcNowLabel(npc: any, worldTick: number): string {
  if (!npc?.alive) return "Dead";
  if (npc.travel && npc.travel.remainingKm > 0) return `Traveling ${npc.travel.from} → ${npc.travel.to}`;
  if (npc.status?.detained && npc.status.detained.untilTick > worldTick) return `Detained (until t${npc.status.detained.untilTick})`;
  if (npc.status?.eclipsing && npc.status.eclipsing.completeTick > worldTick) return `Eclipsing (until t${npc.status.eclipsing.completeTick})`;
  if (npc.busyUntilTick && npc.busyUntilTick > worldTick) return npc.busyKind ? `Busy: ${npc.busyKind}` : "Busy";
  return "Idle";
}


