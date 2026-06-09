/**
 * ant brief CLI tests — disposable per-terminal working-memory lane.
 *
 * Mirrors scripts/ant-cli-memory.test.mjs: mocks fetch + scopes all writes
 * to a per-test scratch HOME so the user's real ~/.ant is never touched.
 * The whoami round-trip is mocked via fetchImpl so we can drive terminalId
 * resolution (server-minted) and the offline fallback paths deterministically.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleBriefVerb } from './ant-cli-brief.mjs';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

class CliInputError extends Error {}

let scratchHome = '';
let originalHome;

beforeEach(() => {
  scratchHome = mkdtempSync(join(tmpdir(), 'ant-brief-home-'));
  originalHome = process.env.HOME;
  process.env.HOME = scratchHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (scratchHome && existsSync(scratchHome)) rmSync(scratchHome, { recursive: true, force: true });
});

function makeJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Runtime whose fetchImpl answers /api/identity/whoami with a bound payload
 * carrying `terminalId`. Pass terminalId=null to simulate "server returned no
 * id" and reachable=false to simulate an unreachable server (throws).
 */
function makeRuntime({ terminalId = 't_test', handle = '@tester', reachable = true } = {}) {
  const captured = { stdout: [], stderr: [] };
  const runtime = {
    serverUrl: 'http://test.local',
    config: {},
    home: scratchHome,
    writeOut: (line) => captured.stdout.push(String(line)),
    writeErr: (line) => captured.stderr.push(String(line)),
    fetchImpl: async () => {
      if (!reachable) throw new Error('ECONNREFUSED');
      return makeJsonResponse({ status: 'bound', handle, terminalId });
    }
  };
  return { runtime, captured };
}

function scratchDir(terminalId) {
  return join(scratchHome, '.ant', 'scratch', terminalId);
}

