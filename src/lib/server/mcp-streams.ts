// Open MCP-SSE stream registry.
//
// Each /mcp/room/:id/stream connection registers itself here at start and
// deregisters on cancel. revokeInvite/revokeToken in room-invites.ts call
// closeByInviteId / closeByTokenId so a revoke immediately tears down the
// long-lived SSE connections it just invalidated, not just blocking new
// ones.
//
// globalThis singleton pattern — see feedback_globalthis_pattern.md. Without
// this, the SSE route (built into .svelte-kit/output) registers into one Map
// while room-invites.ts (loaded at server boot via a different module graph)
// reads a different empty Map, and revoke silently no-ops.

interface OpenStream {
  tokenId: string;
  inviteId: string;
  roomId: string;
  close: (reason: 'revoked' | 'shutdown') => void;
}

const G = globalThis as typeof globalThis & { __antMcpStreams?: Map<symbol, OpenStream> };
if (!G.__antMcpStreams) G.__antMcpStreams = new Map();
const streams = G.__antMcpStreams;

export function registerStream(key: symbol, stream: OpenStream): void {
  streams.set(key, stream);
}

export function deregisterStream(key: symbol): void {
  streams.delete(key);
}

export function closeByTokenId(tokenId: string): number {
  let n = 0;
  for (const [key, s] of streams) {
    if (s.tokenId !== tokenId) continue;
    try { s.close('revoked'); } catch {}
    streams.delete(key);
    n++;
  }
  return n;
}

export function closeByInviteId(inviteId: string): number {
  let n = 0;
  for (const [key, s] of streams) {
    if (s.inviteId !== inviteId) continue;
    try { s.close('revoked'); } catch {}
    streams.delete(key);
    n++;
  }
  return n;
}

// Diagnostic — used by the smoke tests. Don't expose externally.
export function _streamCount(): number {
  return streams.size;
}
