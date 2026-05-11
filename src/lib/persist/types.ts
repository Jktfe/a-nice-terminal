// Phase A of server-split-2026-05-11 — types for the Tier-1 persist
// library. Lives apart from the runtime modules so it's safe to
// import from anywhere (CLI tsconfig, server, MCP) without dragging
// in SvelteKit-only deps.

export interface MessageInput {
  sessionId: string;
  role: string;
  content: string;
  format?: string;
  senderId?: string | null;
  target?: string | null;
  replyTo?: string | null;
  msgType?: string;
  meta?: Record<string, unknown> | string;
  asks?: string[];
  // `source` identifies the caller of writeMessage(). Stored on the
  // message row's meta for provenance and gates the direct-write
  // authorization path. 'replay' is intentionally not a valid input
  // value — replays act on existing rows via runSideEffects, not on
  // new writeMessage calls.
  source: 'http' | 'cli' | 'mcp';
}

export interface PersistedMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  format: string;
  status: string;
  sender_id: string | null;
  target: string | null;
  reply_to: string | null;
  msg_type: string;
  meta: string;
  broadcast_state: 'pending' | 'done' | 'failed' | 'expired';
}

export interface SenderResolved {
  name: string;
  type: string | null;
}

// Shape matches AskRow in src/lib/server/consent/consent-gate-ask.ts and
// the schema in queries.getAsk / queries.createAsk. Keeping the explicit
// alignment so consentGateAsk + emitAskRunEvent accept the same object.
export interface CreatedAsk {
  id: string;
  session_id: string;
  title: string;
  body: string;
  status: string;
  assigned_to: string;
  owner_kind: string;
  inferred: number;
  meta: string;
  [key: string]: unknown;
}

export interface RoutingHints {
  // Phase A keeps this minimal — only fields the immediate side-effect
  // block needs. Phase B adds allowPtyInject (driven by replay age).
  askIds: string[];
}

export interface WriteMessageResult {
  message: PersistedMessage;
  asks: CreatedAsk[];
  firstPost: boolean;
  isLinkedChat: boolean;
  senderResolved: SenderResolved;
  routingHints: RoutingHints;
}

export class WriteMessageError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WriteMessageError';
    this.status = status;
  }
}
