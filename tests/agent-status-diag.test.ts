import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import getDb, { queries } from '../src/lib/server/db.js';
import { GET as getDiag } from '../src/routes/api/agent-status/diag/+server';

const TEST_PREFIX = 'diag-status-test-';

function makeEvent(
  url = 'http://localhost/api/agent-status/diag',
  locals: Record<string, unknown> = {},
) {
  const parsed = new URL(url);
  return {
    request: new Request(parsed),
    url: parsed,
    locals,
    params: {},
  } as any;
}

function seedSession(id: string, driver: string) {
  getDb().prepare(`
    INSERT OR REPLACE INTO sessions (id, name, type, meta)
    VALUES (?, ?, 'terminal', ?)
  `).run(id, id, JSON.stringify({ agent_driver: driver }));
}

function seedStatus(sessionId: string, payload: Record<string, unknown>, tsMs = Date.now()) {
  queries.appendRunEvent(
    sessionId,
    tsMs,
    'status',
    'medium',
    'status',
    String(payload.state ?? 'status'),
    JSON.stringify(payload),
    null,
  );
}

function driver(body: any, cli: string) {
  return body.drivers.find((d: any) => d.cli === cli);
}

afterEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM run_events WHERE session_id LIKE ?').run(`${TEST_PREFIX}%`);
  db.prepare('DELETE FROM sessions WHERE id LIKE ?').run(`${TEST_PREFIX}%`);
});

describe('/api/agent-status/diag', () => {
  it('rejects room-scoped callers because diagnostics span all rooms', async () => {
    try {
      await getDiag(makeEvent('http://localhost/api/agent-status/diag', {
        roomScope: { roomId: 'room-1', kind: 'cli' },
      }));
      throw new Error('expected room-scoped request to fail');
    } catch (err: any) {
      expect(err?.status ?? err?.body?.status).toBe(403);
    }
  });

  it('returns all driver buckets, stateLabel source counts, and state-file freshness', async () => {
    const originalHome = process.env.HOME;
    const homeDir = mkdtempSync(join(tmpdir(), 'ant-diag-state-test-'));
    try {
      process.env.HOME = homeDir;
      const now = Date.now();

      seedSession(`${TEST_PREFIX}claude`, 'claude-code');
      seedSession(`${TEST_PREFIX}codex`, 'codex-cli');
      seedSession(`${TEST_PREFIX}gemini`, 'gemini-cli');
      seedSession(`${TEST_PREFIX}qwen`, 'qwen-cli');

      seedStatus(`${TEST_PREFIX}claude`, {
        state: 'thinking',
        stateLabel: 'Menu',
        model: 'Opus 4.7',
      }, now - 1_000);
      seedStatus(`${TEST_PREFIX}codex`, {
        state: 'busy',
        stateLabel: 'Working',
        stateFileMtimeMs: now - 2_000,
        cwd: '/repo/codex',
      }, now - 2_000);
      seedStatus(`${TEST_PREFIX}gemini`, {
        state: 'idle',
        stateLabel: 'Waiting',
        model: 'Gemini',
      }, now - 3_000);
      seedStatus(`${TEST_PREFIX}qwen`, {
        state: 'ready',
        model: 'qwen3',
      }, now - 4_000);
      seedStatus(`${TEST_PREFIX}qwen`, {
        state: 'busy',
        stateLabel: 'Working',
        stateFileMtimeMs: now - 2 * 60 * 60 * 1000,
      }, now - 2 * 60 * 60 * 1000);

      const freshDir = join(homeDir, '.ant', 'state', 'codex-cli');
      mkdirSync(freshDir, { recursive: true });
      writeFileSync(join(freshDir, 'fresh.json'), '{}');

      const staleDir = join(homeDir, '.ant', 'state', 'gemini-cli');
      mkdirSync(staleDir, { recursive: true });
      const staleFile = join(staleDir, 'stale.json');
      writeFileSync(staleFile, '{}');
      const staleDate = new Date(now - 45_000);
      utimesSync(staleFile, staleDate, staleDate);

      const res = await getDiag(makeEvent());
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.windowMs).toBe(60 * 60 * 1000);
      expect(body.drivers.map((d: any) => d.cli)).toEqual([
        'claude-code',
        'codex-cli',
        'gemini-cli',
        'qwen-cli',
        'copilot-cli',
        'pi',
      ]);

      expect(driver(body, 'claude-code').stateLabelSources).toMatchObject({ regex: 1 });
      expect(driver(body, 'codex-cli').stateLabelSources).toMatchObject({ file: 1 });
      expect(driver(body, 'gemini-cli').stateLabelSources).toMatchObject({ classifier: 1 });
      expect(driver(body, 'qwen-cli').stateLabelSources).toMatchObject({ none: 1 });
      expect(driver(body, 'qwen-cli').statusEvents).toBe(1);
      expect(driver(body, 'copilot-cli').statusEvents).toBe(0);
      expect(driver(body, 'pi').statusEvents).toBe(0);

      expect(driver(body, 'codex-cli').newestStateFile).toMatchObject({
        exists: true,
        fresh: true,
        file: '~/.ant/state/codex-cli/fresh.json',
      });
      expect(driver(body, 'gemini-cli').newestStateFile).toMatchObject({
        exists: true,
        fresh: false,
        file: '~/.ant/state/gemini-cli/stale.json',
      });
      expect(driver(body, 'pi').newestStateFile).toMatchObject({
        exists: false,
        latestMtimeMs: null,
      });
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
