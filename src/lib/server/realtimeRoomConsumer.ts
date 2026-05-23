/**
 * realtimeRoomConsumer — node-side SSE subscription pattern per the SSE
 * consumer contract v0 (`docs/contracts/sse-consumer-contract-v0.md`).
 *
 * Why a custom client rather than EventSource: Node 22 has no built-in
 * EventSource, and the pane-router consumer (which is the primary v0
 * driver) runs server-side. This wrapper parses SSE frames out of a
 * fetch Response stream, calls the consumer's onEvent for each typed
 * event, and reconnects with backoff on any transport failure.
 *
 * Reconnect semantics:
 *   - Tracks lastSeq from each event's `seq` field
 *   - On reconnect, sends Last-Event-ID header (browser EventSource parity)
 *   - If seq goes backwards (server restarted), continue forward — the
 *     example pattern in the contract is the canonical behaviour
 *   - Exponential backoff capped at 30s
 *
 * The connection emits a synthetic `{ type: 'connected', latest_seq }`
 * frame on (re)connect. Consumers wanting "caught up" UX should compare
 * lastSeq against latest_seq.
 */

export type RealtimeRoomEvent = {
  type: string;
  seq?: number;
  latest_seq?: number;
  [field: string]: unknown;
};

export type RealtimeRoomConsumerOptions = {
  baseUrl: string;
  roomId: string;
  authBearer: string;
  onEvent: (event: RealtimeRoomEvent) => void;
  onConnectionState?: (state: 'connecting' | 'connected' | 'disconnected' | 'failed', detail?: { lastSeq: number; latestSeq?: number; cause?: unknown }) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  // Inject for tests; defaults to global fetch.
  fetchImpl?: typeof fetch;
};

export type RealtimeRoomConsumerHandle = {
  close: () => void;
  // Read-only accessor for tests + UX surfaces that want to render lastSeq.
  getLastSeq: () => number;
};

const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;

export function subscribeRoomEventsAsClient(
  options: RealtimeRoomConsumerOptions
): RealtimeRoomConsumerHandle {
  const fetchImpl = options.fetchImpl ?? fetch;
  const initialBackoff = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const maxBackoff = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  let lastSeq = 0;
  let aborted = false;
  let currentController: AbortController | null = null;
  let currentBackoff = initialBackoff;

  function reportState(
    state: 'connecting' | 'connected' | 'disconnected' | 'failed',
    detail?: { lastSeq: number; latestSeq?: number; cause?: unknown }
  ): void {
    if (!options.onConnectionState) return;
    try {
      options.onConnectionState(state, detail);
    } catch {
      /* finish-layer crash must not break the consumer loop */
    }
  }

  async function connect(): Promise<void> {
    while (!aborted) {
      const ctl = new AbortController();
      currentController = ctl;
      reportState('connecting', { lastSeq });

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${options.authBearer}`,
          Accept: 'text/event-stream'
        };
        if (lastSeq > 0) headers['Last-Event-ID'] = String(lastSeq);

        const res = await fetchImpl(
          `${options.baseUrl}/api/realtime/${encodeURIComponent(options.roomId)}/events`,
          { headers, signal: ctl.signal }
        );

        if (!res.ok || !res.body) {
          reportState('failed', { lastSeq, cause: `http ${res.status}` });
          await sleepWithBackoff();
          continue;
        }

        // Successful handshake — reset backoff for the next reconnect cycle.
        currentBackoff = initialBackoff;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let frameEnd: number;
          while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);
            const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
            if (!dataLine) continue; // heartbeat comment or id-only frame
            const payload = dataLine.slice(5).trim();
            if (payload.length === 0) continue;
            let event: RealtimeRoomEvent;
            try {
              event = JSON.parse(payload) as RealtimeRoomEvent;
            } catch {
              continue; // malformed; skip — never crash the loop
            }
            if (typeof event.seq === 'number') lastSeq = event.seq;
            if (event.type === 'connected' && typeof event.latest_seq === 'number') {
              reportState('connected', { lastSeq, latestSeq: event.latest_seq });
            }
            try {
              options.onEvent(event);
            } catch {
              /* consumer callback failure does NOT terminate the loop */
            }
          }
        }

        // Stream ended cleanly (server closed). Loop back to reconnect.
        reportState('disconnected', { lastSeq });
      } catch (cause) {
        if (aborted) break;
        reportState('failed', { lastSeq, cause });
      }

      if (!aborted) await sleepWithBackoff();
    }
  }

  async function sleepWithBackoff(): Promise<void> {
    const delay = currentBackoff;
    currentBackoff = Math.min(currentBackoff * 2, maxBackoff);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  void connect();

  return {
    close(): void {
      aborted = true;
      currentController?.abort();
    },
    getLastSeq(): number {
      return lastSeq;
    }
  };
}
