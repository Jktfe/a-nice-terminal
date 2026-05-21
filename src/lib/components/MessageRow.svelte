<!--
  MessageRow — renders one chat message and (for human/agent kinds) its
  reactions bar. Lifted out of MessageList so per-row concerns
  (reactions today, read-receipts next, threading later) compose here.

  Copied-from: src/lib/components/MessageList.svelte:31-58 (M30 + M12)
  Verdict: KEEP
  Simplification: per-message rendering extracted from the list wrapper
    so MessageList stays thin and each row owns its decorations.
-->
<script lang="ts">
  import type { ChatMessage } from '$lib/server/chatMessageStore';
  import type { RoomMember } from '$lib/server/chatRoomStore';
  import type { EntityClaim } from '$lib/server/entityClaimStore';
  import MessageReactionsBar from './MessageReactionsBar.svelte';
  import MessageReadIndicator from './MessageReadIndicator.svelte';
  import MemberIcon from './MemberIcon.svelte';
  import ClaimChip from './ClaimChip.svelte';
  import ClaimActionBar from './ClaimActionBar.svelte';
  import { renderMarkdown } from '$lib/chat/renderMarkdown';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Props = {
    message: ChatMessage;
    member?: RoomMember;
    // M30 slice 3b: optional reply callback. When supplied, the row
    // shows a Reply button for human/agent kinds; clicking emits the
    // message id up to the room page, which sets up reply state and
    // passes it down to ChatComposer. system + system-break stay
    // root-level by construction (slice 3b approved guardrail).
    onReplyRequested?: (messageId: string) => void;
    // M30 slice 3e: count of direct replies to this message in the
    // current list. Default 0 → no badge rendered. MessageList
    // computes via countDirectRepliesByParent and passes per-row.
    childCount?: number;
    // JWPK msg_wcq5fwlhg7: when this message has a parentMessageId AND
    // the parent is in the currently-loaded list, MessageList passes
    // the resolved parent here so the row can render a truncated
    // preview ("Reply to @parent: 'first 60 chars…'") instead of the
    // bare "↳ Reply" indicator. Undefined when parent is off-screen
    // (paged-out older messages) — row falls back to the bare indicator.
    parentMessage?: ChatMessage;
    /** M6 UI slice 1: active claims on this message from the
     *  entity_claims ledger. MessageList does one bulk GET + slices
     *  per-row. Empty array renders no chip. */
    claims?: EntityClaim[];
    /** Forwarded to ClaimChip so 🤝 working renders amber in brainstorm
     *  vs red in heads-down. */
    roomMode?: 'brainstorm' | 'heads-down' | 'closed';
    /** Bubbles up when ClaimActionBar mints/releases a claim so
     *  MessageList can re-hydrate its bulk cache. */
    onClaimChanged?: () => void;
    asHandle?: string;
    readReceiptEvent?: Record<string, unknown> | null;
  };

  let { message, member, onReplyRequested, childCount = 0, parentMessage, claims = [], roomMode = 'brainstorm', onClaimChanged, asHandle, readReceiptEvent }: Props = $props();

  // Viewer-is-agent gate for the ClaimActionBar (JWPK msg_np3zwn7w60).
  // The 🖐️/🤝/👐 pills are AGENT coordination signals — humans don't
  // claim via the web UI, so they only see the read-only ClaimChip
  // state. Match the ^@evolveant agent prefix the server uses to
  // reject agent handles from the user-facing Open Asks queue (commit
  // 24b9c43) so the cross-surface rule reads as one.
  const viewerIsAgent = $derived(
    typeof asHandle === 'string' && /^@evolveant/i.test(asHandle.trim())
  );
  let rowElement = $state<HTMLElement | null>(null);
  let deleteBusy = $state(false);
  let deleteError = $state('');
  // JWPK msg_8lvlf400gr (2026-05-19): replace the blocking native
  // confirm() with an in-page double-click pattern. First click arms the
  // button (shows "Confirm?"), second click within DELETE_ARM_WINDOW_MS
  // commits. Clicking elsewhere or letting the timer expire disarms.
  // Removes the dialog (which actively breaks browser-automation per
  // the chrome-devtools-mcp guideline + drops a modal in the user's
  // face for a routine action).
  const DELETE_ARM_WINDOW_MS = 4000;
  let deleteArmed = $state(false);
  let deleteArmedTimer: ReturnType<typeof setTimeout> | null = null;

  function disarmDelete(): void {
    deleteArmed = false;
    if (deleteArmedTimer) {
      clearTimeout(deleteArmedTimer);
      deleteArmedTimer = null;
    }
  }
  // JWPK msg_90prrrfb6x: removed the per-row showReactions hover state
  // + duplicate caller-reaction-badge. MessageReactionsBar is now a
  // self-contained always-rendered trigger + popover-picker that owns
  // its own visibility; clicking it opens the picker, clicking outside
  // closes it. Eliminates the bug where scroll-after-click trapped all
  // rows in showReactions=true via mouseenter-without-mouseleave.
  const displayName = $derived(member?.displayName ?? message.authorDisplayName);
  const displayColor = $derived(member?.displayColor ?? '#64748B');
  const displayIcon = $derived(member?.displayIcon ?? firstLetterOf(displayName));
  const displayBackgroundStyle = $derived(
    member?.displayBackgroundStyle ?? (message.kind === 'agent' ? 'transparent' : 'card')
  );
  // #74: caller can delete a message they authored, as long as it
  // hasn't been tombstoned and isn't a system event. The caller's
  // identity is passed in via `asHandle` from the room page.
  const isOwnMessage = $derived(
    typeof asHandle === 'string' && asHandle === message.authorHandle
  );
  const isDeleted = $derived(Boolean(message.deletedAtMs));
  const canDelete = $derived(
    isOwnMessage &&
      !isDeleted &&
      (message.kind === 'human' || message.kind === 'agent')
  );

  async function handleDeleteClick(event: MouseEvent): Promise<void> {
    if (!canDelete) return;
    if (!deleteArmed) {
      // First click — arm the confirm state. Stop propagation so the
      // outside-click handler below doesn't immediately disarm us on
      // the same event tick.
      event.stopPropagation();
      deleteArmed = true;
      deleteArmedTimer = setTimeout(disarmDelete, DELETE_ARM_WINDOW_MS);
      return;
    }
    // Second click — commit.
    event.stopPropagation();
    disarmDelete();
    deleteBusy = true;
    deleteError = '';
    try {
      const response = await fetch(
        `/api/chat-rooms/${encodeURIComponent(message.roomId)}/messages/${encodeURIComponent(message.id)}`,
        { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }
      );
      if (!response.ok) {
        throw new Error(`Delete failed (${response.status}).`);
      }
      // Optimistic flip — SSE message_updated will reconcile.
      message.deletedAtMs = Date.now();
      message.deletedByHandle = asHandle ?? null;
    } catch (cause) {
      deleteError = cause instanceof Error ? cause.message : 'Delete failed.';
      setTimeout(() => (deleteError = ''), 4000);
    } finally {
      deleteBusy = false;
    }
  }

  // Outside-click disarm — install only while armed so we don't leak
  // listeners on every message row in a busy thread.
  $effect(() => {
    if (!deleteArmed) return;
    const onDocClick = () => disarmDelete();
    // microtask delay so the arming click doesn't itself trigger disarm
    queueMicrotask(() => document.addEventListener('click', onDocClick, { once: true }));
    return () => {
      document.removeEventListener('click', onDocClick);
    };
  });

  function describeDeletedAt(ms: number | null | undefined): string {
    if (!ms) return '';
    try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  }

  function describeMomentFromIso(isoTimestamp: string): string {
    try {
      const whenItWasPosted = new Date(isoTimestamp);
      return whenItWasPosted.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function firstLetterOf(label: string): string {
    const trimmed = label.trim();
    const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    return (withoutAt.charAt(0) || trimmed.charAt(0) || '?').toUpperCase();
  }

  const renderedBody = $derived(renderMarkdown(message.body));
</script>

{#if message.kind === 'system-break'}
  <div class="break-row" role="separator" aria-label="Context break">
    <span class="break-text">{message.body}</span>
  </div>
{:else if message.kind === 'system'}
  <div class="system-row">
    <span class="system-text">{message.body}</span>
  </div>
{:else}
  <article
    bind:this={rowElement}
    class="message-row"
    class:is-agent={message.kind === 'agent'}
    class:is-reply={Boolean(message.parentMessageId)}
    data-background-style={displayBackgroundStyle}
    style:--speaker-color={displayColor}
  >
    <header>
      <span class="speaker-mark" aria-hidden="true">
        <MemberIcon icon={displayIcon} fallbackText={displayName} size="md" />
      </span>
      <span class="author-handle">{displayName}</span>
      {#if displayName !== message.authorHandle}
        <span class="canonical-handle">{message.authorHandle}</span>
      {/if}
      {#if message.kind === 'agent'}
        <span class="agent-badge">agent</span>
      {/if}
      <span class="posted-at">{describeMomentFromIso(message.postedAt)}</span>
      {#if childCount > 0}
        <span
          class="reply-count"
          aria-label={`${childCount} ${childCount === 1 ? 'reply' : 'replies'}`}
        >{childCount}↳</span>
      {/if}
      {#if onReplyRequested && (message.kind === 'human' || message.kind === 'agent') && !isDeleted}
        <button
          type="button"
          class="reply-button"
          onclick={() => onReplyRequested(message.id)}
        >Reply</button>
      {/if}
      {#if canDelete}
        <!-- JWPK msg_ou1qurnobt: option 3, word label — show "Delete"
             text on own messages so the affordance is unambiguous. The
             × on its own was too subtle in the muted-icon style and
             tested as a "is this broken?" moment. Armed state still
             pulses red with "Confirm?" copy. -->
        <button
          type="button"
          class="delete-button"
          class:armed={deleteArmed}
          aria-label={deleteArmed ? 'Confirm delete — click again within 4 seconds' : 'Delete this message'}
          title={deleteArmed ? 'Click again to confirm — or click elsewhere to cancel' : 'Delete this message'}
          disabled={deleteBusy}
          onclick={handleDeleteClick}
        >{deleteBusy ? 'Deleting…' : deleteArmed ? 'Confirm?' : 'Delete'}</button>
      {/if}
      {#if message.editedAtMs && !isDeleted}
        <span class="edited-badge" title={`Edited ${new Date(message.editedAtMs).toLocaleString()}`}>(edited)</span>
      {/if}
      <!-- JWPK msg_np3zwn7w60: look/work/pass pills are bench coordination
           state, "NOT for users and shouldn't be visible to them". Gated
           on viewerIsAgent so agents viewing the web UI still see the
           chip, but human users (@you, team members) don't. -->
      {#if viewerIsAgent}
        <ClaimChip {claims} {roomMode} />
      {/if}
    </header>
    {#if message.parentMessageId}
      <!-- JWPK msg_wcq5fwlhg7: when the parent is loaded, show WHO + a
           truncated preview ("Reply to @parent: 'first 60 chars…'") so
           reading agents + humans don't have to scroll back up to figure
           out what a reply is replying to. Falls back to the bare
           indicator when the parent is paged-out off-screen. Click
           jumps to the parent via anchor link. -->
      {#if parentMessage}
        {@const previewBody = (parentMessage.body ?? '').replace(/\s+/g, ' ').trim()}
        {@const previewTruncated = previewBody.length > 60 ? previewBody.slice(0, 60).trimEnd() + '…' : previewBody}
        {@const parentDeleted = Boolean(parentMessage.deletedAtMs)}
        <a
          class="reply-indicator reply-indicator-rich"
          href={`#${parentMessage.id}`}
          title={parentDeleted ? 'Original message was deleted' : `Reply to ${parentMessage.authorHandle}`}
        >
          <span class="reply-arrow" aria-hidden="true">↳</span>
          <span class="reply-prefix">Reply to</span>
          <span class="reply-parent-author">{parentMessage.authorDisplayName ?? parentMessage.authorHandle}</span>
          {#if parentDeleted}
            <span class="reply-parent-body reply-parent-deleted">(deleted)</span>
          {:else if previewTruncated.length > 0}
            <span class="reply-parent-body">{previewTruncated}</span>
          {/if}
        </a>
      {:else}
        <span class="reply-indicator" title="Replying to an older message not loaded yet">↳ Reply</span>
      {/if}
    {/if}
    {#if isDeleted}
      <div class="message-tombstone" role="note">
        <em>Message deleted{message.deletedByHandle ? ` by ${message.deletedByHandle}` : ''}{message.deletedAtMs ? ` at ${describeDeletedAt(message.deletedAtMs)}` : ''}.</em>
      </div>
    {:else}
      <div class="message-body">{@html renderedBody}</div>
    {/if}
    {#if deleteError}
      <p class="message-error" role="alert">{deleteError}</p>
    {/if}
    <!-- JWPK msg_90prrrfb6x redesign: MessageReactionsBar is now a
         self-contained trigger + popover-picker anchored bottom-right
         of the message-row (which is position:relative below). Always
         rendered when the row isn't a tombstone; the bar manages its
         own picker open/close state internally, so MessageRow no
         longer tracks any per-row reaction visibility. -->
    {#if !isDeleted}
      <!-- JWPK msg_np3zwn7w60 + ux msg_vqj1js81zt: the 🖐️/🤝/👐 action
           pills are AGENT-only coordination signals — humans don't claim
           via the web UI. Gate the ClaimActionBar on a viewer-is-agent
           check (same ^@evolveant prefix the server uses for asks-
           rejection so there's a single source of truth across surfaces).
           Humans see only the ClaimChip in the header. -->
      <div class="row-action-strip">
        {#if viewerIsAgent}
          <ClaimActionBar
            roomId={message.roomId}
            messageId={message.id}
            asHandle={asHandle ?? '@you'}
            {claims}
            {onClaimChanged}
          />
        {/if}
        <MessageReactionsBar
          roomId={message.roomId}
          messageId={message.id}
          {asHandle}
        />
      </div>
    {/if}
    <MessageReadIndicator roomId={message.roomId} messageId={message.id} {asHandle} {readReceiptEvent} />
  </article>
{/if}

<style>
  /* JWPK M6 UI slice 2: claim action bar + reactions bar share a row at
     the bottom-right of each message. Both surfaces are inline + small
     so they don't fight the message body for vertical space. */
  .row-action-strip {
    position: absolute;
    bottom: 0.3rem;
    right: 0.6rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    z-index: 2;
  }
  .message-row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.6rem 0.85rem;
    background: var(--surface-card);
    border-left: 4px solid var(--speaker-color);
    border-radius: 0.7rem;
  }
  /* JWPK msg_m01pn3d4g8 → msg_90prrrfb6x: the dedicated caller-reaction
     badge was retired when MessageReactionsBar absorbed the trigger
     affordance + the popover-picker. The reactions bar now anchors
     itself in the bottom-right of the row (position:absolute via its
     own .reaction-host class) and toggles its own visibility, so the
     badge slot is no longer needed here. The reactions-bar's trigger
     button IS the badge — same visual position, click opens the picker. */
  .message-row[data-background-style='transparent'] {
    background: var(--bg);
  }
  .message-row[data-background-style='tint'] {
    background: color-mix(in srgb, var(--speaker-color) 9%, var(--surface-card));
  }
  /* M30 slice 3c: pure-CSS indent for reply rows. The article only
     renders in the human/agent branch above, so system/system-break
     rows never acquire is-reply by construction. */
  .message-row.is-reply {
    margin-left: 1.5rem;
    border-left: 2px solid var(--surface-edge);
    padding-left: 1rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
  }
  .speaker-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.45rem;
    height: 1.45rem;
    border-radius: 0.45rem;
    background: var(--speaker-color);
    color: white;
    font-size: 0.82rem;
    font-weight: 900;
    line-height: 1;
    flex: 0 0 auto;
  }
  .author-handle {
    font-weight: 800;
    color: var(--ink-strong);
  }
  .canonical-handle {
    color: var(--ink-soft);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.72rem;
  }
  .agent-badge {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    font-weight: 800;
  }
  .posted-at {
    margin-left: auto;
    color: var(--ink-soft);
  }
  .reply-indicator {
    font-size: 0.72rem;
    color: var(--ink-soft);
    font-style: italic;
  }
  /* JWPK msg_wcq5fwlhg7: rich reply indicator carries author + truncated
     parent body so agents reading the chat see WHAT a reply is responding
     to without scrolling back up. Clickable anchor links to the parent
     row's id so a click scrolls into view. */
  .reply-indicator-rich {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    margin: 0.2rem 0 0.4rem;
    padding: 0.25rem 0.6rem;
    border-left: 2px solid color-mix(in srgb, var(--accent) 40%, transparent);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    border-radius: 0 0.4rem 0.4rem 0;
    text-decoration: none;
    color: var(--ink-soft);
    font-style: normal;
    line-height: 1.4;
    max-width: 56ch;
  }
  .reply-indicator-rich:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-left-color: var(--accent);
  }
  .reply-arrow {
    color: var(--accent);
    font-weight: 700;
    flex-shrink: 0;
  }
  .reply-prefix {
    color: var(--ink-soft);
    flex-shrink: 0;
  }
  .reply-parent-author {
    color: var(--ink-strong);
    font-weight: 700;
    flex-shrink: 0;
  }
  .reply-parent-body {
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .reply-parent-deleted {
    font-style: italic;
    opacity: 0.7;
  }
  .reply-button {
    padding: 0.1rem 0.55rem;
    margin-left: 0.35rem;
    background: transparent;
    color: var(--accent);
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
  }
  .reply-button:hover { background: var(--surface); }
  /* #74 delete affordance — only visible on rows the caller authored.
     Sits next to the reply button with a dim default state so it
     doesn't visually compete with content, brightens on hover. */
  .delete-button {
    padding: 0.15rem 0.55rem;
    margin-left: 0.35rem;
    line-height: 1.3;
    background: transparent;
    color: var(--warn, #b45309);
    border: 1px solid color-mix(in srgb, var(--warn, #b45309) 35%, transparent);
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .delete-button:hover:not(:disabled) {
    color: var(--danger, #b91c1c);
    border-color: var(--danger, #b91c1c);
    background: color-mix(in srgb, var(--danger, #b91c1c) 6%, transparent);
  }
  /* Second-confirm armed state — morphs from "×" pill to "Confirm?" pill.
     Distinct danger styling so the destructive action reads as such; the
     4s auto-disarm + outside-click handler give an obvious cancel path. */
  .delete-button.armed {
    padding: 0.15rem 0.7rem;
    background: var(--danger, #b91c1c);
    color: white;
    border-color: var(--danger, #b91c1c);
    font-size: 0.72rem;
    animation: delete-armed-pulse 1.2s ease-in-out infinite;
  }
  .delete-button.armed:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger, #b91c1c) 85%, black);
    color: white;
  }
  @keyframes delete-armed-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger, #b91c1c) 50%, transparent); }
    50%      { box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger, #b91c1c) 0%,  transparent); }
  }
  .delete-button:disabled { opacity: 0.45; cursor: wait; }
  @media (pointer: coarse) {
    .delete-button { padding: 0.3rem 0.85rem; font-size: 0.82rem; }
    .delete-button.armed { padding: 0.3rem 0.9rem; font-size: 0.82rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .delete-button.armed { animation: none; }
  }
  /* #74 tombstone replaces the body when deletedAtMs is set. */
  .message-tombstone {
    padding: 0.35rem 0.6rem;
    color: var(--ink-soft);
    font-size: 0.85rem;
    border-left: 2px dashed var(--surface-edge);
    margin: 0.35rem 0;
  }
  /* #76 edited badge — subtle italic indicator next to the timestamp. */
  .edited-badge {
    margin-left: 0.35rem;
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-style: italic;
  }
  .message-error {
    margin: 0.35rem 0 0;
    padding: 0.35rem 0.65rem;
    border: 1px solid var(--warn);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--warn) 14%, var(--surface-card));
    color: var(--ink-strong);
    font-size: 0.8rem;
  }
  .reply-count {
    font-size: 0.7rem;
    color: var(--ink-soft);
    background: var(--surface);
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    font-weight: 700;
  }
  .message-body {
    margin: 0;
    color: var(--ink-strong);
    line-height: 1.45;
  }
  .message-body :global(.chat-md-table-wrap) {
    max-width: 100%;
    overflow-x: auto;
    margin: 0.65rem 0;
    border: 0.5px solid var(--surface-edge);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface-card) 82%, transparent);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
  }
  .message-body :global(.chat-md-table-wrap:focus-visible) {
    outline: 2px solid color-mix(in srgb, var(--ink-strong) 38%, transparent);
    outline-offset: 2px;
  }
  .message-body :global(.chat-md-table-wrap table) {
    width: max-content;
    min-width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.86rem;
    line-height: 1.35;
  }
  .message-body :global(.chat-md-table-wrap th),
  .message-body :global(.chat-md-table-wrap td) {
    min-width: 7rem;
    max-width: 18rem;
    padding: 0.45rem 0.6rem;
    border-right: 0.5px solid var(--surface-edge);
    border-bottom: 0.5px solid var(--surface-edge);
    color: var(--ink-strong);
    vertical-align: top;
    white-space: normal;
  }
  .message-body :global(.chat-md-table-wrap th) {
    position: sticky;
    top: 0;
    z-index: 1;
    background: color-mix(in srgb, var(--surface-card) 88%, var(--ink-strong) 12%);
    color: var(--ink-strong);
    font-weight: 700;
  }
  .message-body :global(.chat-md-table-wrap tr:last-child td) {
    border-bottom: 0;
  }
  .message-body :global(.chat-md-table-wrap th:last-child),
  .message-body :global(.chat-md-table-wrap td:last-child) {
    border-right: 0;
  }
  .message-body :global(.chat-md-table-wrap tbody tr:nth-child(even) td) {
    background: color-mix(in srgb, var(--surface-raised) 42%, transparent);
  }
  @media (max-width: 640px) {
    .message-body :global(.chat-md-table-wrap) {
      margin-right: -0.25rem;
    }
    .message-body :global(.chat-md-table-wrap th),
    .message-body :global(.chat-md-table-wrap td) {
      min-width: 8.5rem;
      padding: 0.5rem 0.6rem;
      font-size: 0.82rem;
    }
  }
  .message-body :global(code) {
    background: var(--surface);
    padding: 0.1rem 0.3rem;
    border-radius: 0.25rem;
    font-size: 0.85em;
  }
  .message-body :global(pre) {
    background: var(--surface);
    padding: 0.6rem;
    border-radius: 0.4rem;
    overflow-x: auto;
    font-size: 0.82rem;
  }
  .message-body :global(pre code) {
    background: none;
    padding: 0;
  }
  /* .reactions-slot + hover-reveal removed per JWPK msg_90prrrfb6x.
     MessageReactionsBar now owns its own visibility (single always-
     visible trigger + popover picker on click), so the wrapping slot
     + the @media (pointer: coarse) override are no longer needed. */
  .system-row {
    display: flex;
    justify-content: center;
    padding: 0.35rem 0;
  }
  .system-text {
    font-size: 0.78rem;
    color: var(--ink-soft);
    font-style: italic;
  }
  .break-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.4rem 0;
    padding: 0.55rem 0.85rem;
    background: var(--accent);
    color: white;
    border-radius: 0.6rem;
    font-weight: 700;
    font-size: 0.85rem;
  }
  .break-text {
    flex: 1;
    text-align: center;
  }
</style>
