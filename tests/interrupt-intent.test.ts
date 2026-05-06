import { describe, it, expect } from 'vitest';
import {
  INTERRUPT_INTENT_VERSION,
  buildInterruptIntent,
  serializeInterruptIntent,
  parseInterruptIntent,
  renderInterruptPrompt,
} from '../src/lib/server/interview/interrupt-intent';

const baseInput = {
  originalPrompt: 'Walk me through the auth model.',
  partialOutput: 'There are three modes: local, sha',
  interruptMessage: 'Skip local, focus on shared.',
  linkedChatId: 'lc-abc',
  agentHandle: '@claudeant',
  interruptedAtMs: 1_700_000_000_000,
};

describe('buildInterruptIntent', () => {
  it('builds a complete intent with all fields populated', () => {
    const intent = buildInterruptIntent(baseInput);
    expect(intent.schema_version).toBe(INTERRUPT_INTENT_VERSION);
    expect(intent.original_prompt).toBe(baseInput.originalPrompt);
    expect(intent.partial_output).toBe(baseInput.partialOutput);
    expect(intent.interrupt_message).toBe(baseInput.interruptMessage);
    expect(intent.linked_chat_id).toBe(baseInput.linkedChatId);
    expect(intent.agent_handle).toBe(baseInput.agentHandle);
    expect(intent.interrupted_at_ms).toBe(baseInput.interruptedAtMs);
  });

  it('defaults agent_handle to null when omitted', () => {
    const { agentHandle: _omit, ...rest } = baseInput;
    const intent = buildInterruptIntent(rest);
    expect(intent.agent_handle).toBeNull();
  });

  it('defaults interrupted_at_ms to Date.now()-ish when omitted', () => {
    const before = Date.now();
    const { interruptedAtMs: _omit, ...rest } = baseInput;
    const intent = buildInterruptIntent(rest);
    const after = Date.now();
    expect(intent.interrupted_at_ms).toBeGreaterThanOrEqual(before);
    expect(intent.interrupted_at_ms).toBeLessThanOrEqual(after);
  });

  it('allows partial_output to be empty (interrupted before any output)', () => {
    const intent = buildInterruptIntent({ ...baseInput, partialOutput: '' });
    expect(intent.partial_output).toBe('');
  });

  it('rejects an empty interrupt_message', () => {
    expect(() => buildInterruptIntent({ ...baseInput, interruptMessage: '' })).toThrow();
    expect(() => buildInterruptIntent({ ...baseInput, interruptMessage: '   ' })).toThrow();
  });

  it('rejects a missing linkedChatId', () => {
    expect(() => buildInterruptIntent({ ...baseInput, linkedChatId: '' })).toThrow();
  });

  it('rejects non-string original_prompt at runtime', () => {
    expect(() => buildInterruptIntent({ ...baseInput, originalPrompt: undefined as any })).toThrow();
  });
});

describe('serializeInterruptIntent + parseInterruptIntent', () => {
  it('round-trips through JSON', () => {
    const intent = buildInterruptIntent(baseInput);
    const wire = serializeInterruptIntent(intent);
    const parsed = parseInterruptIntent(wire);
    expect(parsed).toEqual(intent);
  });

  it('parseInterruptIntent accepts an object directly (already-parsed)', () => {
    const intent = buildInterruptIntent(baseInput);
    expect(parseInterruptIntent(intent)).toEqual(intent);
  });

  it('returns null for malformed JSON string instead of throwing', () => {
    expect(parseInterruptIntent('not json')).toBeNull();
  });

  it('returns null for null/undefined/non-object inputs', () => {
    expect(parseInterruptIntent(null)).toBeNull();
    expect(parseInterruptIntent(undefined)).toBeNull();
    expect(parseInterruptIntent(42 as any)).toBeNull();
  });

  it('returns null for wrong schema_version (forward compatibility)', () => {
    const intent = buildInterruptIntent(baseInput);
    const future = { ...intent, schema_version: 99 };
    expect(parseInterruptIntent(future)).toBeNull();
  });

  it('returns null when a required string field is missing', () => {
    const intent = buildInterruptIntent(baseInput);
    const broken = { ...intent } as any;
    delete broken.original_prompt;
    expect(parseInterruptIntent(broken)).toBeNull();
  });

  it('returns null when interrupted_at_ms is the wrong type', () => {
    const intent = buildInterruptIntent(baseInput);
    const broken = { ...intent, interrupted_at_ms: '2024' as any };
    expect(parseInterruptIntent(broken)).toBeNull();
  });

  it('accepts agent_handle as null without coercion', () => {
    const intent = buildInterruptIntent({ ...baseInput, agentHandle: null });
    const parsed = parseInterruptIntent(serializeInterruptIntent(intent));
    expect(parsed?.agent_handle).toBeNull();
  });
});

describe('renderInterruptPrompt', () => {
  it('includes the original prompt, partial output, and interrupt message', () => {
    const intent = buildInterruptIntent(baseInput);
    const rendered = renderInterruptPrompt(intent);
    expect(rendered).toContain(baseInput.originalPrompt);
    expect(rendered).toContain(baseInput.partialOutput);
    expect(rendered).toContain(baseInput.interruptMessage);
  });

  it('omits the partial-output section when there was none', () => {
    const intent = buildInterruptIntent({ ...baseInput, partialOutput: '' });
    const rendered = renderInterruptPrompt(intent);
    expect(rendered).not.toContain('Your partial output before interruption');
  });

  it('includes the decide-which directive at the end', () => {
    const intent = buildInterruptIntent(baseInput);
    const rendered = renderInterruptPrompt(intent);
    expect(rendered).toMatch(/incorporate.*restart.*continue/i);
  });
});
