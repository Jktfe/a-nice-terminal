<!--
  MessageReactionsBar — JWPK-canonical 5-emoji reactions for one chat
  message, refactored to a single-trigger + popover-picker per JWPK
  msg_90prrrfb6x ("show it independently as then it stops managing
  different states and the reactions can go bottom right").

  Visual: ONE always-rendered trigger button in the message action strip.
  The trigger shows the caller's current reaction emoji
  (or a '+' placeholder if they haven't reacted). Clicking the trigger
  opens a small popover with the 5 canonical emojis + their reactor
  counts. Clicking any emoji in the popover toggles the caller's
  reaction and closes the picker; clicking outside the picker closes it.

  Eliminates the per-row hover-reveal state (showReactions in MessageRow)
  that mis-triggered when scroll/reflow moved the cursor over multiple
  rows after a click. Bar visibility is now per-row local state inside
  THIS component, not a class on a wrapping div in MessageRow.

  Click semantics: clicking an emoji you've already reacted with removes
  it; clicking one you haven't adds it. Server allowlist is enforced.
  Identity defaults to @JWPK to match ChatComposer.

  Decorative surface — fetch failures soft-fail.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { MessageReaction } from '$lib/server/messageReactionStore';
  import {
    ALLOWED_REACTION_EMOJI,
    REACTION_EMOJI_LABELS
  } from '$lib/reactions/canonicalEmoji';

  type Props = {
    roomId: string;
    messageId: string;
    asHandle?: string;
  };

  let { roomId, messageId, asHandle = '@JWPK' }: Props = $props();

  // EMOJI-TRIM canonical spectrum: Bad / OK / Good / Celebrate / Question.
  const FIXED_EMOJI_SET = ALLOWED_REACTION_EMOJI;

  let reactionsOnThisMessage = $state<MessageReaction[]>([]);
  let pickerOpen = $state(false);
  let containerElement = $state<HTMLDivElement | null>(null);

  async function fetchReactions() {
    try {
      const response = await fetch(
        `/api/chat-rooms/${roomId}/messages/${messageId}/reactions`
      );
      if (!response.ok) return;
      const body = (await response.json()) as { reactions?: MessageReaction[] };
      reactionsOnThisMessage = body.reactions ?? [];
    } catch {
      // Soft-fail: decorative.
    }
  }

  // Mount-time fetch only (no polling — that approach crashed Chrome
  // when fanned out to N messages × 5s tick). Toggling a reaction
  // re-fetches inline.
  $effect(() => {
    void fetchReactions();
  });

  function reactorsForEmoji(emoji: string): string[] {
    return reactionsOnThisMessage
      .filter((entry) => entry.emoji === emoji)
      .map((entry) => entry.reactorHandle);
  }

  function userHasReactedWith(emoji: string): boolean {
    return reactorsForEmoji(emoji).includes(asHandle);
  }

  // Caller's currently-chosen emoji, surfaced on the trigger button so
  // the bottom-right corner of every message shows what THIS user
  // already picked at a glance. Returns null when they haven't reacted.
  const callerCurrentEmoji = $derived.by(() => {
    if (!asHandle) return null;
    const own = reactionsOnThisMessage.find((r) => r.reactorHandle === asHandle);
    return own ? own.emoji : null;
  });

  async function toggleReaction(emoji: string) {
    const method = userHasReactedWith(emoji) ? 'DELETE' : 'POST';
    try {
      await fetch(`/api/chat-rooms/${roomId}/messages/${messageId}/reactions`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reactorHandle: asHandle, emoji })
      });
      await fetchReactions();
    } catch {
      // Soft-fail: leave the chip count as-is until the next poll.
    }
    pickerOpen = false;
  }

  // Click-outside guard so the picker closes when the user clicks
  // anywhere that isn't inside this component. Without this the picker
  // stays open until the user clicks an emoji or the trigger.
  function handleDocumentClick(event: MouseEvent) {
    if (!pickerOpen) return;
    if (!containerElement) return;
    if (event.target instanceof Node && containerElement.contains(event.target)) return;
    pickerOpen = false;
  }
  function handleKey(event: KeyboardEvent) {
    if (pickerOpen && event.key === 'Escape') {
      pickerOpen = false;
    }
  }
  $effect(() => {
    if (typeof document === 'undefined') return;
    if (pickerOpen) {
      document.addEventListener('click', handleDocumentClick, true);
      document.addEventListener('keydown', handleKey);
      return () => {
        document.removeEventListener('click', handleDocumentClick, true);
        document.removeEventListener('keydown', handleKey);
      };
    }
  });
  onDestroy(() => {
    if (typeof document === 'undefined') return;
    document.removeEventListener('click', handleDocumentClick, true);
    document.removeEventListener('keydown', handleKey);
  });
