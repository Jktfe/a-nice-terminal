/**
 * ollamaProvider — builds the 'ollama' UsageProvider for the /terminals
 * usage strip (JWPK 2026-06-10).
 *
 * Two ingredients:
 *   1. Live server status from the local Ollama HTTP API (`/api/tags`
 *      for installed models, `/api/ps` for what's loaded in memory).
 *      Ollama exposes NO usage totals, so this is status only.
 *   2. Token aggregates from the local-usage ledger (ollamaLedger),
 *      fed by transcript tails of Ollama-mediated CLIs (pi today).
 *
 * The provider is omitted entirely (null) when the server is down AND
 * the ledger saw nothing this week — an idle machine shouldn't grow a
 * dead pill on the strip.
 */
import type { UsageLine, UsageProvider } from '$lib/usage/types';
import { summarizeLocalUsage, type LocalUsageSummary } from './ollamaLedger';
import { formatTokens } from './formatTokens';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const PROBE_TIMEOUT_MS = 800;
const ONLINE_GREEN = '#22c55e';

type OllamaServerStatus = {
  reachable: boolean;
  installedModelCount: number;
  loadedModelNames: string[];
};

function ollamaBaseUrl(): string {
  const raw = process.env.OLLAMA_HOST ?? process.env.ANT_OLLAMA_URL ?? '';
  if (raw.length === 0) return DEFAULT_OLLAMA_BASE_URL;
  // OLLAMA_HOST is commonly "host:port" without a scheme.
  if (/^https?:\/\//.test(raw)) return raw.replace(/\/+$/, '');
  return `http://${raw.replace(/\/+$/, '')}`;
}

async function fetchOllamaJson(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${ollamaBaseUrl()}${path}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`ollama returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function modelNamesFrom(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const models = (raw as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const names: string[] = [];
  for (const entry of models) {
    const name = (entry as { name?: unknown })?.name;
    if (typeof name === 'string' && name.length > 0) names.push(name);
  }
  return names;
}

async function probeOllamaServer(): Promise<OllamaServerStatus> {
  try {
    const installed = modelNamesFrom(await fetchOllamaJson('/api/tags'));
    let loaded: string[] = [];
    try {
      loaded = modelNamesFrom(await fetchOllamaJson('/api/ps'));
    } catch {
      // /api/ps is newer than /api/tags; status still counts as online.
    }
    return { reachable: true, installedModelCount: installed.length, loadedModelNames: loaded };
  } catch {
    return { reachable: false, installedModelCount: 0, loadedModelNames: [] };
  }
}

function statusLine(server: OllamaServerStatus): UsageLine {
  if (!server.reachable) {
    return { type: 'text', label: 'Status', value: 'Offline', color: null, subtitle: null };
  }
  const loaded =
    server.loadedModelNames.length > 0 ? `Loaded: ${server.loadedModelNames.join(', ')}` : null;
  return {
    type: 'text',
    label: 'Status',
    value: `Online · ${server.installedModelCount} models`,
    color: ONLINE_GREEN,
    subtitle: loaded
  };
}

function tokensLine(label: string, tokens: number, events: number): UsageLine {
  return {
    type: 'text',
    label,
    value: `${formatTokens(tokens)} tokens · ${events} calls`,
    color: null,
    subtitle: null
  };
}

function ledgerLines(summary: LocalUsageSummary): UsageLine[] {
  if (summary.weekEvents === 0) {
    return [
      {
        type: 'text',
        label: 'Today',
        value: 'No observed calls yet',
        color: null,
        subtitle: 'Tokens are recorded from ANT-observed transcripts'
      }
    ];
  }
  const lines: UsageLine[] = [
    tokensLine('Today', summary.todayTokens, summary.todayEvents),
    tokensLine('Week', summary.weekTokens, summary.weekEvents)
  ];
  if (summary.topModel) {
    lines.push({
      type: 'text',
      label: 'Top model',
      value: summary.topModel,
      color: null,
      subtitle: null
    });
  }
  return lines;
}

/** Build the ollama provider, or null when there is nothing to show. */
export async function buildOllamaProvider(nowMs = Date.now()): Promise<UsageProvider | null> {
  const server = await probeOllamaServer();
  const summary = summarizeLocalUsage('ollama', nowMs);
  if (!server.reachable && summary.weekEvents === 0) return null;
  return {
    providerId: 'ollama',
    displayName: 'Ollama',
    plan: 'Local',
    lines: [statusLine(server), ...ledgerLines(summary)],
    fetchedAt: new Date(nowMs).toISOString()
  };
}
