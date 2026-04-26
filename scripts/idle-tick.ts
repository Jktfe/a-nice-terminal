#!/usr/bin/env bun
/**
 * ANT idle-tick loop
 *
 * Zero-LLM-token background polling script that keeps the mempalace warm.
 * Runs every ~60 seconds as a launchd agent, a systemd service, or just a
 * detached `bun run idle-tick &` background process.
 *
 * What it does per tick (all against the existing HTTP surface — no
 * direct DB access, no PTY daemon hooks):
 *
 *   1. GET /api/sessions — list active terminal sessions.
 *   2. For each terminal, GET /api/sessions/:id/terminal/history?since=2m
 *      and compute a content hash. If the hash changed since last tick,
 *      the session is "active" (idle_for_ms = 0). Otherwise idle_for_ms
 *      increments by the tick interval.
 *   3. Upsert heartbeat/terminals/:id with the result. Cost per tick:
 *      one PUT per active terminal.
 *   4. Scan tasks/ via /api/memories/prefix. Any row with status=doing and
 *      updated_at older than STALLED_MS is moved to status=blocked with
 *      block_reason="stalled (Nm)". No chat posting — the block state
 *      surfaces on the next agent wake read.
 *   5. Periodically run /api/memories/audit and upsert
 *      heartbeat/memories/latest so memory hygiene drift is visible without
 *      waking an LLM.
 *   6. Upsert heartbeat/latest with a consolidated summary: tick number,
 *      active-terminal count, and the per-terminal idle_for_ms values.
 *      Agents read this one row on wake as a cheap "has anything happened"
 *      probe before deciding to drill into heartbeat/terminals/*.
 *
 * What it deliberately does NOT do:
 *
 *   - Wake any LLM. Period. That's the entire point.
 *   - Parse raw ANSI. terminal/history returns stripped text by default.
 *   - Maintain state across restarts. Heartbeat is always "what we see now";
 *     a restart just means the next tick re-observes all terminals and
 *     writes fresh rows. The in-memory lastChange map below is an
 *     optimisation, not persistence.
 *   - Compile digests. That's a librarian agent's job; the script just
 *     keeps the raw material fresh.
 *
 * Environment:
 *   ANT_SERVER_URL     default https://localhost:6458
 *   ANT_API_KEY        optional bearer token
 *   ANT_IDLE_TICK_MS   default 60000 (60 seconds)
 *   ANT_STALLED_MS     default 900000 (15 minutes)
 *   ANT_MEMORY_AUDIT_TICKS default 60 (roughly hourly at the default tick)
 *
 * See docs/multi-agent-protocol.md and docs/mempalace-schema.md for the
 * agent-side contract this script supports.
 */

import { createHash } from 'node:crypto';

const SERVER_URL = (process.env.ANT_SERVER_URL || `https://localhost:${process.env.ANT_PORT || '6458'}`).replace(/\/$/, '');
const API_KEY    = process.env.ANT_API_KEY || '';
const TICK_MS    = parseInt(process.env.ANT_IDLE_TICK_MS || '60000', 10);
const STALLED_MS = parseInt(process.env.ANT_STALLED_MS || '900000', 10);
const MEMORY_AUDIT_TICKS = parseInt(process.env.ANT_MEMORY_AUDIT_TICKS || '60', 10);

const MAX_CONSECUTIVE_ERRORS = 20;

type HeartbeatTerminal = {
  session_id: string;
  name: string;
  hash: string;
  last_change_ms: number;
  idle_for_ms: number;
  last_tick_ms: number;
  latest_row_ms: number;
};

type Session = { id: string; type: string; name: string };

type MemoryRow = { key: string; value: string; updated_at: string };

