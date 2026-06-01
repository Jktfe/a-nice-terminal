import { describe, it, expect } from 'vitest';
import { extractStructuredEvents } from './structuredMarkers';

describe('extractStructuredEvents — T2c-impl-3 marker preprocessor', () => {
  it('extracts a single marker as a high-trust event + strips from cleaned', () => {
    const buffer = 'before [ANT-EV]{"kind":"thinking","text":"reasoning"}[/ANT-EV] after';
    const result = extractStructuredEvents(buffer);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ kind: 'thinking', text: 'reasoning', trust: 'high' });
    expect(result.cleaned).toBe('before  after');
  });

  it('extracts multiple markers preserving order + strips them all', () => {
    const buffer = '[ANT-EV]{"kind":"command","text":"ls"}[/ANT-EV]\n[ANT-EV]{"kind":"tool_call","text":"read"}[/ANT-EV]';
    const result = extractStructuredEvents(buffer);
    expect(result.events.map((e) => e.kind)).toEqual(['command', 'tool_call']);
    expect(result.cleaned).toBe('\n');
  });

  it('drops events when JSON inside braces is malformed', () => {
    // Brace-shape passes the regex; JSON parse fails → marker stripped, no event.
    const buffer = '[ANT-EV]{not-valid-json}[/ANT-EV] regular text';
    const result = extractStructuredEvents(buffer);
    expect(result.events).toEqual([]);
    expect(result.cleaned).toBe(' regular text');
  });

  it('passes non-brace marker payloads through unchanged (regex non-match)', () => {
    // No braces ⇒ no regex match ⇒ marker text stays in buffer for heuristic.
    const buffer = '[ANT-EV]not-json[/ANT-EV] regular text';
    const result = extractStructuredEvents(buffer);
    expect(result.events).toEqual([]);
    expect(result.cleaned).toBe(buffer);
  });

  it('rejects unknown kinds (only the 6 durable kinds are accepted)', () => {
    const buffer = '[ANT-EV]{"kind":"unknown_thing","text":"x"}[/ANT-EV]';
    const result = extractStructuredEvents(buffer);
    expect(result.events).toEqual([]);
    expect(result.cleaned).toBe('');
  });

  it('returns buffer unchanged when no markers present', () => {
    const result = extractStructuredEvents('plain text without markers\n');
    expect(result.events).toEqual([]);
    expect(result.cleaned).toBe('plain text without markers\n');
  });

  it('handles empty text field gracefully', () => {
    const buffer = '[ANT-EV]{"kind":"message"}[/ANT-EV]';
    const result = extractStructuredEvents(buffer);
    expect(result.events[0]).toEqual({ kind: 'message', text: '', trust: 'high' });
  });

  it('integration via dispatchClassify: structured events come BEFORE heuristic', async () => {
    const { dispatchClassify, resetClassifierBuffersForTests } = await import('../classifierRegistry');
    resetClassifierBuffersForTests();
    const events = dispatchClassify({
      sessionId: 't_struct',
      chunk: 'plain line\n[ANT-EV]{"kind":"thinking","text":"high-trust"}[/ANT-EV]\nanother\n',
      agentKindHint: null
    });
    const trusts = events.map((e) => e.trust);
    expect(trusts).toContain('high');
    expect(trusts).toContain('medium');
    // structured first, then heuristic — high before medium
    expect(trusts.indexOf('high')).toBeLessThan(trusts.indexOf('medium'));
  });
});
