<!--
  MessageRowHeader — header strip of a chat message row (avatar, handle,
  timestamp, reply count, reply / delete buttons, edited badge, agent-
  only ClaimChip). Extracted from MessageRow.svelte 2026-05-21 to keep
  the parent under the 600-line component cap; behaviour preserved
  verbatim — same classes, same DOM, same delete double-click pattern.

  Delete state lives here; deleteError is bound back to the parent so
  it can render the error <p> in its original spot below the body.
-->
<script lang="ts">
  import type { ChatMessage } from '$lib/server/chatMessageStore';
  import type { EntityClaim } from '$lib/server/entityClaimStore';
  import MemberIcon from './MemberIcon.svelte';
  import ClaimChip from './ClaimChip.svelte';

  type Props = {
    message: ChatMessage;
    displayName: string;
    displayIcon: string;
    childCount: number;
    canDelete: boolean;
    isDeleted: boolean;
    viewerIsAgent: boolean;
    claims: EntityClaim[];
    roomMode: 'brainstorm' | 'heads-down' | 'closed';
    onReplyRequested?: (messageId: string) => void;
    asHandle?: string;
    /** Bound back to the parent so the error <p> renders in its
     *  original location below the message body. */
    deleteError?: string;
  };

  let {
    message,
    displayName,
    displayIcon,
    childCount,
    canDelete,
    isDeleted,
    viewerIsAgent,
    claims,
    roomMode,
    onReplyRequested,
    asHandle,
    deleteError = $bindable('')
  }: Props = $props();

  let deleteBusy = $state(false);
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

  function describeMomentFromIso(isoTimestamp: string): string {
    try {
      const whenItWasPosted = new Date(isoTimestamp);
      return whenItWasPosted.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }
</script>

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

<style>
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
  .reply-count {
    font-size: 0.7rem;
    color: var(--ink-soft);
    background: var(--surface);
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    font-weight: 700;
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
  /* #76 edited badge — subtle italic indicator next to the timestamp. */
  .edited-badge {
    margin-left: 0.35rem;
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-style: italic;
  }
</style>
