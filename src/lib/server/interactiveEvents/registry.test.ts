import { describe, it, expect } from 'vitest';
import { detectClaudeCode } from './claudeCodeDetect';
import { dispatchInteractiveDetect } from './registry';

describe('detectClaudeCode', () => {
  it('detects bare y/n confirmation prompts', () => {
    const result = detectClaudeCode('Doing the thing\nProceed? y/n');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventClass).toBe('confirmation');
  });

  it('detects parenthesised (y/n) variant', () => {
    const result = detectClaudeCode('Continue? (y/n)');
    expect(result.events[0].eventClass).toBe('confirmation');
  });

  it('detects bracketed default [Y/n]', () => {
    const result = detectClaudeCode('Apply patch? [Y/n]');
    expect(result.events[0].eventClass).toBe('confirmation');
  });

  it('detects bracketed default (y/N) — n is the default', () => {
    const result = detectClaudeCode('Save and overwrite? (y/N)');
    expect(result.events[0].eventClass).toBe('confirmation');
  });

  it('tolerates trailing newline (chunk-boundary normalisation)', () => {
    const result = detectClaudeCode('Confirm? y/n\n');
    expect(result.events[0].eventClass).toBe('confirmation');
  });

  it('tolerates yes/no with full words', () => {
    const result = detectClaudeCode('Continue? yes/no');
    expect(result.events[0].eventClass).toBe('confirmation');
  });

  it('detects yn-then-? reversed order y/n?', () => {
    const result = detectClaudeCode('Proceed y/n?');
    expect(result.events[0].eventClass).toBe('confirmation');
  });

  it('detects free-text colon prompts (with chunk-trim)', () => {
    const result = detectClaudeCode('What is your name: \n');
    expect(result.events[0].eventClass).toBe('free_text');
  });

  it('returns empty events when buffer ends mid-statement', () => {
    const result = detectClaudeCode('working on file.ts...\n');
    expect(result.events).toEqual([]);
    expect(result.consumedBytes).toBe(0);
  });

  it('does not match plain text containing y/n inside a sentence', () => {
    const result = detectClaudeCode('options include y/n in the docs\n');
    expect(result.events).toEqual([]);
  });

  it('handles empty buffer', () => {
    const result = detectClaudeCode('');
    expect(result.events).toEqual([]);
    expect(result.consumedBytes).toBe(0);
  });
});

describe('dispatchInteractiveDetect (registry)', () => {
  it('returns empty when agentKindHint is null/unknown', () => {
    const result = dispatchInteractiveDetect({ sessionId: 's1', buffer: 'Confirm? (y/n)', agentKindHint: null });
    expect(result.events).toEqual([]);
  });

  it('dispatches to claudeCode when hint matches', () => {
    const result = dispatchInteractiveDetect({ sessionId: 's1', buffer: 'Confirm? (y/n)', agentKindHint: 'claude-code' });
    expect(result.events[0].eventClass).toBe('confirmation');
  });
});
