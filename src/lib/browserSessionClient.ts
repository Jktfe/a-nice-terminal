type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status?: number;
  text?: () => Promise<string>;
}>;

const establishedSessionKeys = new Set<string>();

export type EnsureBrowserSessionInput = {
  roomId: string;
  authorHandle: string;
  fetcher?: FetchLike;
  /** Skip the in-memory cache and re-POST. Use when a previous send
   *  surfaced a 403 — the cookie may have been path-scoped to a stale
   *  room or expired in the gap. */
  force?: boolean;
};

export type EnsureBrowserSessionResult =
  | { ok: true; cached: boolean }
  | { ok: false; reason: string; status?: number };

function sessionKey(roomId: string, authorHandle: string): string {
  return `${roomId}:${authorHandle}`;
}

/**
 * Mint (or confirm) a browser session for (roomId, authorHandle).
 *
 * Returns a result object so callers can SURFACE the failure reason
 * instead of treating a silent network/auth failure as "ok" — the
 * previous boolean-returning shape masked the JWPK msg_qyqcuxgbun
 * symptom (ChatComposer's $effect fired the POST with a transient
 * undefined authorHandle, the route 400'd, the catch swallowed the
 * error, and the next send hit "Server-resolved identity required"
 * with no visible breadcrumb).
 *
 * Guard rails:
 *   - Empty / undefined authorHandle → returns { ok:false, reason:'no-handle' }
 *     WITHOUT firing the network call. Caller awaits a real handle
 *     before trying again.
 *   - 400 / 403 / 404 surface the server's message verbatim so the
 *     operator sees the actual cause ("authorHandle is not a room
 *     member", "Room not found", etc).
 *   - Network rejection → reason='network: <original error>'.
 *
 * The in-memory cache is still keyed by (roomId, handle) so a successful
 * mint avoids re-POST on subsequent calls until the page reload. The
 * `force` flag bypasses the cache for the explicit retry path after a
 * downstream 403.
 */
export async function ensureBrowserSessionForRoom(input: EnsureBrowserSessionInput): Promise<EnsureBrowserSessionResult> {
  const trimmedHandle = input.authorHandle?.trim() ?? '';
  if (trimmedHandle.length === 0) {
    return { ok: false, reason: 'no-handle' };
  }
  const key = sessionKey(input.roomId, trimmedHandle);
  if (input.force !== true && establishedSessionKeys.has(key)) {
    return { ok: true, cached: true };
  }
  const fetcher = input.fetcher ?? fetch;
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetcher(`/api/chat-rooms/${input.roomId}/browser-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorHandle: trimmedHandle })
    });
  } catch (cause) {
    return {
      ok: false,
      reason: `network: ${cause instanceof Error ? cause.message : String(cause)}`
    };
  }
  if (!response.ok) {
    let serverMessage = '';
    try {
      const raw = (await response.text?.()) ?? '';
      serverMessage = raw;
      const parsed = raw.length > 0 ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.message === 'string') serverMessage = parsed.message;
    } catch {
      /* keep raw text if it wasn't JSON */
    }
    return {
      ok: false,
      status: response.status,
      reason: serverMessage || `http ${response.status}`
    };
  }
  establishedSessionKeys.add(key);
  return { ok: true, cached: false };
}

export function forgetBrowserSessionForRoom(input: Pick<EnsureBrowserSessionInput, 'roomId' | 'authorHandle'>): void {
  establishedSessionKeys.delete(sessionKey(input.roomId, input.authorHandle));
}

export function resetBrowserSessionClientForTests(): void {
  establishedSessionKeys.clear();
}
