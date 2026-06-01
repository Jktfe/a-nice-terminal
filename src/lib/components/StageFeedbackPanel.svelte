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

  const canSubmit = $derived(
    Boolean(pauseSnapshot) && feedbackText.trim().length > 0 && !feedbackSubmitting
  );
</script>

<section class="feedback-panel" aria-label="Stage feedback">
  <header>
    <h3>Feedback</h3>
    <p class="panel-hint">
      Pause narration to anchor feedback to a spoken moment. Submit sends it
      to the Stage agents without mutating the source deck.
    </p>
  </header>

  {#if feedbackNotice}
    <p class={feedbackNotice.kind === 'ok' ? 'feedback-ok' : 'feedback-err'} role="status">
      {feedbackNotice.text}
      {#if feedbackNotice.ref}
        <a href={feedbackNotice.ref}>Open proposal</a>
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
    <p class="panel-hint">No pause context yet. Hit <strong>Pause</strong> during narration to capture.</p>
  {/if}

  <label class="feedback-field">
    <span>Your correction or feedback</span>
    <textarea
      bind:value={feedbackText}
      placeholder={pauseSnapshot ? "e.g. no -- we do not do that, we do this..." : "Pause narration first to anchor your feedback."}
      rows="3"
      disabled={!pauseSnapshot}
    ></textarea>
  </label>

  <label class="feedback-field">
    <span>Additional context (paste)</span>
    <textarea
      bind:value={pasteContext}
      placeholder={pauseSnapshot ? 'Paste a URL, snippet, or doc reference that clarifies what "that" refers to.' : ''}
      rows="2"
      disabled={!pauseSnapshot}
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
    margin-top: 2rem;
    padding: 1rem 1.25rem;
    border: 1px solid var(--border-soft, #d5d0c4);
    border-radius: 0.5rem;
    background: var(--bg-surface, #fffaf0);
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
  .feedback-field textarea:disabled {
    background: var(--bg-disabled, #f5f1e8);
    cursor: not-allowed;
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
