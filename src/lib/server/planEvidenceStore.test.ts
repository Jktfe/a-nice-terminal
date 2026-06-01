import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { createTask, deleteTask, _resetTaskStoreForTests } from './taskStore';
import { createPlan, _resetPlanStoreForTests } from './planStore';
import {
  listAllEvidence,
  evidenceStats
} from './planEvidenceStore';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-evidencestore-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
});

describe('planEvidenceStore', () => {
  it('empty DB → empty array and stats.total=0', () => {
    expect(listAllEvidence()).toEqual([]);
    const stats = evidenceStats();
    expect(stats.total).toBe(0);
    expect(stats.withLabel).toBe(0);
    expect(stats.byKind).toEqual({
      run_event: 0,
      task: 0,
      url: 0,
      file: 0,
      chat_message: 0,
      proposal: 0,
      stage_focus: 0,
      stage_pause_context: 0,
      stage_feedback: 0,
      stage_alternative: 0,
      stage_alternative_decision: 0
    });
  });

  it('single task with 2 evidence entries → 2 rows', () => {
    createTask({
      id: 't1',
      subject: 'wire identity gate',
      evidence: [
        { kind: 'url', ref: 'https://example.com/spec' },
        { kind: 'file', ref: 'src/lib/foo.ts', label: 'helper' }
      ]
    });
    const rows = listAllEvidence();
    expect(rows).toHaveLength(2);
    const refs = rows.map((r) => r.ref).sort();
    expect(refs).toEqual(['https://example.com/spec', 'src/lib/foo.ts']);
    expect(rows.every((r) => r.taskId === 't1')).toBe(true);
    expect(rows.every((r) => r.taskSubject === 'wire identity gate')).toBe(true);
  });

  it('filter by kind keeps only matching rows', () => {
    createTask({
      id: 't1',
      subject: 's',
      evidence: [
        { kind: 'url', ref: 'https://a.example' },
        { kind: 'file', ref: 'a.ts' },
        { kind: 'url', ref: 'https://b.example' }
      ]
    });
    const urls = listAllEvidence({ kind: 'url' });
    expect(urls).toHaveLength(2);
    expect(urls.every((r) => r.kind === 'url')).toBe(true);
    const files = listAllEvidence({ kind: 'file' });
    expect(files).toHaveLength(1);
    expect(files[0].ref).toBe('a.ts');
  });

  it('filter by planId scopes to one plan', () => {
    createTask({
      id: 'ta',
      subject: 'a',
      planId: 'planA',
      evidence: [{ kind: 'url', ref: 'https://a.example' }]
    });
    createTask({
      id: 'tb',
      subject: 'b',
      planId: 'planB',
      evidence: [{ kind: 'url', ref: 'https://b.example' }]
    });
    const a = listAllEvidence({ planId: 'planA' });
    expect(a).toHaveLength(1);
    expect(a[0].planId).toBe('planA');
    expect(a[0].ref).toBe('https://a.example');
  });

  it('filter by q matches in ref/label/subject (case-insensitive)', () => {
    createTask({
      id: 't1',
      subject: 'Wire IDENTITY gate',
      evidence: [{ kind: 'url', ref: 'https://example.com/foo' }]
    });
    createTask({
      id: 't2',
      subject: 'unrelated',
      evidence: [
        { kind: 'file', ref: 'src/lib/auth.ts', label: 'IdEnTiTy helper' }
      ]
    });
    createTask({
      id: 't3',
      subject: 'unrelated',
      evidence: [{ kind: 'url', ref: 'https://noop.example' }]
    });
    // subject match
    expect(listAllEvidence({ q: 'identity' }).map((r) => r.taskId).sort()).toEqual(
      ['t1', 't2']
    );
    // ref match
    expect(listAllEvidence({ q: 'foo' }).map((r) => r.taskId)).toEqual(['t1']);
    // label match
    expect(listAllEvidence({ q: 'helper' }).map((r) => r.taskId)).toEqual(['t2']);
  });

  it('deleted tasks are excluded', () => {
    createTask({
      id: 't1',
      subject: 'live',
      evidence: [{ kind: 'url', ref: 'https://live.example' }]
    });
    createTask({
      id: 't2',
      subject: 'gone',
      evidence: [{ kind: 'url', ref: 'https://gone.example' }]
    });
    deleteTask('t2');
    const rows = listAllEvidence();
    expect(rows).toHaveLength(1);
    expect(rows[0].ref).toBe('https://live.example');
    expect(evidenceStats().total).toBe(1);
  });

  it('planTitle resolves from plans table when row exists, null otherwise', () => {
    createPlan({ id: 'plan-named', title: 'Alpha Plan' });
    createTask({
      id: 't-named',
      subject: 'with title',
      planId: 'plan-named',
      evidence: [{ kind: 'url', ref: 'https://a' }]
    });
    // Implicit plan: createTask auto-creates a plans row with NULL title.
    createTask({
      id: 't-implicit',
      subject: 'no title',
      planId: 'plan-implicit',
      evidence: [{ kind: 'url', ref: 'https://b' }]
    });
    // Standalone (no plan at all)
    createTask({
      id: 't-standalone',
      subject: 'no plan',
      evidence: [{ kind: 'url', ref: 'https://c' }]
    });
    const rows = listAllEvidence();
    const byTask = new Map(rows.map((r) => [r.taskId, r]));
    expect(byTask.get('t-named')?.planTitle).toBe('Alpha Plan');
    expect(byTask.get('t-named')?.planId).toBe('plan-named');
    expect(byTask.get('t-implicit')?.planTitle).toBeNull();
    expect(byTask.get('t-implicit')?.planId).toBe('plan-implicit');
    expect(byTask.get('t-standalone')?.planTitle).toBeNull();
    expect(byTask.get('t-standalone')?.planId).toBeNull();
  });

  it('evidenceStats totals match list length', () => {
    createTask({
      id: 't1',
      subject: 's1',
      evidence: [
        { kind: 'url', ref: 'https://a', label: 'labelled' },
        { kind: 'file', ref: 'a.ts' }
      ]
    });
    createTask({
      id: 't2',
      subject: 's2',
      evidence: [
        { kind: 'url', ref: 'https://b' },
        { kind: 'run_event', ref: 'run-123', label: 'event' },
        { kind: 'chat_message', ref: 'msg-1' }
      ]
    });
    const stats = evidenceStats();
    expect(stats.total).toBe(5);
    expect(stats.total).toBe(listAllEvidence({ limit: 1000 }).length);
    expect(stats.byKind.url).toBe(2);
    expect(stats.byKind.file).toBe(1);
    expect(stats.byKind.run_event).toBe(1);
    expect(stats.byKind.chat_message).toBe(1);
    expect(stats.byKind.task).toBe(0);
    expect(stats.withLabel).toBe(2);
  });

  it('limit defaults to 200 and is capped at 1000', () => {
    const evidence = Array.from({ length: 5 }, (_, i) => ({
      kind: 'url' as const,
      ref: `https://example.com/${i}`
    }));
    createTask({ id: 't1', subject: 's', evidence });
    expect(listAllEvidence({ limit: 2 })).toHaveLength(2);
    expect(listAllEvidence({ limit: 0 })).toHaveLength(5); // 0 → default
    expect(listAllEvidence({ limit: 5000 }).length).toBeLessThanOrEqual(1000);
  });

  it('rows are sorted by taskCreatedAtMs DESC', async () => {
    createTask({
      id: 't-old',
      subject: 'old',
      evidence: [{ kind: 'url', ref: 'https://old' }]
    });
    // Force a different created_at_ms by ticking the clock at least 1ms.
    await new Promise((r) => setTimeout(r, 5));
    createTask({
      id: 't-new',
      subject: 'new',
      evidence: [{ kind: 'url', ref: 'https://new' }]
    });
    const rows = listAllEvidence();
    expect(rows[0].taskId).toBe('t-new');
    expect(rows[1].taskId).toBe('t-old');
    expect(rows[0].taskCreatedAtMs).toBeGreaterThanOrEqual(rows[1].taskCreatedAtMs);
  });
});
