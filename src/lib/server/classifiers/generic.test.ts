import { describe, expect, it } from 'vitest';
import { classifyGeneric } from './generic';

describe('classifyGeneric', () => {
  it('returns empty for empty buffer', () => {
    const result = classifyGeneric('');
    expect(result.events).toEqual([]);
    expect(result.remaining).toBe('');
  });

  it('classifies a plain line as message', () => {
    const result = classifyGeneric('hello world\n');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('message');
    expect(result.events[0].text).toBe('hello world');
    expect(result.events[0].trust).toBe('medium');
    expect(result.remaining).toBe('');
  });

  it('keeps trailing partial line in remaining', () => {
    const result = classifyGeneric('hello\npartial');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].text).toBe('hello');
    expect(result.remaining).toBe('partial');
  });

  it('classifies multiple lines', () => {
    const result = classifyGeneric('line one\nline two\n');
    expect(result.events).toHaveLength(2);
    expect(result.events[0].text).toBe('line one');
    expect(result.events[1].text).toBe('line two');
  });

  it('skips empty lines', () => {
    const result = classifyGeneric('a\n\nb\n');
    expect(result.events).toHaveLength(2);
    expect(result.events[0].text).toBe('a');
    expect(result.events[1].text).toBe('b');
  });

  it('classifies control-byte lines as raw', () => {
    const result = classifyGeneric('normal\n\x01control\n');
    expect(result.events).toHaveLength(2);
    expect(result.events[0].kind).toBe('message');
    expect(result.events[1].kind).toBe('raw');
    expect(result.events[1].trust).toBe('raw');
  });

  it('classifies shell prompt line as raw', () => {
    const result = classifyGeneric('user@host:~$ ');
    expect(result.events).toHaveLength(0);
    expect(result.remaining).toBe('user@host:~$ ');
  });

  it('preserves last line without newline as remaining', () => {
    const result = classifyGeneric('complete\nincomplete');
    expect(result.events).toHaveLength(1);
    expect(result.remaining).toBe('incomplete');
  });
});
