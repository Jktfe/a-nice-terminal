<!--
  MessageList — wraps a chat room's messages in a scrollable section and
  delegates per-row rendering to MessageRow. Slimmed down for M17 UI
  slice 2 so per-message concerns (reactions today, read-receipts and
  threading later) live in MessageRow rather than swelling this file.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { ChatMessage } from '$lib/server/chatMessageStore';
  import type { RoomMember } from '$lib/server/chatRoomStore';
  import type { EntityClaim } from '$lib/server/entityClaimStore';
  import { groupMessagesByThread } from '$lib/chat/groupMessagesByThread';
  import { countDirectRepliesByParent } from '$lib/chat/countDirectRepliesByParent';
  import MessageRow from './MessageRow.svelte';

  type Props = {
    messages: ChatMessage[];
    members?: RoomMember[];
    asHandle?: string;
    onReplyRequested?: (messageId: string) => void;
    hasOlderMessages?: boolean;
    isLoadingOlder?: boolean;
    onLoadOlder?: () => Promise<void> | void;
    readReceiptEvent?: Record<string, unknown> | null;
    /** Room id powering the bulk claim hydrate — without it the chips
     *  render empty (back-compat with callers that haven't threaded
     *  the id through yet). */
    roomId?: string;
    /** Room mode determines whether 🤝 working renders amber (brainstorm
     *  soft) or red (heads-down hard) in ClaimChip. */
    roomMode?: 'brainstorm' | 'heads-down' | 'closed';
  };

  let {
    messages,
    members = [],
    asHandle,
    onReplyRequested,
    hasOlderMessages = false,
    isLoadingOlder = false,
    onLoadOlder,
    readReceiptEvent,
    roomId,
    roomMode = 'brainstorm'
  }: Props = $props();

  // JWPK M6 UI slice 1: hydrate the entity_claims ledger for the
  // currently-loaded message set so MessageRow can render a ClaimChip
  // without a per-row fetch. Single bulk GET with entityIds; refires
  // when the visible message ids change. Live realtime updates land in
  // a follow-up slice when claim events ride the SSE channel.
  let claimsByMessageId = $state<Map<string, EntityClaim[]>>(new Map());
  // Bumping this nonce triggers the $effect below to re-hydrate the
  // bulk claim cache. ClaimActionBar fires onClaimChanged through to
  // here whenever a claim is minted / released so the chips refresh
  // without waiting for the next route-load.
  let claimRefreshNonce = $state(0);

  function refreshClaims(): void {
    claimRefreshNonce += 1;
  }

  // Stable joined-ids key so the $effect re-fires only when the SET of
  // ids changes, not on every messages-prop update (e.g. typing a new
  // message doesn't reset the claim cache).
  const messageIdsKey = $derived(messages.map((m) => m.id).sort().join(','));

  $effect(() => {
    // Read the nonce so the $effect re-fires on demand-refresh.
    claimRefreshNonce;
    if (!roomId || messageIdsKey.length === 0) return;
    const ids = messageIdsKey.split(',').filter(Boolean);
    if (ids.length === 0) return;
    const params = new URLSearchParams({ entityKind: 'message', entityIds: ids.join(',') });
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/claims?${params}`);
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { claims?: EntityClaim[] };
        const next = new Map<string, EntityClaim[]>();
        for (const claim of body.claims ?? []) {
          if (claim.entity_kind !== 'message') continue;
          const bucket = next.get(claim.entity_id) ?? [];
          bucket.push(claim);
          next.set(claim.entity_id, bucket);
        }
        if (!cancelled) claimsByMessageId = next;
      } catch {
        /* claims hydration is best-effort; chip just renders empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  });
  let listElement = $state<HTMLElement | null>(null);
  let shouldFollowBottom = $state(true);
  let isRequestingOlder = $state(false);
  // Initial mount + smooth-scroll-to-bottom both pass through scrollTop=0
  // before the layout settles. Suppress the load-older handler for a brief
  // grace window after mount so it doesn't fire on the initial settle scroll
  // (which would fetch 100 extra messages, double the markdown render, and
  // potentially lock the JS thread on heavy rooms).
  const mountedAt = Date.now();

  // M30 slice 3d: pure client-side reorder for threaded display. Storage
  // and API order remain postOrder; only the rendered iteration changes.
  const grouped = $derived(groupMessagesByThread(messages));
  // M30 slice 3e: direct-reply counts per parent, passed down to
  // MessageRow so parent rows can render a "↳ N" badge. Map lookup
  // falls back to 0 for non-parents so the badge is omitted.
  const replyCounts = $derived(countDirectRepliesByParent(messages));
  // JWPK msg_wcq5fwlhg7: replies need to surface WHAT they are replying
  // to. Build a (messageId → message) lookup so MessageRow can resolve
  // its parent without an extra fetch and render a truncated preview.
  // The parent might be off-screen due to paging (older messages not
  // loaded yet) — in which case the lookup returns undefined and the
  // row renders the bare "↳ Reply" indicator like before.
  const messagesById = $derived(new Map(messages.map((m) => [m.id, m])));
  const membersByHandle = $derived(
    new Map(members.map((member) => [member.handle, member]))
  );
  const viewerIsAgent = $derived.by(() => {
    const handle = asHandle?.trim();
    if (!handle) return false;
    return membersByHandle.get(handle)?.kind === 'agent';
  });
  const newestMessageId = $derived(messages.at(-1)?.id ?? '');

  function isNearBottom(element: HTMLElement): boolean {
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom < 100;
  }

  async function handleScroll() {
    if (!listElement) return;
    shouldFollowBottom = isNearBottom(listElement);
    if (
      listElement.scrollTop <= 40 &&
      hasOlderMessages &&
      !isLoadingOlder &&
      !isRequestingOlder &&
      onLoadOlder &&
      Date.now() - mountedAt > 1500
    ) {
      const previousScrollHeight = listElement.scrollHeight;
      isRequestingOlder = true;
      try {
        await onLoadOlder();
        await tick();
        if (listElement) {
          listElement.scrollTop = listElement.scrollHeight - previousScrollHeight + listElement.scrollTop;
        }
      } finally {
        isRequestingOlder = false;
      }
    }
  }

  async function scrollToBottom() {
    await tick();
    if (!listElement) return;
    // Smooth scroll for visual continuity with the message fly-in.
    // Falls back to instant if reduced-motion is on.
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReduced) {
      listElement.scrollTop = listElement.scrollHeight;
      return;
    }
    listElement.scrollTo({ top: listElement.scrollHeight, behavior: 'smooth' });
  }

  // Track the previous newest-id so the unread-dispatch fires only on
  // an actual newest-message change (not on prop-init or list-length
  // tweaks like read-receipts). Persists across re-renders without a
  // $state tag because we only read it inside an $effect.
  let lastNotifiedMessageId = '';
  $effect(() => {
    newestMessageId;
    if (shouldFollowBottom) void scrollToBottom();
    // Dispatch an unread-tab notification when a brand-new message
    // arrives. TabTitleUnread (mounted in +layout) increments the tab
    // counter while the tab is hidden; if the user is looking at the
    // page right now this is a no-op there.
    if (
      typeof window !== 'undefined' &&
      newestMessageId !== '' &&
      newestMessageId !== lastNotifiedMessageId
    ) {
      if (lastNotifiedMessageId !== '') {
        window.dispatchEvent(new CustomEvent('ant:notify-unread'));
      }
      lastNotifiedMessageId = newestMessageId;
    }
  });
</script>

<div class="message-list-wrapper">
  <section
    bind:this={listElement}
    class="message-list"
    aria-label="Messages in this room"
    onscroll={handleScroll}
  >
    {#if hasOlderMessages}
      <button
        type="button"
        class="load-older"
        disabled={isLoadingOlder || isRequestingOlder}
        onclick={async () => {
          if (!listElement || !onLoadOlder) return;
          const previousScrollHeight = listElement.scrollHeight;
          isRequestingOlder = true;
          try {
            await onLoadOlder();
            await tick();
            if (listElement) {
              listElement.scrollTop = listElement.scrollHeight - previousScrollHeight + listElement.scrollTop;
            }
          } finally {
            isRequestingOlder = false;
          }
        }}
      >
        {#if isLoadingOlder || isRequestingOlder}
          <span class="load-older-spinner" aria-hidden="true"></span>
          <span>Loading history…</span>
        {:else}
          <span aria-hidden="true">↑</span>
          <span>Load earlier messages</span>
        {/if}
      </button>
    {/if}
    {#if messages.length === 0}
      <p class="empty-state">
        No messages yet. Say hello to get the room moving.
      </p>
    {:else}
      {#each grouped as message (message.id)}
        <MessageRow
          {message}
          parentMessage={message.parentMessageId ? messagesById.get(message.parentMessageId) : undefined}
          member={membersByHandle.get(message.authorHandle)}
          claims={claimsByMessageId.get(message.id) ?? []}
          {roomMode}
          {viewerIsAgent}
          onClaimChanged={refreshClaims}
          {asHandle}
          {readReceiptEvent}
          {onReplyRequested}
          childCount={replyCounts.get(message.id) ?? 0}
        />
      {/each}
    {/if}
  </section>

  {#if !shouldFollowBottom && messages.length > 0}
    <button
      type="button"
      class="jump-to-bottom"
      aria-label="Jump to latest message"
      title="Jump to latest"
      onclick={() => { shouldFollowBottom = true; void scrollToBottom(); }}
    >
      ↓ Latest
    </button>
  {/if}
</div>

<style>
  .message-list-wrapper {
    position: relative;
  }
  .message-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    /* #147: bottom-pad the scroll content so the last message rows
       clear the sticky composer + agent-status footer on small
       viewports instead of being overlaid. */
    padding: 1rem 1rem calc(7rem + env(safe-area-inset-bottom, 0));
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
    max-height: 60vh;
    overflow-y: auto;
    scroll-padding-bottom: 7rem;
    /* #129: vertical-only scroll on the list. Wide content (markdown
       tables, code blocks) handles its own horizontal scroll inside
       .chat-md-table-wrap / pre so the list itself never traps the
       mobile vertical swipe. */
    overflow-x: hidden;
    min-width: 0;
  }
  .message-list > :global(*) {
    /* Flex children of an overflow:hidden parent must allow shrinking
       below content size, otherwise a wide markdown table can still push
       the list wider than its border-radius container. */
    min-width: 0;
  }
  .empty-state {
    margin: 0;
    padding: 1rem;
    text-align: center;
    color: var(--ink-soft);
  }
  .load-older {
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 800;
    cursor: pointer;
  }
  .load-older-spinner {
    width: 0.85rem;
    height: 0.85rem;
    border: 2px solid var(--line-soft);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: load-older-spin 0.7s linear infinite;
  }
  @keyframes load-older-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .load-older-spinner { animation-duration: 2s; }
  }
  .load-older:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .load-older:disabled {
    opacity: 0.65;
    cursor: wait;
  }
  /* Task #101: jump-to-bottom — visible only when scrolled up. Sits
     above the composer dock so it doesn't get covered on mobile. */
  .jump-to-bottom {
    position: absolute;
    right: 0.85rem;
    bottom: 0.85rem;
    padding: 0.45rem 0.85rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 6px 16px rgba(20, 18, 14, 0.18);
  }
  .jump-to-bottom:hover {
    filter: brightness(1.05);
  }
</style>
