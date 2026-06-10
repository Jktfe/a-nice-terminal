/**
 * qwenProvider — builds the 'qwen' UsageProvider for the usage strip
 * (JWPK 2026-06-10, "have usage stats work with Qwen").
 *
 * Why local-only: qwen-code has NO quota endpoint (QwenLM/qwen-code
 * issues #331 / #2800 are still open) and the Qwen OAuth free tier was
 * discontinued on 2026-04-15. What we CAN read, entirely offline:
 *
 *   ~/.qwen/settings.json          → which auth the CLI is using
 *                                    (Coding Plan / API key / OAuth)
 *   ~/.qwen/projects/** /*.jsonl   → ChatRecord session logs. The CLI's
 *                                    own Insight feature computes its
 *                                    metrics from these, so they are
 *                                    the local ground truth for request
 *                                    counts and token usage.
 *
 * The session-file shape varies across qwen-code versions, so token
 * extraction is deliberately permissive: we look for usage-ish objects
 * and accept the common key spellings (input/prompt/completion/...).
 * A line that yields tokens counts as one request.
 *
 * The Coding Plan quota is "up to 6,000 requests / 5 hours" (qwen auth
 * UI, 2026-06). We chart a rolling 5 h request count against that when
 * the Coding Plan is detected.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageLine, UsageProvider } from '$lib/usage/types';
import { formatTokens } from './formatTokens';

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const CODING_PLAN_SESSION_REQUEST_LIMIT = 6_000;
const MAX_SESSION_FILES = 200;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export type QwenAuthKind = 'coding-plan' | 'api-key' | 'qwen-oauth' | 'unknown';

export type QwenUsageObservation = {
  occurredAtMs: number;
  inputTokens: number;
  outputTokens: number;
};

export type QwenUsageRollup = {
  fiveHourRequests: number;
  todayRequests: number;
  todayTokens: number;
  weekRequests: number;
  weekTokens: number;
};

function qwenHomeDir(): string {
  return process.env.QWEN_HOME ?? join(homedir(), '.qwen');
}

/** Read which auth method qwen-code is configured with. Permissive on
 *  purpose — settings.json evolves, and a wrong guess only mislabels
 *  the plan badge, never breaks the provider. */
export function detectQwenAuthKind(settingsJsonText: string): QwenAuthKind {
  try {
    const settings = JSON.parse(settingsJsonText) as Record<string, unknown>;
    const flat = JSON.stringify(settings);
    if (flat.includes('coding.dashscope') || flat.includes('BAILIAN_CODING_PLAN')) {
      return 'coding-plan';
    }
    const security = settings.security as { auth?: { selectedType?: string } } | undefined;
    const selected = security?.auth?.selectedType ?? (settings.selectedAuthType as string | undefined);
    if (selected === 'qwen-oauth') return 'qwen-oauth';
    if (typeof selected === 'string' && selected.length > 0) return 'api-key';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function numberish(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const n = numberish(record[key]);
    if (n > 0) return n;
  }
  return 0;
}

function usageObjectFrom(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const candidates = [
    parsed.usage,
    (parsed.message as Record<string, unknown> | undefined)?.usage,
    (parsed.response as Record<string, unknown> | undefined)?.usage,
    (parsed.metadata as Record<string, unknown> | undefined)?.usage,
    // qwen-code is a gemini-cli fork: real session lines carry the API's
    // token report top-level under `usageMetadata` (promptTokenCount /
    // candidatesTokenCount / totalTokenCount), NOT a `usage` object. This is
    // the authoritative one-per-response source. We deliberately do NOT also
    // read `systemPayload.uiEvent.*_token_count`: it is higher-frequency UI
    // telemetry on disjoint lines, so counting both would inflate requests.
    parsed.usageMetadata
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') return candidate as Record<string, unknown>;
  }
  return null;
}

function timestampMsFrom(parsed: Record<string, unknown>, fallbackMs: number): number {
  const candidates = [parsed.timestamp, parsed.ts, parsed.time, parsed.created, parsed.createdAt];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      // Heuristic: seconds vs milliseconds.
      return candidate > 10_000_000_000 ? candidate : candidate * 1000;
    }
    if (typeof candidate === 'string') {
      const ms = Date.parse(candidate);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return fallbackMs;
}

/** Pull one usage observation out of a session JSONL line, or null
 *  when the line carries no token evidence. */
export function extractQwenUsageFromLine(
  rawLine: string,
  fallbackTimestampMs: number
): QwenUsageObservation | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0 || trimmed[0] !== '{') return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const usage = usageObjectFrom(parsed);
  if (!usage) return null;
  const inputTokens = firstNumber(usage, [
    'input', 'inputTokens', 'input_tokens', 'prompt_tokens', 'promptTokens', 'promptTokenCount'
  ]);
  const outputTokens = firstNumber(usage, [
    'output', 'outputTokens', 'output_tokens', 'completion_tokens', 'completionTokens',
    'candidatesTokenCount'
  ]);
  let totalOnly = 0;
  if (inputTokens === 0 && outputTokens === 0) {
    totalOnly = firstNumber(usage, ['totalTokens', 'total_tokens', 'total', 'totalTokenCount']);
    if (totalOnly === 0) return null;
  }
  return {
    occurredAtMs: timestampMsFrom(parsed, fallbackTimestampMs),
    inputTokens: inputTokens > 0 ? inputTokens : totalOnly,
    outputTokens
  };
}

