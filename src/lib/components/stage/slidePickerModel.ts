/**
 * Slide-picker + version model — the PURE logic behind the Stage redesign's
 * Slide picker (per-slide version variants + Hide/Delete/Move) and the Version
 * History VIEW/VIEWING switcher, from JWPK's wireframe.
 *
 * Kept framework-free + side-effect-free so it's fully unit-tested without a
 * DOM; the SlidePicker.svelte / VersionSwitcher.svelte components are thin
 * shells that render this state and emit the events these reducers consume.
 *
 * INTEGRATION CONTRACT (the boundary @researchant owns vs @oiresearch's cockpit
 * base): these types + reducers are standalone. Wiring into decks/[deckId]/
 * +page.svelte happens AFTER the Stage cockpit base lands — the page passes a
 * PickerSlide[] down and handles the emitted PickerEvent[] against deckStore.
 * Nothing here imports the page or the store, so it can't collide.
 */

/** One stored variant of a slide position (e.g. "v1", "v2"). */
export interface SlideVariant {
  /** The underlying DeckSlide.id for this variant. */
  slideId: string;
  /** Display label, e.g. "v1". */
  label: string;
  /** True for the variant currently rendered at this position. Exactly one per slide. */
  isLive: boolean;
}

/** A position in the picker: one live slide + its stacked alternate variants. */
export interface PickerSlide {
  /** 1-based position in the deck (the picker shows these in order). */
  position: number;
  /** Title of the live variant (for the thumbnail label). */
  title: string;
  /** Variants for this position; length 1 = a plain slide with no alternates. */
  variants: SlideVariant[];
  /** Hidden slides stay in the model (recoverable) but are skipped on present. */
  hidden: boolean;
}

/** A deck-level version for the Version History panel. */
export interface DeckVersionRef {
  versionId: string;
  /** Display label, e.g. "V1". */
  label: string;
  /** The version currently being viewed in the Main Deck (the "VIEWING" row). */
  isViewing: boolean;
  /** Count of feedback comments attached to this version (overall + per-slide). */
  feedbackCount: number;
}

/** The live variant of a position, or undefined if (impossibly) none is live. */
export function liveVariant(slide: PickerSlide): SlideVariant | undefined {
  return slide.variants.find((v) => v.isLive);
}

/**
 * Move the slide at `from` (0-based index into the ordered array) to `to`,
 * renumbering positions 1..n. Out-of-range indices return the input unchanged
 * (no silent corruption — the caller's drag gave a bad index).
 */
export function reorderSlides(
  slides: ReadonlyArray<PickerSlide>,
  from: number,
  to: number
): PickerSlide[] {
  if (from < 0 || from >= slides.length || to < 0 || to >= slides.length || from === to) {
    return renumber(slides);
  }
  const next = [...slides];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return renumber(next);
}

/** Toggle a position hidden/shown. Unknown position → unchanged. */
export function setHidden(
  slides: ReadonlyArray<PickerSlide>,
  position: number,
  hidden: boolean
): PickerSlide[] {
  return renumber(slides.map((s) => (s.position === position ? { ...s, hidden } : s)));
}

/**
 * Delete a position. Soft by intent: the caller decides whether to also drop the
 * underlying slides; this just removes the picker entry and renumbers. Deleting
 * the last remaining slide is refused (a deck needs ≥1 slide) — returns input.
 */
export function deleteSlide(
  slides: ReadonlyArray<PickerSlide>,
  position: number
): PickerSlide[] {
  if (slides.length <= 1) return renumber(slides);
  return renumber(slides.filter((s) => s.position !== position));
}

/**
 * Promote a stored variant to live for its position. The named variant becomes
 * `isLive`, all siblings at that position go false, and the slide title follows
 * the new live variant's label is left to the caller (title is derived on wire).
 * Unknown position or unknown slideId → unchanged (no accidental "no live").
 */
export function setLiveVariant(
  slides: ReadonlyArray<PickerSlide>,
  position: number,
  slideId: string
): PickerSlide[] {
  return renumber(
    slides.map((s) => {
      if (s.position !== position) return s;
      if (!s.variants.some((v) => v.slideId === slideId)) return s; // unknown → no-op
      return {
        ...s,
        variants: s.variants.map((v) => ({ ...v, isLive: v.slideId === slideId }))
      };
    })
  );
}

/**
 * Switch which deck version is being VIEWED. The named version becomes
 * `isViewing`, all others false. Unknown id → unchanged (never leave zero
 * viewing, never set two).
 */
export function setViewing(
  versions: ReadonlyArray<DeckVersionRef>,
  versionId: string
): DeckVersionRef[] {
  if (!versions.some((v) => v.versionId === versionId)) return [...versions];
  return versions.map((v) => ({ ...v, isViewing: v.versionId === versionId }));
}

/** Reassign 1-based positions to match array order. */
function renumber(slides: ReadonlyArray<PickerSlide>): PickerSlide[] {
  return slides.map((s, i) => ({ ...s, position: i + 1 }));
}
