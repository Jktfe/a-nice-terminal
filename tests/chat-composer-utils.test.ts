// Locks in the cursor-insertion rules that ChatPane.svelte's image dropzone
// (962c122) and any future "insert markdown blob at caret" affordances rely
// on. Edge cases worth pinning explicitly: empty composer, append vs splice
// vs replace-selection, the leading-space rule, and the post-insert caret
// landing one past the trailing space.
import { describe, expect, it } from 'vitest';
import { insertAtCursor } from '../src/lib/components/chat-composer-utils.js';

describe('insertAtCursor', () => {
  it('appends to an empty composer with no leading space', () => {
    const r = insertAtCursor({
      text: '',
      selectionStart: 0,
      selectionEnd: 0,
      insert: '![image](/uploads/abc.png)',
    });
    expect(r.text).toBe('![image](/uploads/abc.png) ');
    expect(r.caret).toBe('![image](/uploads/abc.png) '.length);
  });

  it('inserts a leading space when caret follows a non-whitespace character', () => {
    const r = insertAtCursor({
      text: 'hello',
      selectionStart: 5,
      selectionEnd: 5,
      insert: '![img](u)',
    });
    expect(r.text).toBe('hello ![img](u) ');
    // caret = 5 ("hello") + 1 (lead) + "![img](u)".length + 1 (trailing space)
    expect(r.caret).toBe(5 + 1 + '![img](u)'.length + 1);
  });

  it('does not double-space when caret already follows whitespace', () => {
    const r = insertAtCursor({
      text: 'hello ',
      selectionStart: 6,
      selectionEnd: 6,
      insert: '![img](u)',
    });
    expect(r.text).toBe('hello ![img](u) ');
    expect(r.caret).toBe(6 + '![img](u)'.length + 1);
  });

  it('replaces an active selection range cleanly', () => {
    const r = insertAtCursor({
      text: 'hello WORLD!',
      selectionStart: 6,
      selectionEnd: 11,
      insert: 'mars',
    });
    expect(r.text).toBe('hello mars !');
    // before = "hello " (already ends with whitespace, so no lead)
    expect(r.caret).toBe(6 + 'mars'.length + 1);
  });

  it('falls back to end-of-text when selectionStart/End are null', () => {
    const r = insertAtCursor({
      text: 'hi',
      selectionStart: null,
      selectionEnd: null,
      insert: '![x](y)',
    });
    expect(r.text).toBe('hi ![x](y) ');
    expect(r.caret).toBe('hi ![x](y) '.length);
  });

  it('inserts at start of text without a leading space', () => {
    const r = insertAtCursor({
      text: 'rest of message',
      selectionStart: 0,
      selectionEnd: 0,
      insert: '![img](u)',
    });
    expect(r.text).toBe('![img](u) rest of message');
    expect(r.caret).toBe('![img](u) '.length);
  });

  it('inserts cleanly mid-text — splices around the caret with both lead + trailing spaces', () => {
    // Caret at index 9 sits on the space-before-"end". `before` is "see this:"
    // which ends in a non-whitespace `:`, so the helper inserts a lead space.
    // The trailing space lives between the insert and the existing space-then-"end".
    const r = insertAtCursor({
      text: 'see this: end',
      selectionStart: 9,
      selectionEnd: 9,
      insert: '![img](u)',
    });
    expect(r.text).toBe('see this: ![img](u)  end');
    // 9 (before) + 1 (lead) + insert.length + 1 (trailing) = 20
    expect(r.caret).toBe(9 + 1 + '![img](u)'.length + 1);
  });
});
