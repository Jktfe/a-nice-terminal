import { describe, expect, it } from 'vitest';
import { detectClaudeCode } from './claudeCodeDetect';

describe('detectClaudeCode', () => {
  it('returns empty for empty buffer', () => {
    const result = detectClaudeCode('');
    expect(result.events).toEqual([]);
    expect(result.consumedBytes).toBe(0);
  });

  it('detects confirmation prompt y/n after question', () => {
    const result = detectClaudeCode('Continue? y/n');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventClass).toBe('confirmation');
    expect(result.events[0].promptText).toBe('Continue? y/n');
    expect(result.events[0].choices).toEqual(['yes', 'no']);
    expect(result.consumedBytes).toBeGreaterThan(0);
  });

  it('detects confirmation prompt with bracketed default', () => {
    const result = detectClaudeCode('Apply? [Y/n]');
    expect(result.events[0].eventClass).toBe('confirmation');
    expect(result.events[0].promptText).toBe('Apply? [Y/n]');
  });

  it('detects confirmation prompt with parens default', () => {
    const result = detectClaudeCode('Save? (y/N)');
    expect(result.events[0].eventClass).toBe('confirmation');
    expect(result.events[0].promptText).toBe('Save? (y/N)');
  });

  it('detects yn-then-question pattern', () => {
    const result = detectClaudeCode('[Y/n]?');
    expect(result.events[0].eventClass).toBe('confirmation');
  });

  it('detects free-text colon prompt', () => {
    const result = detectClaudeCode('Name: ');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventClass).toBe('free_text');
    expect(result.events[0].promptText).toBe('Name:');
  });

  it('ignores non-prompt text', () => {
    const result = detectClaudeCode('Just some output here');
    expect(result.events).toEqual([]);
    expect(result.consumedBytes).toBe(0);
  });

  it('handles multi-line buffer and uses last non-empty line', () => {
    const result = detectClaudeCode('line one\nline two\nContinue? y/n');
    expect(result.events[0].eventClass).toBe('confirmation');
    expect(result.events[0].promptText).toBe('Continue? y/n');
  });

  it('ignores trailing whitespace before matching', () => {
    const result = detectClaudeCode('Continue? y/n\n\n  ');
    expect(result.events[0].eventClass).toBe('confirmation');
  });

  it('is case-insensitive for confirmation', () => {
    expect(detectClaudeCode('OK? Y/N').events[0].eventClass).toBe('confirmation');
    expect(detectClaudeCode('OK? y/n').events[0].eventClass).toBe('confirmation');
  });
});
