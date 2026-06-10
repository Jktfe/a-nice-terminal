/**
 * Tests for ollamaLedger — record + windowed summarize behaviour, plus
 * the pi-transcript feed end-to-end (JWPK 2026-06-10).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  recordLocalUsageEvent,
  resetLocalUsageLedgerForTests,
  summarizeLocalUsage
} from './ollamaLedger';
import { recordOllamaUsageFromPiLine } from '../piTranscriptTail';
import { resetIdentityDbForTests } from '../db';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('ollamaLedger', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetLocalUsageLedgerForTests();
  });

  it('records an event and rolls it into today + week totals', () => {
    recordLocalUsageEvent({
      provider: 'ollama',
      model: 'gemma3',
      inputTokens: 100,
      outputTokens: 50,
      source: 'test'
    });
    const summary = summarizeLocalUsage('ollama');
    expect(summary.todayTokens).toBe(150);
    expect(summary.todayEvents).toBe(1);
    expect(summary.weekTokens).toBe(150);
    expect(summary.weekEvents).toBe(1);
    expect(summary.topModel).toBe('gemma3');
    expect(summary.lastEventAtMs).toBeTypeOf('number');
  });

  it('skips zero-token events entirely', () => {
    recordLocalUsageEvent({ provider: 'ollama', source: 'test' });
    recordLocalUsageEvent({ provider: 'ollama', inputTokens: 0, outputTokens: 0, source: 'test' });
    expect(summarizeLocalUsage('ollama').weekEvents).toBe(0);
  });

  it('keeps 2-day-old events in the week window but out of today', () => {
    const now = Date.now();
    recordLocalUsageEvent({
      provider: 'ollama',
      inputTokens: 10,
      outputTokens: 0,
      source: 'test',
      occurredAtMs: now - 2 * DAY_MS
    });
    recordLocalUsageEvent({
      provider: 'ollama',
      inputTokens: 5,
      outputTokens: 0,
      source: 'test',
      occurredAtMs: now - HOUR_MS
    });
    const summary = summarizeLocalUsage('ollama', now);
    expect(summary.todayTokens).toBe(5);
    expect(summary.weekTokens).toBe(15);
  });

  it('drops events older than 7 days from every window', () => {
    recordLocalUsageEvent({
      provider: 'ollama',
      inputTokens: 99,
      outputTokens: 0,
      source: 'test',
      occurredAtMs: Date.now() - 8 * DAY_MS
    });
    expect(summarizeLocalUsage('ollama').weekTokens).toBe(0);
  });

  it('separates providers — qwen rows never leak into ollama totals', () => {
    recordLocalUsageEvent({ provider: 'qwen', inputTokens: 7, source: 'test' });
    expect(summarizeLocalUsage('ollama').weekTokens).toBe(0);
    expect(summarizeLocalUsage('qwen').weekTokens).toBe(7);
  });

  it('picks the heaviest model of the week as topModel', () => {
    recordLocalUsageEvent({ provider: 'ollama', model: 'gemma3', inputTokens: 10, source: 'test' });
    recordLocalUsageEvent({ provider: 'ollama', model: 'gpt-oss', inputTokens: 90, source: 'test' });
    expect(summarizeLocalUsage('ollama').topModel).toBe('gpt-oss');
  });
});

describe('recordOllamaUsageFromPiLine (pi transcript feed)', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetLocalUsageLedgerForTests();
  });

  it('records input (fresh + cache) and output tokens from a usage line', () => {
    recordOllamaUsageFromPiLine(
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          usage: { input: 120, cacheRead: 30, cacheWrite: 10, output: 40 }
        }
      })
    );
    const summary = summarizeLocalUsage('ollama');
    expect(summary.todayTokens).toBe(200);
    expect(summary.todayEvents).toBe(1);
  });

  it('ignores lines without a usage object and malformed JSON', () => {
    recordOllamaUsageFromPiLine(JSON.stringify({ type: 'model_change' }));
    recordOllamaUsageFromPiLine('not json at all');
    recordOllamaUsageFromPiLine('');
    expect(summarizeLocalUsage('ollama').weekEvents).toBe(0);
  });

  it('attributes to the transcript provider — lmstudio traffic is not counted as ollama', () => {
    recordOllamaUsageFromPiLine(
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          provider: 'lmstudio',
          model: 'openai/gpt-oss-20b',
          usage: { input: 1944, output: 78, cacheRead: 0, cacheWrite: 0 }
        }
      })
    );
    expect(summarizeLocalUsage('ollama').weekEvents).toBe(0);
    const lmstudio = summarizeLocalUsage('lmstudio');
    expect(lmstudio.weekEvents).toBe(1);
    expect(lmstudio.todayTokens).toBe(2022);
  });
});
