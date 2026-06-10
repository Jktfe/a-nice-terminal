/**
 * ollamaLedger — append-only record of locally-observed Ollama model
 * calls (JWPK 2026-06-10, "custom usage stat for ollama models").
 *
 * Why a ledger at all: Ollama has no usage API. Token counts exist only
 * inside each response (`prompt_eval_count` / `eval_count`) or inside
 * transcripts of CLIs that ride on Ollama (pi-cli session JSONL carries
 * a `usage` object per assistant message). So the only way to chart
 * Ollama usage is to write each observation down as we see it.
 *
 * Feeds (today): piTranscriptTail calls recordLocalUsageEvent() when a
 * transcript line carries usage tokens. Future feeds (e.g. an Ollama
 * pass-through proxy) write to the same table with a different `source`.
 *
 * Reads: summarizeLocalUsage() rolls events into the today/this-week
 * aggregates the usage strip wants. Kept provider-generic (provider
 * column) so a second local-only provider never needs a second table.
 */
import { randomUUID } from 'crypto';
import { getIdentityDb } from '../db';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type LocalUsageEvent = {
  /** Provider key matching UsageProvider.providerId (e.g. 'ollama'). */
  provider: string;
  /** Model name when the feed knows it; null otherwise. */
  model?: string | null;
  /** Fresh / uncached input tokens only — cache classes go below so a
   *  cost view can price them at their distinct rates. */
  inputTokens?: number;
  outputTokens?: number;
  /** Cached-input tokens read at the cache-read rate (Claude ~10% of input). */
  cacheReadTokens?: number;
  /** Tokens written into the cache at the cache-create rate (Claude ~125%). */
  cacheCreationTokens?: number;
  /** Where the observation came from (e.g. 'pi-transcript'). */
  source: string;
  /** Override the event time (ms). Defaults to Date.now(). */
  occurredAtMs?: number;
};

export type LocalUsageSummary = {
  todayTokens: number;
  todayEvents: number;
  weekTokens: number;
  weekEvents: number;
  /** Model with the most tokens in the last 7 days, or null. */
  topModel: string | null;
  /** Most recent event time (ms), or null when the ledger is empty. */
  lastEventAtMs: number | null;
};

function asSafeCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

/** Append one observation. Zero-token events are skipped — they carry
 *  no information and would only inflate request counts from feeds that
 *  emit usage-less lines. */
export function recordLocalUsageEvent(event: LocalUsageEvent): void {
  const inputTokens = asSafeCount(event.inputTokens);
  const outputTokens = asSafeCount(event.outputTokens);
  const cacheReadTokens = asSafeCount(event.cacheReadTokens);
  const cacheCreationTokens = asSafeCount(event.cacheCreationTokens);
  // Skip truly empty events — but a fully cache-hit turn (input 0, output 0,
  // cache_read > 0) still carries real billable usage, so it must NOT be
  // dropped: count cache tokens in the empty-check.
  if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheCreationTokens === 0) return;
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO local_usage_events
       (id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, occurred_at_ms, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    event.provider,
    event.model ?? null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    event.occurredAtMs ?? Date.now(),
    event.source
  );
}

/** Roll the last 7 days of events into strip-ready aggregates. "Today"
 *  means the last 24 h (rolling) — simpler than local-midnight maths
 *  and honest about what a 24 h window is. */
export function summarizeLocalUsage(provider: string, nowMs = Date.now()): LocalUsageSummary {
  const db = getIdentityDb();
  const weekStartMs = nowMs - WEEK_MS;
  const dayStartMs = nowMs - DAY_MS;

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN occurred_at_ms >= ? THEN input_tokens + output_tokens END), 0) AS today_tokens,
         COALESCE(SUM(CASE WHEN occurred_at_ms >= ? THEN 1 END), 0) AS today_events,
         COALESCE(SUM(input_tokens + output_tokens), 0) AS week_tokens,
         COUNT(*) AS week_events,
         MAX(occurred_at_ms) AS last_event_at_ms
       FROM local_usage_events
       WHERE provider = ? AND occurred_at_ms >= ?`
    )
    .get(dayStartMs, dayStartMs, provider, weekStartMs) as {
    today_tokens: number;
    today_events: number;
    week_tokens: number;
    week_events: number;
    last_event_at_ms: number | null;
  };

  const topModelRow = db
    .prepare(
      `SELECT model, SUM(input_tokens + output_tokens) AS tokens
       FROM local_usage_events
       WHERE provider = ? AND occurred_at_ms >= ? AND model IS NOT NULL
       GROUP BY model ORDER BY tokens DESC LIMIT 1`
    )
    .get(provider, weekStartMs) as { model: string; tokens: number } | undefined;

  return {
    todayTokens: totals.today_tokens,
    todayEvents: totals.today_events,
    weekTokens: totals.week_tokens,
    weekEvents: totals.week_events,
    topModel: topModelRow?.model ?? null,
    lastEventAtMs: totals.last_event_at_ms
  };
}

/** Test helper: wipe ledger rows so each test starts clean. */
export function resetLocalUsageLedgerForTests(): void {
  getIdentityDb().prepare(`DELETE FROM local_usage_events`).run();
}
