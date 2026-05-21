<!--
  InterviewModalHeader — chrome row for the InterviewModal.
  Extracted 2026-05-21 to keep InterviewModal under the 600-line cap.
  Pure presentation: parent owns all interview state and passes callbacks
  for the narration controls + end / close actions. Same DOM + classes as
  the inlined version so existing CSS selectors / tests still match.
-->
<script lang="ts">
  import NocturneIcon from './NocturneIcon.svelte';

  type Props = {
    targetLabel: string;
    parentMessageContent: string;
    activeMsgId: string | null;
    activePaused: boolean;
    busy: boolean;
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
    onEndInterview: () => void | Promise<void>;
    onClose: () => void;
  };

  let {
    targetLabel,
    parentMessageContent,
    activeMsgId,
    activePaused,
    busy,
    onPause,
    onResume,
    onStop,
    onEndInterview,
    onClose,
  }: Props = $props();
</script>

<header class="iv-head">
  <div class="iv-head-title">
    <span class="iv-head-eyebrow">Interview</span>
    <h2>{targetLabel}</h2>
    <span class="iv-head-source" title={parentMessageContent}>
      from "{(parentMessageContent ?? '').slice(0, 80)}{(parentMessageContent ?? '').length > 80 ? '…' : ''}"
    </span>
  </div>
  {#if activeMsgId}
    <!-- Narration controls — surface when an utterance is in
         flight so the user can pause / resume / stop the read-aloud
         without scrolling to the per-message replay button. -->
    {#if activePaused}
      <button
        type="button"
        class="iv-narration"
        onclick={onResume}
        title="Resume narration"
        aria-label="Resume narration"
      >
        <NocturneIcon name="play" size={11} color="currentColor" />
        <span>resume</span>
      </button>
    {:else}
      <button
        type="button"
        class="iv-narration"
        onclick={onPause}
        title="Pause narration"
        aria-label="Pause narration"
      >
        <span class="iv-pause-glyph" aria-hidden="true">⏸</span>
        <span>pause</span>
      </button>
    {/if}
    <button
      type="button"
      class="iv-narration"
      onclick={onStop}
      title="Stop narration"
      aria-label="Stop narration"
    >
      <span class="iv-stop-glyph" aria-hidden="true">⏹</span>
      <span>stop</span>
    </button>
  {/if}
  <button
    type="button"
    class="iv-end"
    onclick={() => onEndInterview()}
    disabled={busy}
    title="End interview, save transcript, post summary"
  >{busy ? 'Ending…' : 'End interview'}</button>
  <!-- Force-close defence (JWPK msg_pooxj42nl0 (f)): if the server-side
       end-PATCH silently fails the operator must still be able to
       dismiss the modal locally. Force-close calls onClose only —
       interview stays open on the server (can be cleaned up via
       coordinator force-release). The end-PATCH path is the right
       one when it works; this is the always-works escape hatch. -->
  <button
    type="button"
    class="iv-force-close"
    onclick={onClose}
    title="Close this window. The interview stays open on the server until End interview succeeds."
  >Force close</button>
  <button
    type="button"
    class="iv-close"
    onclick={onClose}
    aria-label="Close (interview stays open in the background)"
  >
    <NocturneIcon name="x" size={14} color="var(--text-muted)" />
  </button>
</header>

<style>
  .iv-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--hairline, rgba(0, 0, 0, 0.08));
  }
  .iv-head-title { flex: 1; min-width: 0; }
  .iv-head-eyebrow {
    display: block;
    font-size: 10.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted, #6b7280);
  }
  .iv-head-title h2 {
    margin: 2px 0 0;
    font-size: 16px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .iv-head-source {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    color: var(--text-muted, #6b7280);
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .iv-end {
    border: 0.5px solid currentColor;
    background: transparent;
    color: var(--accent-amber, #c2860a);
    font: inherit;
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .iv-narration {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0.5px solid currentColor;
    background: transparent;
    color: var(--text-muted, #6b7280);
    font: inherit;
    font-size: 11.5px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .iv-narration:hover {
    color: var(--text, #111);
  }
  .iv-pause-glyph,
  .iv-stop-glyph {
    font-size: 11px;
    line-height: 1;
  }
  .iv-end:hover:not(:disabled) {
    background: rgba(194, 134, 10, 0.08);
  }
  .iv-end:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .iv-close {
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }
  .iv-close:hover { background: var(--hairline, rgba(0, 0, 0, 0.06)); }
  .iv-force-close {
    padding: 4px 10px;
    border: 1px solid var(--hairline-strong, rgba(0, 0, 0, 0.18));
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted, #6b6759);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    margin-left: 6px;
  }
  .iv-force-close:hover {
    border-color: var(--accent, #c63b3b);
    color: var(--accent, #c63b3b);
  }
</style>
