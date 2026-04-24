// ANT v3 — WebSocket broadcast singleton
// Bridges SvelteKit API routes → the WS server in server.ts
// API routes call broadcast(); server.ts registers/deregisters clients here.

interface WSClient {
  sessionId?: string;       // legacy/current joined session
  sessionIds?: Set<string>; // all chat/terminal sessions this client has joined
  handle: string | null;    // legacy/current @handle of the joined session
  handles?: Map<string, string | null>; // @handle per joined session
  send: (msg: string) => void;
  readyState: number;
  lastSeen?: number;       // timestamp of last heartbeat
}

// globalThis singleton — survives module duplication between tsx and SvelteKit build.
// WITHOUT THIS, server.ts registers clients into one Map and API routes broadcast to a different empty Map.
const G = globalThis as typeof globalThis & { __antWsBroadcast?: Map<symbol, WSClient> };
if (!G.__antWsBroadcast) G.__antWsBroadcast = new Map();
const clients = G.__antWsBroadcast;

export function registerClient(key: symbol, client: WSClient) {
  client.lastSeen = Date.now();
  clients.set(key, client);
}

export function deregisterClient(key: symbol) {
  clients.delete(key);
}

export function updateClientHandle(key: symbol, handle: string | null) {
  const c = clients.get(key);
  if (!c) return;
  c.handle = handle;
  if (c.sessionId) {
    if (!c.handles) c.handles = new Map();
    c.handles.set(c.sessionId, handle);
  }
}

export function joinClientSession(key: symbol, sessionId: string, handle: string | null) {
  const c = clients.get(key);
  if (!c) return;
  if (!c.sessionIds) {
    c.sessionIds = new Set(c.sessionId ? [c.sessionId] : []);
  }
  if (!c.handles) {
    c.handles = new Map(c.sessionId ? [[c.sessionId, c.handle ?? null]] : []);
  }
  c.sessionIds.add(sessionId);
  c.handles.set(sessionId, handle);
  c.sessionId = sessionId;
  c.handle = handle;
}

export function leaveClientSession(key: symbol, sessionId: string) {
  const c = clients.get(key);
  if (!c) return;
  c.sessionIds?.delete(sessionId);
  c.handles?.delete(sessionId);

  if (c.sessionId === sessionId) {
    const fallback = c.sessionIds ? Array.from(c.sessionIds).at(-1) : undefined;
    c.sessionId = fallback;
    c.handle = fallback ? (c.handles?.get(fallback) ?? null) : null;
  }
}

export function updateClientPresence(key: symbol) {
  const c = clients.get(key);
  if (c) c.lastSeen = Date.now();
}

function hasJoinedSession(client: WSClient, sessionId: string): boolean {
  return client.sessionIds?.has(sessionId) || client.sessionId === sessionId;
}

function handleForSession(client: WSClient, sessionId: string): string | null {
  return client.handles?.get(sessionId) ?? client.handle ?? null;
}

/**
 * Get the presence status for all clients in a session.
 */
export function getPresence(sessionId: string) {
  const presence: Record<string, { lastSeen: number; status: 'active' | 'idle' | 'offline' }> = {};
  const now = Date.now();

  for (const client of clients.values()) {
    if (!hasJoinedSession(client, sessionId)) continue;
    const handle = handleForSession(client, sessionId);
    if (!handle) continue;
    
    const lastSeen = client.lastSeen || 0;
    const diff = now - lastSeen;
    let status: 'active' | 'idle' | 'offline' = 'active';
    
    if (diff > 300000) status = 'offline';
    else if (diff > 60000) status = 'idle';
    
    // Only keep the most recent for a handle
    if (!presence[handle] || presence[handle].lastSeen < lastSeen) {
      presence[handle] = { lastSeen, status };
    }
  }
  return presence;
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
    if (!hasJoinedSession(client, sessionId)) continue;
    if (client.readyState !== 1) continue; // WS OPEN
    if (targeted && handleForSession(client, sessionId) !== target) continue;
    try { client.send(json); } catch {}
  }
}

/**
 * Broadcast a message to ALL connected WS clients regardless of which session
 * they have joined. Used for dashboard-level notifications (needs-input badges,
 * idle attention, etc.) that aren't scoped to a single chat/session channel.
 */
export function broadcastGlobal(msg: object) {
  const json = JSON.stringify(msg);
  for (const client of clients.values()) {
    if (client.readyState !== 1) continue;
    try { client.send(json); } catch {}
  }
}