/** Roll observations into the windowed counts the lines need. */
export function rollupQwenUsage(
  observations: readonly QwenUsageObservation[],
  nowMs: number
): QwenUsageRollup {
  const rollup: QwenUsageRollup = {
    fiveHourRequests: 0, todayRequests: 0, todayTokens: 0, weekRequests: 0, weekTokens: 0
  };
  for (const obs of observations) {
    if (obs.occurredAtMs > nowMs || obs.occurredAtMs < nowMs - WEEK_MS) continue;
    const tokens = obs.inputTokens + obs.outputTokens;
    rollup.weekRequests += 1;
    rollup.weekTokens += tokens;
    if (obs.occurredAtMs >= nowMs - DAY_MS) {
      rollup.todayRequests += 1;
      rollup.todayTokens += tokens;
    }
    if (obs.occurredAtMs >= nowMs - FIVE_HOURS_MS) rollup.fiveHourRequests += 1;
  }
  return rollup;
}

/** List recent session JSONL files under ~/.qwen/projects, bounded so
 *  a giant history can't stall the strip. Newest-modified first. */
function listRecentSessionFiles(projectsDir: string, nowMs: number): string[] {
  const found: Array<{ path: string; mtimeMs: number }> = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || found.length >= MAX_SESSION_FILES * 2) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.endsWith('.jsonl') && nowMs - stats.mtimeMs <= WEEK_MS + DAY_MS) {
        found.push({ path: fullPath, mtimeMs: stats.mtimeMs });
      }
    }
  };
  walk(projectsDir, 0);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, MAX_SESSION_FILES).map((f) => f.path);
}

function readObservationsFromDisk(nowMs: number): QwenUsageObservation[] {
  const projectsDir = join(qwenHomeDir(), 'projects');
  if (!existsSync(projectsDir)) return [];
  const observations: QwenUsageObservation[] = [];
  let bytesRead = 0;
  for (const filePath of listRecentSessionFiles(projectsDir, nowMs)) {
    let text: string;
    let fileMtimeMs = nowMs;
    try {
      const stats = statSync(filePath);
      if (bytesRead + stats.size > MAX_TOTAL_BYTES) break;
      bytesRead += stats.size;
      fileMtimeMs = stats.mtimeMs;
      text = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const obs = extractQwenUsageFromLine(line, fileMtimeMs);
      if (obs) observations.push(obs);
    }
  }
  return observations;
}

function planLabelFor(auth: QwenAuthKind): string | null {
  switch (auth) {
    case 'coding-plan': return 'Coding Plan';
    case 'api-key': return 'API key';
    case 'qwen-oauth': return 'OAuth (discontinued)';
    default: return null;
  }
}

function qwenLines(auth: QwenAuthKind, rollup: QwenUsageRollup): UsageLine[] {
  const lines: UsageLine[] = [];
  if (auth === 'coding-plan') {
    lines.push({
      type: 'progress',
      label: 'Session (5h)',
      used: rollup.fiveHourRequests,
      limit: CODING_PLAN_SESSION_REQUEST_LIMIT,
      format: { kind: 'count', suffix: 'requests' },
      resetsAt: null, // rolling window — there is no fixed reset moment
      periodDurationMs: FIVE_HOURS_MS,
      color: null
    });
  } else {
    lines.push({
      type: 'text',
      label: 'Last 5h',
      value: `${rollup.fiveHourRequests} requests`,
      color: null,
      subtitle: null
    });
  }
  lines.push({
    type: 'text',
    label: 'Today',
    value: `${rollup.todayRequests} requests · ${formatTokens(rollup.todayTokens)} tokens`,
    color: null,
    subtitle: null
  });
  lines.push({
    type: 'text',
    label: 'Week',
    value: `${rollup.weekRequests} requests · ${formatTokens(rollup.weekTokens)} tokens`,
    color: null,
    subtitle: 'Counted from local session logs under ~/.qwen'
  });
  return lines;
}

/** Build the qwen provider, or null when qwen-code isn't installed
 *  (no ~/.qwen directory → nothing to show, hide cleanly). */
export function buildQwenProvider(nowMs = Date.now()): UsageProvider | null {
  const home = qwenHomeDir();
  if (!existsSync(home)) return null;

  let auth: QwenAuthKind = 'unknown';
  try {
    auth = detectQwenAuthKind(readFileSync(join(home, 'settings.json'), 'utf8'));
  } catch {
    // Missing/unreadable settings only costs us the plan badge.
  }

  const rollup = rollupQwenUsage(readObservationsFromDisk(nowMs), nowMs);
  return {
    providerId: 'qwen',
    displayName: 'Qwen Code',
    plan: planLabelFor(auth),
    lines: qwenLines(auth, rollup),
    fetchedAt: new Date(nowMs).toISOString()
  };
}
