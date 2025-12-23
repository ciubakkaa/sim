import type { SimEvent, WorldMap, WorldState } from "../sim/types";

export type Vec2 = { x: number; y: number };

export type LayoutEdge = { from: string; to: string; points: Vec2[] };
export type MapLayout = {
  sites: Record<string, Vec2>;
  edges: LayoutEdge[];
  // Helpful for zoom-to-fit
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

export type SimTime = { tick: number; day: number; hourOfDay: number };

export type ViewerSettings = {
  seed: number;
  paused: boolean;
  msPerTick: number;
};

export type ViewerHelloMessage = {
  type: "hello";
  settings: ViewerSettings;
  map: WorldMap;
  layout: MapLayout;
  world: WorldState;
};

export type ViewerTickMessage = {
  type: "tick";
  settings: ViewerSettings;
  events: SimEvent[];
  world: WorldState;
};

export type ViewerSettingsMessage = {
  type: "settings";
  settings: ViewerSettings;
};

export type ViewerServerMessage = ViewerHelloMessage | ViewerTickMessage | ViewerSettingsMessage;

export type ControlAction =
  | { action: "pause" }
  | { action: "play" }
  | { action: "step" }
  | { action: "setSpeed"; msPerTick: number }
  | { action: "setSeed"; seed: number }
  | { action: "reset" };


