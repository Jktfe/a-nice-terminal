/**
 * Tests for qwenProvider's pure parsing layer — auth detection, the
 * permissive usage extractor, and window rollups (JWPK 2026-06-10).
 * Disk + provider assembly are deliberately untested here: the fs scan
 * is bounded plumbing, and shapes vary by qwen-code version, which is
 * exactly why the extractor is the part worth pinning down.
 */
import { describe, expect, it } from 'vitest';
import {
  detectQwenAuthKind,
  extractQwenUsageFromLine,
  rollupQwenUsage,
  type QwenUsageObservation
} from './qwenProvider';

const NOW = Date.parse('2026-06-10T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;

describe('detectQwenAuthKind', () => {
  it('detects the Coding Plan from its dedicated endpoint', () => {
    const settings = JSON.stringify({
      modelProviders: {
        openai: [{ id: 'qwen3-coder-plus', baseUrl: 'https://coding.dashscope.aliyuncs.com/v1' }]
      }
    });
    expect(detectQwenAuthKind(settings)).toBe('coding-plan');
  });

  it('detects the Coding Plan from its env key name', () => {
    const settings = JSON.stringify({ env: { BAILIAN_CODING_PLAN_API_KEY: 'sk-sp-x' } });
    expect(detectQwenAuthKind(settings)).toBe('coding-plan');
  });

  it('detects discontinued OAuth and generic API-key auth', () => {
    expect(
      detectQwenAuthKind(JSON.stringify({ security: { auth: { selectedType: 'qwen-oauth' } } }))
    ).toBe('qwen-oauth');
    expect(
      detectQwenAuthKind(JSON.stringify({ security: { auth: { selectedType: 'openai' } } }))
    ).toBe('api-key');
  });

  it('returns unknown for malformed or empty settings', () => {
    expect(detectQwenAuthKind('not json')).toBe('unknown');
    expect(detectQwenAuthKind('{}')).toBe('unknown');
  });
});

describe('extractQwenUsageFromLine', () => {
  it('reads snake_case OpenAI-style usage with an ISO timestamp', () => {
    const line = JSON.stringify({
      timestamp: '2026-06-10T11:30:00Z',
      usage: { prompt_tokens: 100, completion_tokens: 40 }
    });
    const obs = extractQwenUsageFromLine(line, NOW);
    expect(obs).toEqual({
      occurredAtMs: Date.parse('2026-06-10T11:30:00Z'),
      inputTokens: 100,
      outputTokens: 40
    });
  });

  it('reads camelCase usage nested under message', () => {
    const line = JSON.stringify({
      ts: NOW,
      message: { usage: { inputTokens: 7, outputTokens: 3 } }
    });
    const obs = extractQwenUsageFromLine(line, 0);
    expect(obs?.inputTokens).toBe(7);
    expect(obs?.outputTokens).toBe(3);
    expect(obs?.occurredAtMs).toBe(NOW);
  });

  it('falls back to totalTokens when no split is reported', () => {
    const line = JSON.stringify({ usage: { totalTokens: 55 } });
    const obs = extractQwenUsageFromLine(line, NOW);
    expect(obs?.inputTokens).toBe(55);
    expect(obs?.outputTokens).toBe(0);
  });

  // Real qwen-code (gemini-cli fork) session lines: the API token report is
  // top-level under `usageMetadata`, not a `usage` object. Verified against
  // ~/.qwen/projects/**/*.jsonl on 2026-06-10 — without this the qwen provider
  // silently extracts zero from real data.
  it('reads the real gemini-fork usageMetadata shape', () => {
    const line = JSON.stringify({
      usageMetadata: {
        promptTokenCount: 23687,
        candidatesTokenCount: 890,
        thoughtsTokenCount: 752,
        cachedContentTokenCount: 0,
        totalTokenCount: 25329
      }
    });
    const obs = extractQwenUsageFromLine(line, NOW);
    expect(obs?.inputTokens).toBe(23687);
    expect(obs?.outputTokens).toBe(890);
  });

  it('falls back to usageMetadata.totalTokenCount when no split is present', () => {
    const line = JSON.stringify({ usageMetadata: { totalTokenCount: 999 } });
    const obs = extractQwenUsageFromLine(line, NOW);
    expect(obs?.inputTokens).toBe(999);
    expect(obs?.outputTokens).toBe(0);
  });

  it('uses the fallback timestamp when the line has none', () => {
    const line = JSON.stringify({ usage: { prompt_tokens: 1 } });
    expect(extractQwenUsageFromLine(line, NOW)?.occurredAtMs).toBe(NOW);
  });

  it('treats unix-seconds timestamps as seconds, not milliseconds', () => {
    const seconds = Math.trunc(NOW / 1000);
    const line = JSON.stringify({ timestamp: seconds, usage: { prompt_tokens: 1 } });
    expect(extractQwenUsageFromLine(line, 0)?.occurredAtMs).toBe(seconds * 1000);
  });

  it('returns null for non-JSON, usage-less, and zero-usage lines', () => {
    expect(extractQwenUsageFromLine('plain text', NOW)).toBeNull();
    expect(extractQwenUsageFromLine(JSON.stringify({ type: 'user' }), NOW)).toBeNull();
    expect(
      extractQwenUsageFromLine(JSON.stringify({ usage: { prompt_tokens: 0 } }), NOW)
    ).toBeNull();
  });
});

describe('rollupQwenUsage', () => {
  const obs = (hoursAgo: number, tokens = 10): QwenUsageObservation => ({
    occurredAtMs: NOW - hoursAgo * HOUR_MS,
    inputTokens: tokens,
    outputTokens: 0
  });

  it('buckets observations into 5h / today / week windows', () => {
    const rollup = rollupQwenUsage(
      [obs(1), obs(4), obs(10), obs(30), obs(26 * 7) /* 7.6 days — out */],
      NOW
    );
    expect(rollup.fiveHourRequests).toBe(2);
    expect(rollup.todayRequests).toBe(3);
    expect(rollup.todayTokens).toBe(30);
    expect(rollup.weekRequests).toBe(4);
    expect(rollup.weekTokens).toBe(40);
  });

  it('ignores observations from the future', () => {
    const rollup = rollupQwenUsage([obs(-2)], NOW);
    expect(rollup.weekRequests).toBe(0);
  });
});
