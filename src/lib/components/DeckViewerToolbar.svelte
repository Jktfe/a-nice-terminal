<script lang="ts">
  type LensOption = { id: string; name: string };

  let {
    roomId,
    inspectMode,
    speakingThisSlide,
    pausedThisSlide,
    canStopVoice,
    showValidation,
    lenses,
    activeLensId,
    onToggleInspect,
    onPlayPause,
    onStop,
    onCopyShareLink,
    onToggleValidation,
    onLensChange
  }: {
    roomId: string;
    inspectMode: boolean;
    speakingThisSlide: boolean;
    pausedThisSlide: boolean;
    canStopVoice: boolean;
    showValidation: boolean;
    lenses: LensOption[];
    activeLensId: string | null;
    onToggleInspect: () => void;
    onPlayPause: () => void;
    onStop: () => void;
    onCopyShareLink: () => void;
    onToggleValidation: () => void;
    onLensChange: (lensId: string) => void;
  } = $props();
</script>

<div class="deck-toolbar" role="toolbar" aria-label="Deck controls">
  <a class="back" href={`/rooms/${encodeURIComponent(roomId)}`}>← Back to room</a>
  <span class="deck-spacer"></span>
  <button type="button" class="toolbar-btn" onclick={onToggleValidation} aria-pressed={showValidation}>
    {showValidation ? 'Hide validation' : 'Show validation'}
  </button>
  {#if showValidation && lenses.length > 0}
    <select
      class="toolbar-btn lens-select"
      value={activeLensId ?? lenses[0].id}
      onchange={(e) => onLensChange((e.currentTarget as HTMLSelectElement).value)}
      aria-label="Validation lens"
    >
      {#each lenses as lens}
        <option value={lens.id}>{lens.name}</option>
      {/each}
    </select>
  {/if}
  <button type="button" class="toolbar-btn" onclick={onToggleInspect} aria-pressed={inspectMode}>
    {inspectMode ? 'Hide JSON' : 'Inspect JSON'}
    <kbd>I</kbd>
  </button>
  <button type="button" class="toolbar-btn" onclick={onPlayPause} aria-pressed={speakingThisSlide}>
    {pausedThisSlide ? 'Resume' : (speakingThisSlide ? 'Pause' : 'Start voice')}
  </button>
  {#if canStopVoice}
    <button type="button" class="toolbar-btn" onclick={onStop}>
      Stop
    </button>
  {/if}
  <button type="button" class="toolbar-btn" onclick={onCopyShareLink}>
    Copy share link
  </button>
</div>

<style>
  .back {
    display: inline-block;
    color: var(--ink-soft);
    text-decoration: none;
    font-weight: 700;
    font-size: 0.85rem;
  }
  .back:hover { color: var(--accent); }
  .deck-toolbar {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0;
    margin-bottom: 1rem;
  }
  .deck-spacer { flex: 1; }
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
  .toolbar-btn:hover { border-color: var(--accent); color: var(--accent); }
  .toolbar-btn[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
  .toolbar-btn kbd {
    display: inline-block;
    margin-left: 0.4rem;
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.3rem;
    background: var(--bg);
    color: var(--ink-soft);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
  }
  .lens-select {
    appearance: none;
    -webkit-appearance: none;
    padding-right: 1.5rem;
    background-image: linear-gradient(45deg, transparent 50%, var(--ink-soft) 50%), linear-gradient(135deg, var(--ink-soft) 50%, transparent 50%);
    background-position: calc(100% - 0.85rem) 50%, calc(100% - 0.5rem) 50%;
    background-size: 0.35rem 0.35rem, 0.35rem 0.35rem;
    background-repeat: no-repeat;
    cursor: pointer;
    font-family: inherit;
  }
  .lens-select:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
