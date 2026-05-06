// Pure helpers for the chat composer. Extracted from ChatPane.svelte so the
// cursor-insertion math (which is fiddly enough to have edge cases like the
// "leading space" rule and post-insert caret position) can be exercised in
// unit tests without spinning up a DOM textarea.

export interface InsertAtCursorInput {
  /** Current textarea value. */
  text: string;
  /** Selection start; null falls back to end-of-text (append). */
  selectionStart: number | null;
  /** Selection end; null falls back to end-of-text (append). */
  selectionEnd: number | null;
  /** Text being inserted (eg. an `![image](/uploads/...)` markdown blob). */
  insert: string;
}

export interface InsertAtCursorResult {
  /** New textarea value. */
  text: string;
  /** Caret position the textarea should be set to after the insert. */
  caret: number;
}

/**
 * Returns the new text + caret position for inserting `insert` at the current
 * cursor / selection range. Mirrors the rules used by ChatPane:
 *
 *   1. If the character immediately before the insertion point is non-empty
 *      and non-whitespace, prepend a single space so we never glue tokens
 *      together (eg. "hello![image](...)" — bad).
 *   2. Always append a single trailing space so the caret lands ready to type
 *      the next word.
 *   3. The caret lands one position past the trailing space, ie. ready for
 *      keystrokes after the insert.
 */
export function insertAtCursor({
  text,
  selectionStart,
  selectionEnd,
  insert,
}: InsertAtCursorInput): InsertAtCursorResult {
  const start = selectionStart ?? text.length;
  const end = selectionEnd ?? text.length;
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const next = `${before}${lead}${insert} ${after}`;
  const caret = before.length + lead.length + insert.length + 1;
  return { text: next, caret };
}
