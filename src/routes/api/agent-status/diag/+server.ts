import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import getDb from '$lib/server/db.js';
import { assertNotRoomScoped } from '$lib/server/room-scope.js';

const DRIVER_CLIS = [
  'claude-code',
  'codex-cli',
  'gemini-cli',
  'qwen-cli',
  'copilot-cli',
  'pi',
] as const;

type DriverCli = (typeof DRIVER_CLIS)[number];
type StateLabelSource = 'file' | 'classifier' | 'regex' | 'none';

const SOURCE_KEYS: StateLabelSource[] = ['file', 'classifier', 'regex', 'none'];
const DRIVER_SET = new Set<string>(DRIVER_CLIS);
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const FRESH_MS = 30_000;

type StatusRow = {
  id: number | string;
  session_id: string;
  ts_ms: number;
  payload: string;
  meta: string | null;
};

function emptyCounts(): Record<StateLabelSource, number> {
  return { file: 0, classifier: 0, regex: 0, none: 0 };
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeCli(value: unknown): DriverCli | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const normalized = value === 'copilot'
    ? 'copilot-cli'
    : value === 'qwen'
    ? 'qwen-cli'
    : value;
  return DRIVER_SET.has(normalized) ? normalized as DriverCli : null;
}

function sessionCli(meta: string | null): DriverCli | null {
  const parsed = parseJsonObject(meta);
  return normalizeCli(parsed?.agent_driver);
}

function hasStateFileEvidence(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.stateFileMtimeMs === 'number' ||
    typeof payload.cwd === 'string' ||
    typeof payload.permissionMode === 'string' ||
    typeof payload.remoteControlActive === 'boolean' ||
    typeof payload.sessionStartedAt === 'number'
  );
}

function explicitSource(payload: Record<string, unknown>): StateLabelSource | null {
  const source = payload.stateLabelSource ?? payload.state_label_source;
  return SOURCE_KEYS.includes(source as StateLabelSource)
    ? source as StateLabelSource
    : null;
}

function inferStateLabelSource(
  cli: DriverCli,
  payload: Record<string, unknown>,
): StateLabelSource {
  if (!payload.stateLabel) return 'none';
  const explicit = explicitSource(payload);
  if (explicit) return explicit;
  if (hasStateFileEvidence(payload)) return 'file';
  if (cli === 'claude-code') return 'regex';
  return payload.stateLabel === 'Response needed' || payload.stateLabel === 'Waiting'
    ? 'classifier'
    : 'regex';
}

function parseWindowMs(url: URL): number {
  const raw = Number(url.searchParams.get('window_ms') ?? '');
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WINDOW_MS;
  return Math.min(Math.floor(raw), MAX_WINDOW_MS);
}

function stateRoot(): string {
  return join(process.env.HOME || homedir(), '.ant', 'state');
}

function newestStateFile(cli: DriverCli, now: number) {
  const dir = join(stateRoot(), cli);
  if (!existsSync(dir)) {
    return {
      exists: false,
      latestMtimeMs: null,
      ageMs: null,
      fresh: false,
      file: null,
    };
  }

  let newest: { name: string; mtimeMs: number } | null = null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const stat = statSync(join(dir, name));
      if (!stat.isFile()) continue;
      const mtimeMs = stat.mtimeMs;
      if (!newest || mtimeMs > newest.mtimeMs) newest = { name, mtimeMs };
    } catch {
      continue;
    }
  }

  if (!newest) {
    return {
      exists: false,
      latestMtimeMs: null,
      ageMs: null,
      fresh: false,
      file: null,
    };
  }

  const ageMs = Math.max(0, now - newest.mtimeMs);
  return {
    exists: true,
    latestMtimeMs: newest.mtimeMs,
    ageMs,
    fresh: ageMs < FRESH_MS,
    file: `~/.ant/state/${cli}/${newest.name}`,
  };
}

export async function GET(event: RequestEvent) {
  assertNotRoomScoped(event);

  const now = Date.now();
  const windowMs = parseWindowMs(event.url);
  const sinceMs = now - windowMs;
  const byCli = new Map<DriverCli, {
    cli: DriverCli;
    statusEvents: number;
    stateLabelSources: Record<StateLabelSource, number>;
    newestStateFile: ReturnType<typeof newestStateFile>;
  }>();

  for (const cli of DRIVER_CLIS) {
    byCli.set(cli, {
      cli,
      statusEvents: 0,
      stateLabelSources: emptyCounts(),
      newestStateFile: newestStateFile(cli, now),
    });
  }

  const rows = getDb().prepare(`
    SELECT r.id, r.session_id, r.ts_ms, r.payload, s.meta
    FROM run_events r
    LEFT JOIN sessions s ON s.id = r.session_id
    WHERE r.kind = 'status'
      AND r.ts_ms >= ?
    ORDER BY r.ts_ms DESC, r.id DESC
  `).all(sinceMs) as StatusRow[];

  const ignored = { unknownDriver: 0, invalidPayload: 0 };
  for (const row of rows) {
    const cli = sessionCli(row.meta);
    if (!cli) {
      ignored.unknownDriver += 1;
      continue;
    }
    const payload = parseJsonObject(row.payload);
    if (!payload) {
      ignored.invalidPayload += 1;
      continue;
    }
    const summary = byCli.get(cli);
    if (!summary) continue;
    const source = inferStateLabelSource(cli, payload);
    summary.statusEvents += 1;
    summary.stateLabelSources[source] += 1;
  }

  return json({
    generatedAt: new Date(now).toISOString(),
    windowMs,
    sinceMs,
    drivers: DRIVER_CLIS.map((cli) => byCli.get(cli)),
    ignored,
  });
}
