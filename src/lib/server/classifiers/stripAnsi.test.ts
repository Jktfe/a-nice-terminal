import { describe, it, expect } from 'vitest';
import { stripAnsi, normalizeForClassifier } from './stripAnsi';

describe('stripAnsi — Layer A/B chunk pre-pass (T2c-impl-2-codex delta-4)', () => {
  it('strips CSI colour escapes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m text')).toBe('red text');
  });

  it('strips OSC sequences (ESC ] … BEL)', () => {
    expect(stripAnsi('\x1b]0;tab title\x07hello')).toBe('hello');
  });

  it('strips single-byte ESC sequences (save/restore cursor)', () => {
    expect(stripAnsi('\x1b7keep\x1b8text')).toBe('keeptext');
  });

  it('strips C0 controls but preserves \\n and \\t', () => {
    expect(stripAnsi('a\x00b\x07c\nd\te')).toBe('abc\nd\te');
  });

  it('strips standalone CR (PTY \\r before \\n)', () => {
    expect(stripAnsi('line one\r\nline two')).toBe('line one\nline two');
  });

  it('returns empty for empty input', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('strips CSI K erase-line in mid-stream (delta-5 broader sweep)', () => {
    expect(stripAnsi('output\x1b[Kmore')).toBe('outputmore');
  });

  it('strips 8-bit C1 CSI (\\x9b) variant', () => {
    expect(stripAnsi('a\x9b31mred\x9b0mb')).toBe('aredb');
  });

  it('strips DCS sequences (ESC P … ESC \\\\)', () => {
    expect(stripAnsi('before\x1bPdcs body\x1b\\after')).toBe('beforeafter');
  });

  it('strips charset shifts \\x1b(B \\x1b)0 etc', () => {
    expect(stripAnsi('text\x1b(Bmore')).toBe('textmore');
  });

  it('strips bare \\x1bK + CR (live PTY screen-control chunk shape)', () => {
    // Per coordinator post-24th-rebuild diagnostic: kind=message rows still
    // contained text=\x1bK\r despite normalizer in path. Lock the strip.
    expect(stripAnsi('\x1bK\r')).toBe('');
    expect(normalizeForClassifier('\x1bK\r')).toBe('');
  });

  it('strips cursor-hide + cursor-home + repeated \\x1bK pattern', () => {
    expect(stripAnsi('\x1b[?25l\x1b[H\x1bK\rline\x1bK\r')).toBe('line');
  });
});

describe('normalizeForClassifier — boot-subscriber pre-pass', () => {
  it('strips trailing zsh % marker', () => {
    expect(normalizeForClassifier('output%')).toBe('output');
  });

  it('strips trailing screen-clear whitespace + padding', () => {
    expect(normalizeForClassifier('Confirm? y/n   \t  ')).toBe('Confirm? y/n');
  });

  it('preserves a single trailing newline if present', () => {
    expect(normalizeForClassifier('Confirm? y/n\n   ')).toBe('Confirm? y/n\n');
  });

  it('combines ANSI strip + zsh % strip + trailing-whitespace strip', () => {
    const dirty = '\x1b[1m> reasoning\x1b[0m\n\x1b[2m$ ls\x1b[0m\n%   ';
    expect(normalizeForClassifier(dirty)).toBe('> reasoning\n$ ls\n');
  });

  it('returns empty for empty input', () => {
    expect(normalizeForClassifier('')).toBe('');
  });
});