// In-memory state — optional optimisation so we don't have to re-read our
// own last heartbeat rows on every tick. Not persistence: a restart just
// causes the next tick to treat every terminal as "first sighting" and
// write fresh rows, which is fine.
const state = {
  terminals: new Map<string, HeartbeatTerminal>(),
  tickCount: 0,
  consecutiveErrors: 0,
  running: true,
};

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['Authorization'] = 'Bearer ' + API_KEY;
  return h;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(SERVER_URL + path, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
    // @ts-ignore Bun accepts this for self-signed cert dev servers
    tls: { rejectUnauthorized: false },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

async function listSessions(): Promise<Session[]> {
  // /api/sessions returns an array of session rows
  return request<Session[]>('GET', '/api/sessions');
}

async function getTerminalHistory(id: string, since: string, limit = 50): Promise<Array<{ ts_ms: number; text: string }>> {
  const result = await request<{ rows: Array<{ ts_ms: number; text: string }> }>(
    'GET',
    `/api/sessions/${encodeURIComponent(id)}/terminal/history?since=${encodeURIComponent(since)}&limit=${limit}`
  );
  return result.rows ?? [];
}

async function listMemoriesByPrefix(prefix: string, limit = 500): Promise<MemoryRow[]> {
  const result = await request<{ rows: MemoryRow[] }>(
    'GET',
    `/api/memories/prefix?prefix=${encodeURIComponent(prefix)}&limit=${limit}`
  );
  return result.rows ?? [];
}

async function putMemory(key: string, value: unknown): Promise<void> {
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
  await request<unknown>('PUT', `/api/memories/key/${encodeURIComponent(key)}`, { value: stringValue });
}

async function getMemoryAudit(): Promise<unknown> {
  return request<unknown>('GET', '/api/memories/audit');
}

// ─── Logic ───────────────────────────────────────────────────────────────────

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

async function updateTerminalHeartbeats(sessions: Session[]): Promise<void> {
  const now = Date.now();
  const terminals = sessions.filter(s => s.type === 'terminal');
  const alive = new Set(terminals.map(t => t.id));

  for (const term of terminals) {
    try {
      const rows = await getTerminalHistory(term.id, '2m', 50);
      // history rows come back newest-first; reverse for stable concat order
      const ordered = [...rows].reverse();
      const concat = ordered.map(r => r.text ?? '').join('');
      const hash = concat ? hashText(concat) : 'empty';
      const latestRowMs = ordered.length ? Math.max(...ordered.map(r => r.ts_ms ?? 0)) : 0;

      const prev = state.terminals.get(term.id);
      const changed = !prev || prev.hash !== hash;
      const lastChangeMs = changed ? now : (prev?.last_change_ms ?? now);

      const heartbeat: HeartbeatTerminal = {
        session_id: term.id,
        name: term.name,
        hash,
        last_change_ms: lastChangeMs,
        idle_for_ms: now - lastChangeMs,
        last_tick_ms: now,
        latest_row_ms: latestRowMs,
      };
      state.terminals.set(term.id, heartbeat);
      await putMemory(`heartbeat/terminals/${term.id}`, heartbeat);
    } catch (e) {
      console.error(`[idle-tick] terminal ${term.id}: ${errMsg(e)}`);
    }
  }

  // Drop heartbeat state for terminals that disappeared between ticks so
  // a dead session doesn't keep accreting idle_for_ms forever.
  for (const id of [...state.terminals.keys()]) {
    if (!alive.has(id)) state.terminals.delete(id);
  }
}

async function detectStalledTasks(): Promise<number> {
  const now = Date.now();
  const rows = await listMemoriesByPrefix('tasks/');
  let stalled = 0;

  for (const row of rows) {
    let parsed: any;
    try { parsed = JSON.parse(row.value); } catch { continue; }
    if (parsed?.status !== 'doing') continue;

    const updatedMs = Date.parse(row.updated_at);
    if (isNaN(updatedMs)) continue;
    if (now - updatedMs < STALLED_MS) continue;

    const minutesStalled = Math.round((now - updatedMs) / 60_000);
    const patched = {
      ...parsed,
      status: 'blocked',
      block_reason: `stalled (no update for ${minutesStalled}m)`,
      stalled_at: new Date(now).toISOString(),
    };

    try {
      await putMemory(row.key, patched);
      stalled++;
    } catch (e) {
      console.error(`[idle-tick] patch ${row.key}: ${errMsg(e)}`);
    }
  }

  return stalled;
}

async function writeLatestSummary(): Promise<void> {
  const now = Date.now();
  const summary = {
    tick: state.tickCount,
    ts_ms: now,
    tick_interval_ms: TICK_MS,
    terminal_count: state.terminals.size,
    active_terminals: [...state.terminals.values()].filter(t => t.idle_for_ms < TICK_MS * 2).length,
    terminals: [...state.terminals.values()].map(t => ({
      id: t.session_id,
      name: t.name,
      idle_for_ms: t.idle_for_ms,
      hash: t.hash,
    })),
  };
  await putMemory('heartbeat/latest', summary);
}

async function writeMemoryAuditSummary(): Promise<void> {
  if (!MEMORY_AUDIT_TICKS || MEMORY_AUDIT_TICKS < 1) return;
  if (state.tickCount % MEMORY_AUDIT_TICKS !== 0) return;

  const report = await getMemoryAudit();
  await putMemory('heartbeat/memories/latest', report);
}

async function tick(): Promise<void> {
  state.tickCount++;

  const sessions = await listSessions();
  await updateTerminalHeartbeats(sessions);

  // Stalled-task scan is best-effort; a failure shouldn't stop the tick.
  let stalled = 0;
  try {
    stalled = await detectStalledTasks();
  } catch (e) {
    console.error(`[idle-tick] stalled scan: ${errMsg(e)}`);
  }

  try {
    await writeMemoryAuditSummary();
  } catch (e) {
    console.error(`[idle-tick] memory audit: ${errMsg(e)}`);
  }

  try {
    await writeLatestSummary();
  } catch (e) {
    console.error(`[idle-tick] heartbeat/latest: ${errMsg(e)}`);
  }

  const active = [...state.terminals.values()].filter(t => t.idle_for_ms < TICK_MS * 2).length;
  const noise = stalled > 0 ? ` stalled=${stalled}` : '';
  console.error(`[idle-tick] tick=${state.tickCount} terminals=${state.terminals.size} active=${active}${noise}`);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── Main loop ───────────────────────────────────────────────────────────────

async function loop(): Promise<void> {
  console.error(
    `[idle-tick] starting; server=${SERVER_URL} tick=${TICK_MS}ms stalled_after=${STALLED_MS}ms`
  );

  while (state.running) {
    const start = Date.now();
    try {
      await tick();
      state.consecutiveErrors = 0;
    } catch (e) {
      state.consecutiveErrors++;
      console.error(`[idle-tick] tick ${state.tickCount} failed: ${errMsg(e)}`);
      if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`[idle-tick] ${MAX_CONSECUTIVE_ERRORS} consecutive errors — giving up`);
        process.exit(1);
      }
    }
    if (!state.running) break;
    const elapsed = Date.now() - start;
    const delay = Math.max(100, TICK_MS - elapsed);
    await new Promise(r => setTimeout(r, delay));
  }

  console.error('[idle-tick] stopped');
}

process.on('SIGINT',  () => { state.running = false; });
process.on('SIGTERM', () => { state.running = false; });

loop().catch(e => {
  console.error(`[idle-tick] fatal: ${errMsg(e)}`);
  process.exit(1);
});
