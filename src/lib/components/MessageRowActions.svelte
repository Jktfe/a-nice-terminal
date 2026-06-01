<!--
  MessageRowActions — bottom-right action strip on a chat message row.
  Composes the agent-only ClaimActionBar (look/work/pass pills) and the
  always-rendered MessageReactionsBar. Extracted from MessageRow.svelte
  2026-05-21 to keep the parent under the 600-line component cap;
  behaviour preserved verbatim — same wrapper class, same positioning,
  same gating.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import type { EntityClaim } from '$lib/server/entityClaimStore';
  import MessageReactionsBar from './MessageReactionsBar.svelte';
  import ClaimActionBar from './ClaimActionBar.svelte';

  type Props = {
    roomId: string;
    messageId: string;
    /**
     * Raw message body (markdown source). Copied verbatim by the Copy
     * button so the operator gets the original text rather than the
     * rendered HTML. JWPK msg_pge4o6wurl 2026-05-27 antV4.
     */
    body: string;
    viewerIsAgent: boolean;
    claims: EntityClaim[];
    asHandle?: string;
    onClaimChanged?: () => void;
  };

  let {
    roomId,
    messageId,
    body,
    viewerIsAgent,
    claims,
    asHandle,
    onClaimChanged
  }: Props = $props();

  // Copy-button state — "copied" flashes for 1.6s after a successful
  // clipboard write, then resets. Async failures fall back silently
  // (rare on modern browsers; the operator can still select + ⌘C).
  let copyState = $state<'idle' | 'copied' | 'error'>('idle');
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyBody() {
    if (!browser) return;
    if (typeof navigator?.clipboard?.writeText !== 'function') {
      copyState = 'error';
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      copyState = 'copied';
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { copyState = 'idle'; }, 1600);
    } catch {
      copyState = 'error';
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { copyState = 'idle'; }, 1600);
    }
  }
</script>

<!-- JWPK msg_np3zwn7w60 + ux msg_vqj1js81zt: the 🖐️/🤝/👐 action
     pills are AGENT-only coordination signals — humans don't claim
     via the web UI. Gate the ClaimActionBar on a viewer-is-agent
     check derived from the room roster in MessageList, so aliases and
     new agent handle families do not need component changes.
     Humans see only the ClaimChip in the header. -->
<div class="row-action-strip">
  {#if viewerIsAgent}
    <ClaimActionBar
      {roomId}
      {messageId}
      asHandle={asHandle ?? '@you'}
      {claims}
      {onClaimChanged}
    />
  {/if}
  <button
    type="button"
    class="copy-btn"
    class:copied={copyState === 'copied'}
    class:errored={copyState === 'error'}
    aria-label={copyState === 'copied' ? 'Message body copied' : 'Copy message body'}
    title={copyState === 'error' ? 'Clipboard unavailable — select text manually' : 'Copy'}
    onclick={() => void copyBody()}
  >
    {#if copyState === 'copied'}
      ✓ Copied
    {:else if copyState === 'error'}
      ⚠
    {:else}
      ⧉
    {/if}
  </button>
  <MessageReactionsBar
    {roomId}
    {messageId}
    {asHandle}
  />
</div>

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
  /* Copy button — small + quiet by default; lights up when copied.
     JWPK msg_pge4o6wurl 2026-05-27. Sits between the claim bar and
     reactions bar so it reads as message-level, not claim/reaction-
     specific. */
  .copy-btn {
    padding: 0.12rem 0.45rem;
    font-size: 0.74rem;
    line-height: 1.3;
    font-weight: 700;
    border-radius: 0.32rem;
    border: 1px solid var(--line-soft, #d1d5db);
    background: var(--surface-card, transparent);
    color: var(--ink-soft, #6b7280);
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .copy-btn:hover:not(.copied):not(.errored) {
    color: var(--accent, #4a6cf7);
    border-color: var(--accent, #4a6cf7);
  }
  .copy-btn.copied {
    color: white;
    background: var(--ok, #2c8a4d);
    border-color: var(--ok, #2c8a4d);
  }
  .copy-btn.errored {
    color: var(--warn, #c92020);
    border-color: var(--warn, #c92020);
  }
</style>
