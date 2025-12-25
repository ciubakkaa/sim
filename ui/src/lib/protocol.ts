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
  // Backend uses: public | local | private | secret (we also keep "system" for older payloads)
  visibility: "private" | "public" | "local" | "secret" | "system";
  siteId?: string;
  message: string;
  data?: Record<string, unknown>;
};

export type ScoreContribution = {
  kind:
    | "base"
    | "need"
    | "trait"
    | "memory"
    | "belief"
    | "relationship"
    | "siteCondition"
    | "stateMod"
    | "goalMod"
    | "specialCase"
    | "obligation";
  key?: string;
  delta: number;
  note?: string;
};

export type SocialDebt = {
  id: string;
  otherNpcId: string;
  direction: "owes" | "owed";
  debtKind: string;
  magnitude: number;
  reason: string;
  createdTick: number;
  dueTick?: number;
  settledTick?: number;
  settled?: boolean;
};

export type NpcInventory = {
  coins: number;
  food: Partial<Record<string, number>>;
  items?: Record<string, number>;
};

export type KnowledgeFact = {
  id: string;
  kind: string;
  subjectId: string;
  object?: string;
  confidence: number;
  source: string;
  tick: number;
};

export type SecretKnowledge = {
  secretId: string;
  confidence: number;
  learnedTick: number;
  source: string;
};

export type NpcKnowledge = {
  facts: KnowledgeFact[];
  secrets: SecretKnowledge[];
};

export type PlanState = {
  id: string;
  goal: string;
  createdTick: number;
  steps: { kind: string; note?: string }[];
  stepIndex: number;
  reason: string;
};

export type ChronicleEntry = {
  id: string;
  tick: number;
  kind: string;
  significance: string;
  siteId?: string;
  headline: string;
  description: string;
  primaryNpcId?: string;
  otherNpcIds?: string[];
  sourceEventId?: string;
};

export type StoryBeat = {
  id: string;
  tick: number;
  kind: string;
  siteId?: string;
  primaryNpcId?: string;
  description: string;
  sourceEventId?: string;
};

export type ChronicleState = {
  entries: ChronicleEntry[];
  beats: StoryBeat[];
  arcs?: NarrativeArc[];
};

export type FactionOperation = {
  id: string;
  factionId: string;
  type: string;
  siteId: string;
  targetNpcId?: string;
  leaderNpcId: string;
  participantNpcIds: string[];
  participantRoles?: Record<string, "leader" | "enforcer" | "scout" | "lookout">;
  createdTick: number;
  status: string;
  executeAfterTick?: number;
  note?: string;
  phases?: { kind: string; note?: string }[];
  phaseIndex?: number;
  failures?: number;
};

export type NarrativeAct = {
  name: string;
  startedTick?: number;
  endedTick?: number;
};

export type NarrativeArc = {
  id: string;
  kind: string;
  title: string;
  status: string;
  startTick: number;
  endTick?: number;
  siteId?: string;
  factionId?: string;
  operationId?: string;
  acts: NarrativeAct[];
  actIndex: number;
};

export type AttemptWhy = {
  text: string;
  activeGoalIds: string[];
  selectedGoalIds: string[];
  obligations: string[];
  drivers: ScoreContribution[];
};

export type ActiveGoal = {
  definitionId: string;
  formedTick: number;
  targetNpcId?: string;
  targetSiteId?: string;
  priority: number;
  data: Record<string, unknown>;
};

export type RecentAction = { kind: string; tick: number; why?: AttemptWhy };

export type NpcIntent = {
  id: string;
  kind: string;
  formedTick: number;
  intensity: number;
  executeAtTick?: number;
  targetNpcId?: string;
  targetSiteId?: string;
  lastSignaledTick?: number;
  whyText?: string;
  data?: Record<string, unknown>;
};

export type NpcState = {
  id: string;
  name: string;
  category: string;
  siteId: string;
  homeSiteId: string;
  familyIds?: string[];
  goals?: ActiveGoal[];
  intents?: NpcIntent[];
  recentActions?: RecentAction[];
  alive: boolean;
  death?: { tick: number; cause: string; byNpcId?: string; atSiteId?: string };
  emotions?: { anger: number; fear: number; grief: number; gratitude: number; pride: number; shame: number; stress: number };
  episodicMemory?: unknown[];
  homeLocationId?: string;
  local?: { siteId: string; locationId: string };
  localTravel?: {
    siteId: string;
    fromLocationId: string;
    toLocationId: string;
    totalMeters: number;
    remainingMeters: number;
    startedTick: number;
    lastProgressTick: number;
    purposeKind?: string;
  };
  cult?: { member: boolean; role: string; joinedTick?: number };
  hp: number;
  maxHp: number;
  trauma: number;
  notability: number;
  needs: Record<string, number>;
  traits: Record<string, number>;
  beliefs: unknown[];
  relationships: Record<string, unknown>;
  debts?: SocialDebt[];
  inventory?: NpcInventory;
  knowledge?: NpcKnowledge;
  plan?: PlanState;
  travel?: { from: string; to: string; totalKm: number; remainingKm: number; edgeQuality: "road" | "rough" };
  status?: {
    detained?: { untilTick: number; byNpcId: string; atSiteId: string };
    eclipsing?: { completeTick: number; reversibleUntilTick: number };
  };
  busyUntilTick: number;
  busyKind?: string;
};

export type SiteState = { id: string; kind: string; name: string; culture: string } & Record<string, unknown>;

export type LocalPos = { x: number; y: number };
export type LocalNode = { id: string; kind: string; name: string; pos: LocalPos; capacity?: number; meta?: Record<string, unknown> };
export type LocalEdge = { from: string; to: string; meters: number };
export type BuildingState = { id: string; inventory: { food?: Record<string, number>; items?: Record<string, number>; books?: number } };
export type SettlementLocal = { nodes: LocalNode[]; edges: LocalEdge[]; buildings: Record<string, BuildingState> };
export type SettlementSiteState = SiteState & { kind: "settlement"; local?: SettlementLocal };

export type WorldState = {
  seed: number;
  tick: number;
  map: WorldMap;
  sites: Record<string, SiteState | SettlementSiteState>;
  npcs: Record<string, NpcState>;
  operations?: Record<string, FactionOperation>;
  chronicle?: ChronicleState;
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


