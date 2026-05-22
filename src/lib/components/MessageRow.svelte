<!--
  MessageRow — renders one chat message and (for human/agent kinds) its
  reactions bar. Lifted out of MessageList so per-row concerns
  (reactions today, read-receipts next, threading later) compose here.

  Copied-from: src/lib/components/MessageList.svelte:31-58 (M30 + M12)
  Verdict: KEEP
  Simplification: per-message rendering extracted from the list wrapper
    so MessageList stays thin and each row owns its decorations.

  2026-05-21 split: header / reply-indicator / action-strip carved into
  sibling MessageRow* components to clear the 600-line component cap.
  Zero behaviour change — same props, same DOM order, same classes.
-->
<script lang="ts">
  import type { ChatMessage } from '$lib/server/chatMessageStore';
  import type { RoomMember } from '$lib/server/chatRoomStore';
  import type { EntityClaim } from '$lib/server/entityClaimStore';
  import MessageReadIndicator from './MessageReadIndicator.svelte';
  import MessageRowHeader from './MessageRowHeader.svelte';
  import MessageRowReply from './MessageRowReply.svelte';
  import MessageRowActions from './MessageRowActions.svelte';
  import { renderMarkdown } from '$lib/chat/renderMarkdown';

  type Props = {
    message: ChatMessage;
    member?: RoomMember;
    members?: RoomMember[];
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
    /** True when the current viewer is an agent member of this room.
     *  MessageList derives this from the live room roster, not from
     *  brittle handle prefixes. */
    viewerIsAgent?: boolean;
    asHandle?: string;
    readReceiptEvent?: Record<string, unknown> | null;
  };

  let { message, member, members = [], onReplyRequested, childCount = 0, parentMessage, claims = [], roomMode = 'brainstorm', onClaimChanged, viewerIsAgent = false, asHandle, readReceiptEvent }: Props = $props();
  // deleteError is owned by MessageRowHeader but bound back here so the
  // <p class="message-error"> renders in its original spot below the
  // message body (visual contract preserved across the split).
  let deleteError = $state('');
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
  const isAnsweredAskReceipt = $derived(
    message.kind === 'system' && message.body.startsWith('Open ask answered by ')
  );

  function describeDeletedAt(ms: number | null | undefined): string {
    if (!ms) return '';
    try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
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
  <div class="system-row" class:has-read-receipts={isAnsweredAskReceipt}>
    <span class="system-text">{message.body}</span>
    {#if isAnsweredAskReceipt}
      <MessageReadIndicator roomId={message.roomId} messageId={message.id} {asHandle} {readReceiptEvent} />
    {/if}
  </div>
{:else}
  <article
    class="message-row"
    class:is-agent={message.kind === 'agent'}
    class:is-reply={Boolean(message.parentMessageId)}
    data-background-style={displayBackgroundStyle}
    style:--speaker-color={displayColor}
  >
    <MessageRowHeader
      {message}
      {displayName}
      {displayIcon}
      {childCount}
      {canDelete}
      {isDeleted}
      {viewerIsAgent}
      {claims}
      {members}
      {roomMode}
      {onReplyRequested}
      {asHandle}
      bind:deleteError
    />
    {#if message.parentMessageId}
      <MessageRowReply {parentMessage} />
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
      <MessageRowActions
        roomId={message.roomId}
        messageId={message.id}
        {viewerIsAgent}
        {claims}
        {asHandle}
        {onClaimChanged}
      />
    {/if}
    <MessageReadIndicator roomId={message.roomId} messageId={message.id} {asHandle} {readReceiptEvent} />
  </article>
{/if}

<style>
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
  /* #74 tombstone replaces the body when deletedAtMs is set. */
  .message-tombstone {
    padding: 0.35rem 0.6rem;
    color: var(--ink-soft);
    font-size: 0.85rem;
    border-left: 2px dashed var(--surface-edge);
    margin: 0.35rem 0;
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
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0.35rem 0;
  }
  .system-row.has-read-receipts {
    gap: 0.15rem;
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
