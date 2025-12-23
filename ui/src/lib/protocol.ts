export type Vec2 = { x: number; y: number };

export type LayoutEdge = { from: string; to: string; points: Vec2[] };
export type MapLayout = {
  sites: Record<string, Vec2>;
  edges: LayoutEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

export type ViewerSettings = {
  seed: number;
  paused: boolean;
  msPerTick: number;
};

export type WorldMap = {
  sites: string[];
  edges: { from: string; to: string; km: number; quality?: "road" | "rough" }[];
};

export type SimEvent = {
  id: string;
  tick: number;
  kind: string;
  visibility: "private" | "public" | "system";
  siteId?: string;
  message: string;
  data?: Record<string, unknown>;
};

export type NpcState = {
  id: string;
  name: string;
  category: string;
  siteId: string;
  homeSiteId: string;
  alive: boolean;
  cult?: { member: boolean; role: string; joinedTick?: number };
  hp: number;
  maxHp: number;
  trauma: number;
  notability: number;
  needs: Record<string, number>;
  traits: Record<string, number>;
  beliefs: unknown[];
  relationships: Record<string, unknown>;
  travel?: { from: string; to: string; totalKm: number; remainingKm: number; edgeQuality: "road" | "rough" };
  status?: {
    detained?: { untilTick: number; byNpcId: string; atSiteId: string };
    eclipsing?: { completeTick: number; reversibleUntilTick: number };
  };
  busyUntilTick: number;
  busyKind?: string;
};

export type SiteState = { id: string; kind: string; name: string; culture: string } & Record<string, unknown>;

export type WorldState = {
  seed: number;
  tick: number;
  map: WorldMap;
  sites: Record<string, SiteState>;
  npcs: Record<string, NpcState>;
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