describe('ant brief CLI', () => {
  it('write creates ~/.ant/scratch/<id>/brief.json with the typed schema', async () => {
    const { runtime } = makeRuntime({ terminalId: 't_alpha' });
    const code = await handleBriefVerb(
      'write',
      ['--task', 'ship brief', '--next', 'run tests', '--fact', 'tests green', '--loop', 'wire dispatch', '--file', 'scripts/ant-cli-brief.mjs', '--plan', 'plan_1', '--room', 'room-a', '--mem', 'mem_x', '--kg', 'ent_y'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    const path = join(scratchDir('t_alpha'), 'brief.json');
    expect(existsSync(path)).toBe(true);
    const brief = JSON.parse(readFileSync(path, 'utf-8'));
    expect(brief.schema).toBe('ant-brief/1');
    expect(brief.terminalId).toBe('t_alpha');
    expect(brief.handle).toBe('@tester');
    expect(typeof brief.writtenAt).toBe('string');
    expect(brief.task).toBe('ship brief');
    expect(brief.nextAction).toBe('run tests');
    expect(brief.lastVerifiedFact).toBe('tests green');
    expect(brief.openLoops).toEqual(['wire dispatch']);
    expect(brief.changedFiles).toEqual(['scripts/ant-cli-brief.mjs']);
    expect(brief.pointers).toEqual({ planID: 'plan_1', roomIDs: ['room-a'], memIDs: ['mem_x'], kgEntities: ['ent_y'] });
  });

  it('repeatable --loop/--file/--room/--mem/--kg accumulate', async () => {
    const { runtime } = makeRuntime({ terminalId: 't_rep' });
    await handleBriefVerb(
      'write',
      ['--loop', 'a', '--loop', 'b', '--file', 'f1', '--file', 'f2', '--room', 'r1', '--room', 'r2', '--mem', 'm1', '--kg', 'k1', '--kg', 'k2'],
      runtime,
      { CliInputError }
    );
    const brief = JSON.parse(readFileSync(join(scratchDir('t_rep'), 'brief.json'), 'utf-8'));
    expect(brief.openLoops).toEqual(['a', 'b']);
    expect(brief.changedFiles).toEqual(['f1', 'f2']);
    expect(brief.pointers.roomIDs).toEqual(['r1', 'r2']);
    expect(brief.pointers.memIDs).toEqual(['m1']);
    expect(brief.pointers.kgEntities).toEqual(['k1', 'k2']);
  });

  it('read prints the brief and returns 0 when one exists', async () => {
    const { runtime, captured } = makeRuntime({ terminalId: 't_read' });
    await handleBriefVerb('write', ['--task', 'do thing', '--next', 'next thing'], runtime, { CliInputError });
    captured.stdout.length = 0;
    const code = await handleBriefVerb('read', [], runtime, { CliInputError });
    expect(code).toBe(0);
    const out = captured.stdout.join('\n');
    expect(out).toContain('do thing');
    expect(out).toContain('next thing');
  });

  it('read --json emits the raw brief JSON', async () => {
    const { runtime, captured } = makeRuntime({ terminalId: 't_json' });
    await handleBriefVerb('write', ['--task', 'json task'], runtime, { CliInputError });
    captured.stdout.length = 0;
    const code = await handleBriefVerb('read', ['--json'], runtime, { CliInputError });
    expect(code).toBe(0);
    const payload = JSON.parse(captured.stdout[0]);
    expect(payload.schema).toBe('ant-brief/1');
    expect(payload.task).toBe('json task');
  });

  it('read returns 1 when no brief exists anywhere', async () => {
    const { runtime, captured } = makeRuntime({ terminalId: 't_empty' });
    const code = await handleBriefVerb('read', [], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stdout.join('\n')).toContain('no brief');
  });

  it('read --json returns { brief: null } and exit 1 when none', async () => {
    const { runtime, captured } = makeRuntime({ terminalId: 't_none' });
    const code = await handleBriefVerb('read', ['--json'], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(JSON.parse(captured.stdout[0])).toEqual({ brief: null });
  });

  it('clear removes the brief and its .prev', async () => {
    const { runtime } = makeRuntime({ terminalId: 't_clear' });
    await handleBriefVerb('write', ['--task', 'one'], runtime, { CliInputError });
    await handleBriefVerb('write', ['--task', 'two'], runtime, { CliInputError }); // creates brief.prev.json
    const path = join(scratchDir('t_clear'), 'brief.json');
    const prev = join(scratchDir('t_clear'), 'brief.prev.json');
    expect(existsSync(path)).toBe(true);
    expect(existsSync(prev)).toBe(true);
    const code = await handleBriefVerb('clear', [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(prev)).toBe(false);
  });

  it('clear returns 1 when there is nothing to clear', async () => {
    const { runtime } = makeRuntime({ terminalId: 't_clear_empty' });
    const code = await handleBriefVerb('clear', [], runtime, { CliInputError });
    expect(code).toBe(1);
  });

  it('write --stdin parses a full JSON brief from stdin', async () => {
    const { runtime } = makeRuntime({ terminalId: 't_stdin' });
    const incoming = {
      task: 'stdin task',
      openLoops: ['loop1', 'loop2'],
      changedFiles: ['a.ts'],
      lastVerifiedFact: 'fact!',
      nextAction: 'do next',
      pointers: { planID: 'plan_z', roomIDs: ['rZ'], memIDs: ['mZ'], kgEntities: ['kZ'] }
    };
    runtime.readStdin = () => JSON.stringify(incoming);
    const code = await handleBriefVerb('write', ['--stdin'], runtime, { CliInputError });
    expect(code).toBe(0);
    const brief = JSON.parse(readFileSync(join(scratchDir('t_stdin'), 'brief.json'), 'utf-8'));
    expect(brief.schema).toBe('ant-brief/1');
    expect(brief.terminalId).toBe('t_stdin');
    expect(brief.task).toBe('stdin task');
    expect(brief.openLoops).toEqual(['loop1', 'loop2']);
    expect(brief.changedFiles).toEqual(['a.ts']);
    expect(brief.lastVerifiedFact).toBe('fact!');
    expect(brief.nextAction).toBe('do next');
    expect(brief.pointers).toEqual({ planID: 'plan_z', roomIDs: ['rZ'], memIDs: ['mZ'], kgEntities: ['kZ'] });
  });

  it('write --stdin rejects invalid JSON', async () => {
    const { runtime } = makeRuntime({ terminalId: 't_badjson' });
    runtime.readStdin = () => '{not json';
    await expect(handleBriefVerb('write', ['--stdin'], runtime, { CliInputError })).rejects.toThrow(/invalid JSON/);
  });

  it('offline / no server id falls back to a stable pid-* key and does NOT write a //double-slash path', async () => {
    const { runtime } = makeRuntime({ terminalId: null, reachable: false });
    const code = await handleBriefVerb('write', ['--task', 'offline'], runtime, { CliInputError });
    expect(code).toBe(0);
    const root = join(scratchHome, '.ant', 'scratch');
    const dirs = readdirSync(root);
    // exactly one scratch dir, and it is a pid-derived key (never empty)
    expect(dirs.length).toBe(1);
    expect(dirs[0].startsWith('pid-')).toBe(true);
    expect(dirs[0].length).toBeGreaterThan(4);
    // no empty-key directory was created (would manifest as an '' entry / double slash)
    expect(dirs).not.toContain('');
    const brief = JSON.parse(readFileSync(join(root, dirs[0], 'brief.json'), 'utf-8'));
    expect(brief.terminalId).toBe(dirs[0]);
    expect(brief.task).toBe('offline');
  });

  it('read with no brief at the current key looks back at the most-recent brief elsewhere', async () => {
    // Seed two foreign briefs directly under scratch with distinct mtimes.
    const older = scratchDir('t_older');
    const newer = scratchDir('t_newer');
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    writeFileSync(join(older, 'brief.json'), JSON.stringify({ schema: 'ant-brief/1', terminalId: 't_older', task: 'OLD TASK', writtenAt: '2026-01-01T00:00:00.000Z' }) + '\n');
    writeFileSync(join(newer, 'brief.json'), JSON.stringify({ schema: 'ant-brief/1', terminalId: 't_newer', task: 'NEW TASK', writtenAt: '2026-06-06T00:00:00.000Z' }) + '\n');
    const oldTime = new Date('2026-01-01T00:00:00Z');
    const newTime = new Date('2026-06-06T00:00:00Z');
    utimesSync(join(older, 'brief.json'), oldTime, oldTime);
    utimesSync(join(newer, 'brief.json'), newTime, newTime);

    // Current terminal (t_current) has NO brief of its own.
    const { runtime, captured } = makeRuntime({ terminalId: 't_current' });
    const code = await handleBriefVerb('read', [], runtime, { CliInputError });
    expect(code).toBe(0);
    const out = captured.stdout.join('\n');
    expect(out).toContain('NEW TASK');
    expect(out).not.toContain('OLD TASK');
    expect(captured.stderr.join('\n')).toContain('t_newer');
  });

  it('unknown brief verb is rejected', async () => {
    const { runtime } = makeRuntime();
    await expect(handleBriefVerb('frobnicate', [], runtime, { CliInputError })).rejects.toThrow(/unknown brief verb/);
  });

  it('help prints usage', async () => {
    const { runtime, captured } = makeRuntime();
    const code = await handleBriefVerb('help', [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.stdout[0]).toMatch(/^ant brief/);
  });
});