</script>

<div
  bind:this={containerElement}
  class="reaction-host"
  role="group"
  aria-label="Reactions"
>
  <button
    type="button"
    class="reaction-trigger"
    class:has-reaction={callerCurrentEmoji !== null}
    aria-haspopup="menu"
    aria-expanded={pickerOpen}
    aria-label={callerCurrentEmoji
      ? `Your reaction: ${callerCurrentEmoji}. Click to change.`
      : 'Add a reaction'}
    title={callerCurrentEmoji ? 'Change your reaction' : 'Add a reaction'}
    onclick={(event) => {
      event.stopPropagation();
      pickerOpen = !pickerOpen;
    }}
  >
    {#if callerCurrentEmoji}
      <span class="trigger-glyph" aria-hidden="true">{callerCurrentEmoji}</span>
    {:else}
      <span class="trigger-glyph trigger-placeholder" aria-hidden="true">+</span>
    {/if}
  </button>

  {#if pickerOpen}
    <div class="reaction-picker" role="menu" aria-label="Pick a reaction">
      {#each FIXED_EMOJI_SET as emoji (emoji)}
        {@const reactors = reactorsForEmoji(emoji)}
        {@const youReacted = userHasReactedWith(emoji)}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={youReacted}
          class="picker-option"
          class:active={youReacted}
          aria-label={`${REACTION_EMOJI_LABELS[emoji]} reaction (${reactors.length} so far)`}
          title={REACTION_EMOJI_LABELS[emoji]}
          onclick={(event) => {
            event.stopPropagation();
            void toggleReaction(emoji);
          }}
        >
          <span class="picker-emoji" aria-hidden="true">{emoji}</span>
          {#if reactors.length > 0}
            <span class="picker-count">{reactors.length}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .reaction-host {
    position: relative;
    display: inline-flex;
    /* MessageRowActions owns bottom-right row placement. Keeping this
       component in flow prevents it from covering neighbouring actions. */
  }
  .reaction-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.6rem;
    height: 1.6rem;
    padding: 0 0.35rem;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 1px 3px rgb(20 18 14 / 8%);
    transition: border-color 0.12s ease, transform 0.12s ease;
  }
  .reaction-trigger:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .reaction-trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .reaction-trigger.has-reaction {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-card));
  }
  .trigger-placeholder {
    color: var(--ink-soft);
    font-weight: 800;
    font-size: 1rem;
  }
  .reaction-picker {
    position: absolute;
    right: 0;
    bottom: calc(100% + 0.35rem);
    display: flex;
    gap: 0.25rem;
    padding: 0.3rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    box-shadow: 0 8px 18px rgb(20 18 14 / 14%);
    z-index: 20;
    white-space: nowrap;
  }
  .picker-option {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.2rem 0.45rem;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.92rem;
    cursor: pointer;
  }
  .picker-option:hover {
    border-color: var(--accent);
  }
  .picker-option.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  .picker-option:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .picker-count {
    font-size: 0.74rem;
    font-weight: 700;
  }
</style>
