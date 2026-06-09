<script lang="ts">
  /**
   * SlidePicker — the Stage redesign's slide navigator (JWPK wireframe).
   * A thumbnail grid where each position shows its live slide plus stacked
   * version variants (Slide 8 → v1/v2/v3), with per-slide Hide / Delete / Move.
   *
   * Thin shell: state + persistence live in the parent (decks/[deckId]/
   * +page.svelte, wired post-land); this renders PickerSlide[] and emits intent
   * via callback props. The reducers in slidePickerModel.ts are the parent's to
   * apply. No store/page import here → no collision with the cockpit base.
   */
  import { liveVariant, type PickerSlide } from './slidePickerModel';

  let {
    slides,
    activePosition = null,
    onSelect,
    onSetLiveVariant,
    onHide,
    onDelete,
    onMove
  }: {
    slides: PickerSlide[];
    activePosition?: number | null;
    /** A position's live slide was clicked (navigate Main Deck to it). */
    onSelect: (position: number, slideId: string) => void;
    /** Promote a stored variant to live for its position. */
    onSetLiveVariant: (position: number, slideId: string) => void;
    /** Hide/show a position (recoverable; skipped on present). */
    onHide: (position: number, hidden: boolean) => void;
    /** Delete a position. */
    onDelete: (position: number) => void;
    /** Reorder: move a position one step left/right. */
    onMove: (from: number, to: number) => void;
  } = $props();
</script>

<section class="slide-picker" aria-label="Slide picker">
  <header>
    <p class="panel-kicker">Deck</p>
    <h3>Slide picker</h3>
  </header>

  <ol class="grid" role="list">
    {#each slides as slide (slide.position)}
      {@const live = liveVariant(slide)}
      <li
        class="cell"
        class:active={slide.position === activePosition}
        class:hidden={slide.hidden}
      >
        <button
          type="button"
          class="thumb"
          aria-current={slide.position === activePosition ? 'true' : undefined}
          onclick={() => live && onSelect(slide.position, live.slideId)}
        >
          <span class="pos">{slide.position}</span>
          <span class="title">{slide.title}</span>
          {#if slide.hidden}<span class="badge">hidden</span>{/if}
        </button>

        {#if slide.variants.length > 1}
          <div class="variants" aria-label={`Versions of slide ${slide.position}`}>
            {#each slide.variants as v (v.slideId)}
              <button
                type="button"
                class="variant"
                class:live={v.isLive}
                aria-pressed={v.isLive}
                onclick={() => onSetLiveVariant(slide.position, v.slideId)}
                title={v.isLive ? `${v.label} (live)` : `Make ${v.label} live`}
              >{v.label}</button>
            {/each}
          </div>
        {/if}

        <div class="actions" aria-label={`Actions for slide ${slide.position}`}>
          <button type="button" onclick={() => onHide(slide.position, !slide.hidden)}>
            {slide.hidden ? 'Show' : 'Hide'}
          </button>
          <button
            type="button"
            disabled={slide.position === 1}
            onclick={() => onMove(slide.position - 1, slide.position - 2)}
            aria-label="Move left"
          >←</button>
          <button
            type="button"
            disabled={slide.position === slides.length}
            onclick={() => onMove(slide.position - 1, slide.position)}
            aria-label="Move right"
          >→</button>
          <button type="button" class="danger" onclick={() => onDelete(slide.position)}>Delete</button>
        </div>
      </li>
    {/each}
  </ol>
</section>

<style>
  .slide-picker { display: flex; flex-direction: column; gap: 0.5rem; }
  .panel-kicker { margin: 0; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; }
  h3 { margin: 0 0 0.25rem; font-size: 0.95rem; }
  .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr)); gap: 0.5rem; }
  .cell { display: flex; flex-direction: column; gap: 0.25rem; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 0.5rem; padding: 0.4rem; }
  .cell.active { border-color: color-mix(in srgb, currentColor 55%, transparent); box-shadow: 0 0 0 1px currentColor inset; }
  .cell.hidden { opacity: 0.5; }
  .thumb { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; width: 100%; background: color-mix(in srgb, currentColor 6%, transparent); border: 0; border-radius: 0.35rem; padding: 0.5rem; cursor: pointer; text-align: left; }
  .pos { font-size: 0.7rem; opacity: 0.6; }
  .title { font-size: 0.8rem; font-weight: 600; }
  .badge { font-size: 0.6rem; text-transform: uppercase; opacity: 0.7; }
  .variants { display: flex; flex-wrap: wrap; gap: 0.2rem; }
  .variant { font-size: 0.65rem; padding: 0.1rem 0.35rem; border-radius: 0.35rem; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; cursor: pointer; }
  .variant.live { background: color-mix(in srgb, currentColor 20%, transparent); font-weight: 700; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.15rem; }
  .actions button { font-size: 0.65rem; padding: 0.1rem 0.3rem; border-radius: 0.3rem; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: transparent; cursor: pointer; }
  .actions button:disabled { opacity: 0.35; cursor: default; }
  .actions .danger { color: color-mix(in srgb, red 70%, currentColor); }
</style>
