<!--
  MessageReadIndicator — shows who has read this message.
  Backs M24 read-receipts UI slice 2.

  Composes with MessageReactionsBar inside MessageRow (per claude2's M17 UI
  extract rationale: per-row decorations live next to each other and don't
  re-thrash MessageList).

  Slice 2 contract:
    - On mount: POST one read receipt using the server-resolved browser
      session or pidChain identity (M24 backend is idempotent per the
      (messageId, readerHandle) pair, so a re-POST is a no-op).
    - Then poll GET every 10s for fresh reader counts. Cleanup on unmount.
    - Render the visible list inline ("Read by 3: @you, @kimi, @chair").
      Handles must be visible — never tooltip-only — per @evolveantcodex
      a11y guard for this slice.
    - Render nothing for an empty readers list. System and system-break
      rows never mount this component (MessageRow gates on kind).
    - Soft-fail every fetch error — the indicator is decorative, never
      blocks message rendering.
-->
<script lang="ts">
  import type { MessageReadReceipt } from '$lib/server/messageReadReceiptStore';

  const POLL_INTERVAL_MS = 10_000;

  type Props = {
    messageId: string;
    roomId: string;
    asHandle?: string;
    readReceiptEvent?: Record<string, unknown> | null;
  };

  let { messageId, roomId, asHandle, readReceiptEvent }: Props = $props();

  let readersFromServer = $state<MessageReadReceipt[]>([]);

  $effect(() => {
    if (readReceiptEvent?.type === 'message_read' &&
      readReceiptEvent.roomId === roomId &&
      readReceiptEvent.messageId === messageId &&
      Array.isArray(readReceiptEvent.readers)) {
      readersFromServer = readReceiptEvent.readers as MessageReadReceipt[];
    }
  });

  $effect(() => {
    let cancelled = false;
    let pollTimerId: ReturnType<typeof setInterval> | undefined;

    async function postOwnReadOnce() {
      try {
        await fetch(`/api/chat-rooms/${roomId}/messages/${messageId}/read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(asHandle ? { readerHandle: asHandle } : {})
          })
        });
      } catch {
        // soft-fail — decorative; the row still renders.
      }
    }

    async function pollReadersFromServer() {
      if (cancelled) return;
      try {
        const response = await fetch(
          `/api/chat-rooms/${roomId}/messages/${messageId}/read`
        );
        if (!response.ok) return;
        const body = (await response.json()) as { readers: MessageReadReceipt[] };
        if (!cancelled) readersFromServer = body.readers ?? [];
      } catch {
        // soft-fail.
      }
    }

    // Per-message mount-time fetches removed. Posting N read receipts + N
    // initial reader fetches on every page load (or every invalidateAll)
    // saturates the connection pool and crashes browsers when the room is
    // active. The SSE message_read events drive both directions now.
    void postOwnReadOnce; // referenced to keep TS happy for future re-use
    void pollReadersFromServer;

    return () => {
      cancelled = true;
      if (pollTimerId) clearInterval(pollTimerId);
    };
  });

  function describeReaderList(readers: MessageReadReceipt[]): string {
    return readers.map((entry) => entry.readerHandle).join(', ');
  }
</script>

{#if readersFromServer.length > 0}
  <p class="read-indicator" aria-live="polite">
    Read by {readersFromServer.length}:
    <span class="reader-handles">{describeReaderList(readersFromServer)}</span>
  </p>
{/if}

<style>
  .read-indicator {
    margin: 0.25rem 0 0;
    padding: 0;
    font-size: 0.75rem;
    color: var(--ink-soft);
    line-height: 1.35;
  }

  .reader-handles {
    color: var(--ink);
    word-break: break-word;
  }
</style>
