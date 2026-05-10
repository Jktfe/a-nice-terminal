// A1 of main-app-improvements-2026-05-10 — extracted composable that
// shares one mention-autocomplete implementation between MessageInput and
// the grid composer. Wraps the pure helpers in src/lib/utils/mentions.ts
// in Svelte 5 reactive state so each composer renders its own dropdown
// from the same source of truth.

import {
  applyMentionSelection,
  detectMentionTrigger,
  filterAndScoreHandles,
  pinEveryoneFirst,
  shouldCompleteMentionOnEnter,
  type MentionHandle,
} from '$lib/utils/mentions.js';

export interface MentionAutocompleteOptions {
  /** Max number of entries shown in the dropdown. Default 6. */
  limit?: number;
  /** Whether to pin @everyone to the front of the routing list. Default true. */
  pinEveryone?: boolean;
}

export class MentionAutocomplete {
  #handles: () => MentionHandle[];
  #limit: number;
  #pinEveryone: boolean;

  query = $state('');
  show = $state(false);
  start = $state(-1);
  selectedIdx = $state(0);
  navigated = $state(false);

  routingHandles = $derived.by(() =>
    this.#pinEveryone ? pinEveryoneFirst(this.#handles()) : this.#handles(),
  );

  filtered = $derived.by(() => filterAndScoreHandles(this.routingHandles, this.query, this.#limit));

  constructor(getHandles: () => MentionHandle[], opts: MentionAutocompleteOptions = {}) {
    this.#handles = getHandles;
    this.#limit = opts.limit ?? 6;
    this.#pinEveryone = opts.pinEveryone ?? true;
  }

  /** Detect whether `text` up to `cursor` ends in an @mention trigger and
   *  update reactive state accordingly. Hides the dropdown when there is
   *  no trigger or no handles to suggest. */
  detect(text: string, cursor: number): void {
    const trigger = detectMentionTrigger(text, cursor);
    if (trigger && this.routingHandles.length > 0) {
      this.start = trigger.start;
      this.query = trigger.query;
      this.selectedIdx = 0;
      this.navigated = false;
      this.show = this.filtered.length > 0;
    } else {
      this.show = false;
      this.start = -1;
      this.navigated = false;
    }
  }

  /** Insert the selected handle into `text` at the active trigger range.
   *  Returns the new text and the cursor position to apply, or null when
   *  there is no active trigger. */
  apply(text: string, cursor: number, handle: string): { text: string; cursorAfter: number } | null {
    if (this.start < 0) return null;
    const result = applyMentionSelection(text, cursor, this.start, handle);
    this.show = false;
    this.start = -1;
    this.navigated = false;
    return result;
  }

  /** Move highlight down within `filtered`. */
  arrowDown(): void {
    this.navigated = true;
    this.selectedIdx = Math.min(this.selectedIdx + 1, this.filtered.length - 1);
  }

  /** Move highlight up within `filtered`. */
  arrowUp(): void {
    this.navigated = true;
    this.selectedIdx = Math.max(this.selectedIdx - 1, 0);
  }

  /** The handle currently highlighted in the dropdown, or null when empty. */
  current(): MentionHandle | null {
    return this.filtered[this.selectedIdx] ?? null;
  }

  /** Whether Enter should complete the mention rather than submit. Mirrors
   *  shouldCompleteMentionOnEnter so a literal already-complete @handle
   *  doesn't trap the user in autocomplete on every press. */
  shouldCompleteOnEnter(text: string, cursor: number): boolean {
    if (!this.show || this.filtered.length === 0) return false;
    const literal = this.start >= 0 ? text.slice(this.start, cursor) : null;
    return shouldCompleteMentionOnEnter({
      typedMention: literal && literal.startsWith('@') ? literal : null,
      selectedHandle: this.current()?.handle ?? null,
      navigated: this.navigated,
    });
  }

  reset(): void {
    this.show = false;
    this.start = -1;
    this.query = '';
    this.selectedIdx = 0;
    this.navigated = false;
  }
}

/** Convenience factory matching `useX` naming for callers that prefer it. */
export function useMentionAutocomplete(
  getHandles: () => MentionHandle[],
  opts: MentionAutocompleteOptions = {},
): MentionAutocomplete {
  return new MentionAutocomplete(getHandles, opts);
}
