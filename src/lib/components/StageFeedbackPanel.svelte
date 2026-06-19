<script lang="ts" module>
  export type StagePauseSnapshot = {
    slideIndex: number;
    slideTitle: string;
    narrationText: string;
    elapsedMs: number;
    estimatedCharOffset: number;
    lastSpokenWindow: string;
  };

  export type StageFeedbackNotice = {
    kind: 'ok' | 'err';
    text: string;
    ref?: string;
  };
</script>

<script lang="ts">
  import { safeUrlForTrackerLink } from '$lib/chat/trackerRefs';

  let {
    pauseSnapshot,
    feedbackText = $bindable(''),
    pasteContext = $bindable(''),
    feedbackSubmitting,
    feedbackNotice,
    onSubmit,
    onClear
  }: {
    pauseSnapshot: StagePauseSnapshot | null;
    feedbackText: string;
    pasteContext: string;
    feedbackSubmitting: boolean;
    feedbackNotice: StageFeedbackNotice | null;
    onSubmit: () => void;
    onClear: () => void;
  } = $props();

  const canSubmit = $derived(feedbackText.trim().length > 0 && !feedbackSubmitting);
</script>

<section class="feedback-panel" aria-label="Stage comments and feedback">
  <header>
    <p class="panel-kicker">Comments</p>
    <h3>Feedback Panel</h3>
    <p class="panel-hint">
      Add an overall comment or a slide-specific correction. Pausing narration
      adds a spoken anchor, but comments can be sent without one.
    </p>
  </header>
  <div class="comment-scopes" aria-label="Supported comment scopes">
    <span>Overall comment</span>
    <span>Slide comment</span>
  </div>

  {#if feedbackNotice}
    <p class={feedbackNotice.kind === 'ok' ? 'feedback-ok' : 'feedback-err'} role="status">
      {feedbackNotice.text}
      {#if feedbackNotice.ref}
        {@const safeRef = safeUrlForTrackerLink(feedbackNotice.ref)}
        {#if safeRef}
          <a href={safeRef}>Open proposal</a>
        {:else}
          <code title="Not a safe URL">{feedbackNotice.ref}</code>
        {/if}
      {/if}
    </p>
  {/if}

  {#if pauseSnapshot}
    <div class="pause-context" aria-label="Captured pause context">
      <div class="ctx-row">
        <span class="ctx-label">Slide</span>
        <code>{pauseSnapshot.slideIndex + 1} · {pauseSnapshot.slideTitle}</code>
      </div>
      <div class="ctx-row">
        <span class="ctx-label">Elapsed</span>
        <code>
          {(pauseSnapshot.elapsedMs / 1000).toFixed(1)}s · ~char
          {pauseSnapshot.estimatedCharOffset} of {pauseSnapshot.narrationText.length}
        </code>
      </div>
      {#if pauseSnapshot.lastSpokenWindow}
        <div class="ctx-row ctx-window">
          <span class="ctx-label">Last spoken</span>
          <q>…{pauseSnapshot.lastSpokenWindow}</q>
        </div>
      {/if}
    </div>
  {:else}
    <p class="panel-hint">No narration anchor yet. This will be submitted as a slide-level comment.</p>
  {/if}

  <label class="feedback-field">
    <span>Your comment or correction</span>
    <textarea
      bind:value={feedbackText}
      placeholder={pauseSnapshot ? "e.g. no -- we do not do that, we do this..." : "Comment on the current slide or the deck direction."}
      rows="3"
    ></textarea>
  </label>

  <label class="feedback-field">
    <span>Additional context (paste)</span>
    <textarea
      bind:value={pasteContext}
      placeholder={'Paste a URL, snippet, or doc reference that clarifies the comment.'}
      rows="2"
    ></textarea>
  </label>

  <div class="feedback-actions">
    <button
      type="button"
      class="toolbar-btn"
      disabled={!canSubmit}
      onclick={onSubmit}
    >
      {feedbackSubmitting ? 'Submitting…' : 'Submit'}
    </button>
    <button type="button" class="toolbar-btn" onclick={onClear}>
      Clear
    </button>
  </div>
</section>

<style>
  .feedback-panel {
    margin: 0;
    padding: 1rem 1.25rem;
    border: 1px solid var(--border-soft, #d5d0c4);
    border-radius: 0.5rem;
    background: var(--bg-surface, #fffaf0);
  }
  .panel-kicker {
    margin: 0 0 0.15rem;
    color: var(--accent);
    font-size: 0.68rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .feedback-panel header h3 {
    margin: 0 0 0.25rem;
    font-size: 1.05rem;
  }
  .panel-hint {
    margin: 0.25rem 0 0.75rem;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  .comment-scopes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0 0 0.75rem;
  }
  .comment-scopes span {
    padding: 0.24rem 0.55rem;
    border: 1px solid var(--border-soft, #d5d0c4);
    border-radius: 999px;
    background: var(--bg-elevated, #fff);
    color: var(--ink-strong);
    font-size: 0.72rem;
    font-weight: 850;
  }
  .feedback-ok,
  .feedback-err {
    margin: 0.5rem 0 0.75rem;
    padding: 0.55rem 0.7rem;
    border-radius: 0.45rem;
    font-size: 0.9rem;
  }
  .feedback-ok {
    border: 1px solid rgba(22, 163, 74, 0.35);
    background: rgba(22, 163, 74, 0.1);
  }
  .feedback-err {
    border: 1px solid rgba(220, 38, 38, 0.35);
    background: rgba(220, 38, 38, 0.08);
  }
  .feedback-ok a {
    margin-left: 0.5rem;
    color: var(--accent);
    font-weight: 700;
  }
  .feedback-ok code {
    margin-left: 0.5rem;
    color: var(--ink-soft);
    font-size: 0.78rem;
    word-break: break-all;
  }
  .pause-context {
    margin: 0.5rem 0 1rem;
    padding: 0.75rem;
    background: var(--bg-elevated, #fff);
    border: 1px solid var(--border-soft, #ebe6d8);
    border-radius: 0.375rem;
    font-size: 0.85rem;
  }
  .ctx-row {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 0.25rem;
    align-items: baseline;
  }
  .ctx-row code { font-family: ui-monospace, monospace; }
  .ctx-label {
    color: var(--ink-soft);
    min-width: 6rem;
  }
  .ctx-window q {
    font-style: italic;
    color: var(--ink-soft);
  }
  .feedback-field {
    display: block;
    margin: 0.5rem 0;
  }
  .feedback-field span {
    display: block;
    font-size: 0.85rem;
    color: var(--ink-soft);
    margin-bottom: 0.25rem;
  }
  .feedback-field textarea {
    width: 100%;
    font-family: inherit;
    padding: 0.5rem;
    border: 1px solid var(--border-soft, #d5d0c4);
    border-radius: 0.375rem;
    resize: vertical;
  }
  .feedback-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .toolbar-btn {
    padding: 0.45rem 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 800;
    font-size: 0.82rem;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s;
  }
  .toolbar-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .toolbar-btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
