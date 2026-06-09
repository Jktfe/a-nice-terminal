<script lang="ts">
  /**
   * VersionSwitcher — the Version History panel's VIEW / VIEWING control
   * (JWPK wireframe). Lists deck versions (V1 → V2 → …); the current one is
   * marked VIEWING, the rest offer VIEW to swap which version renders in the
   * Main Deck. Feedback counts (overall + per-slide comments) show per version.
   *
   * Thin shell: the parent owns version state + the deckStore swap (wired
   * post-land); this renders DeckVersionRef[] and emits onView(versionId).
   * setViewing() in slidePickerModel.ts is the parent's reducer.
   */
  import type { DeckVersionRef } from './slidePickerModel';

  let {
    versions,
    onView
  }: {
    versions: DeckVersionRef[];
    /** Switch the Main Deck to render this version. */
    onView: (versionId: string) => void;
  } = $props();
</script>

<section class="version-history" aria-label="Version history">
  <header>
    <p class="panel-kicker">History</p>
    <h3>Version History</h3>
  </header>

  <ol class="versions" role="list">
    {#each versions as v (v.versionId)}
      <li class="row" class:viewing={v.isViewing}>
        <span class="label">{v.label}</span>
        {#if v.feedbackCount > 0}
          <span class="feedback" title={`${v.feedbackCount} comment${v.feedbackCount === 1 ? '' : 's'}`}>
            💬 {v.feedbackCount}
          </span>
        {/if}
        {#if v.isViewing}
          <span class="viewing-tag" aria-current="true">VIEWING</span>
        {:else}
          <button type="button" class="view" onclick={() => onView(v.versionId)}>VIEW</button>
        {/if}
      </li>
    {/each}
  </ol>
</section>

<style>
  .version-history { display: flex; flex-direction: column; gap: 0.4rem; }
  .panel-kicker { margin: 0; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; }
  h3 { margin: 0 0 0.25rem; font-size: 0.95rem; }
  .versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .row { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem; border-radius: 0.4rem; border: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  .row.viewing { background: color-mix(in srgb, currentColor 12%, transparent); border-color: color-mix(in srgb, currentColor 40%, transparent); }
  .label { font-weight: 700; font-size: 0.85rem; }
  .feedback { font-size: 0.7rem; opacity: 0.75; margin-left: auto; }
  .row.viewing .feedback, .row:not(.viewing) .feedback { margin-left: auto; }
  .viewing-tag { font-size: 0.65rem; font-weight: 700; letter-spacing: 0.06em; padding: 0.1rem 0.4rem; border-radius: 0.3rem; background: color-mix(in srgb, currentColor 22%, transparent); }
  .view { font-size: 0.7rem; padding: 0.15rem 0.55rem; border-radius: 0.3rem; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; cursor: pointer; }
</style>
