export type CapabilityStatus = 'KEEP' | 'CHANGE' | 'DEDUPE' | 'DEFER' | 'REJECT' | 'UNKNOWN';

export type RoomAttentionState = 'ready' | 'working' | 'asking' | 'blocked' | 'stale';

export type AgentAttentionState =
  | 'ready'
  | 'working'
  | 'thinking'
  | 'asking'
  | 'waiting'
  | 'stale'
  | 'failed';

export type ModelCostTier = 'cheap' | 'balanced' | 'premium' | 'local';

export type AgentModel = {
  modelName: string;
  costTier: ModelCostTier;
};

export type DecisionOption = {
  letter: 'A' | 'B' | 'C';
  title: string;
  tradeOff: string;
  effect: string;
};

export type PreparedQuestion = {
  id: string;
  roomName: string;
  agentName: string;
  question: string;
  whyItMatters: string;
  recommendedOption: DecisionOption['letter'];
  options: DecisionOption[];
};

/**
 * Wire-safe subset of the server-side `RoomMember` (chatRoomStore.ts).
 *
 * The server emits `{ handle, displayName, joinedAt, kind }` on every member
 * inside the `/api/chat-rooms` response. This client-shared type intentionally
 * mirrors a SUBSET of those fields and stays in $lib/domain so route load
 * functions and components can both lean on it without dragging server-side
 * imports into the browser bundle. `joinedAt` is omitted because the
 * dashboard chip vocabulary doesn't need it; add it back here if a future
 * card needs to show join-times.
 */
export type RoomMemberCard = {
  handle: string;
  displayName?: string;
  kind?: 'human' | 'agent';
};

export type RoomCard = {
  id: string;
  name: string;
  /** Auto-derived from the latest message (latest-message preview). */
  summary: string;
  /** Optional user/agent-authored description (JWPK 2026-05-24
   *  yz4clwzvbm msg_jj50zw48fr). When set, surfaces shown the room
   *  card SHOULD prefer this over `summary` for the body text. */
  description?: string | null;
  attentionState: RoomAttentionState;
  lastUpdate: string;
  members?: RoomMemberCard[];
};

export type AgentCard = {
  id: string;
  name: string;
  role: string;
  attentionState: AgentAttentionState;
  agentModel: AgentModel;
  tokenCountForThisSession: number;
};

export type SessionTracker = {
  id: string;
  label: string;
  codename: string;
  agentModel: AgentModel;
  tokenBudgetPerDay: number;
  watchingRoomCount: number;
  lastSweep: string;
  nextSweep: string;
  escalationsWaiting: number;
};

export type CapabilityLedgerRow = {
  capability: string;
  source: string;
  status: CapabilityStatus;
  owner: 'Claude' | 'Codex' | 'Unassigned';
  note: string;
};
