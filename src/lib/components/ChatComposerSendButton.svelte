<!--
  ChatComposerSendButton — the primary send/save/post-break submit button
  inside the composer footer. Label switches between "Send", "Sending…",
  "Saving…", "Save edit", and "Post break" based on the composer state
  + edit / break-command context.

  PURE RENDER. type="submit" so it triggers the parent form's onsubmit
  handler — no callback prop needed. Parent (ChatComposer) owns the
  state machine + the form submission.

  Extracted from ChatComposer.svelte to keep the parent under the
  600-line cap (scripts/check-component-lines.mjs). Markup + CSS lifted
  verbatim to preserve DOM/class names; no behaviour change.
-->
<script lang="ts">
  import { looksLikeBreakCommand } from '$lib/composer/composerSlashCommands';

  type ComposerState =
    | 'emptyComposerWaitingForBody'
    | 'bodyBeingTyped'
    | 'submittingToServer';

  type Props = {
    composerState: ComposerState;
    editingMessageId: string | null;
    bodyBeingTyped: string;
  };

  let { composerState, editingMessageId, bodyBeingTyped }: Props = $props();
</script>

<button type="submit" class="primary" disabled={composerState !== 'bodyBeingTyped'}>
  {#if composerState === 'submittingToServer'}
    {editingMessageId ? 'Saving…' : 'Sending…'}
  {:else if editingMessageId}
    Save edit
  {:else if looksLikeBreakCommand(bodyBeingTyped)}
    Post break
  {:else}
    Send
  {/if}
</button>

<style>
  button.primary { padding: 0.5rem 1rem; font-weight: 800; font-size: 0.9rem; color: white; background: var(--accent); border: none; border-radius: 999px; cursor: pointer; }
  button.primary:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
