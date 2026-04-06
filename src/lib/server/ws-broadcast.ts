// ANT v3 — WebSocket broadcast singleton
// Bridges SvelteKit API routes → the WS server in server.ts
// API routes call broadcast(); server.ts registers/deregisters clients here.

interface WSClient {
  sessionId: string;       // which chat/terminal session this client has joined
  handle: string | null;   // @handle of the joined session (null if unregistered)
  send: (msg: string) => void;
  readyState: number;
}

// Keyed by an opaque ID so the same socket can be deregistered cleanly
const clients = new Map<symbol, WSClient>();

export function registerClient(key: symbol, client: WSClient) {
  clients.set(key, client);
}

export function deregisterClient(key: symbol) {
  clients.delete(key);
}

export function updateClientHandle(key: symbol, handle: string | null) {
  const c = clients.get(key);
  if (c) c.handle = handle;
}

/**
 * Broadcast a message to all WS clients that have joined `sessionId`.
 * If `target` is set (e.g. '@james'), only deliver to clients whose session
 * handle matches. `null` / '@everyone' = deliver to all joined clients.
 */
export function broadcast(sessionId: string, msg: object, target?: string | null) {
  const json = JSON.stringify(msg);
  const targeted = target && target !== '@everyone';

  for (const client of clients.values()) {
    if (client.sessionId !== sessionId) continue;
    if (client.readyState !== 1) continue; // WS OPEN
    if (targeted && client.handle !== target) continue;
    try { client.send(json); } catch {}
  }
}
