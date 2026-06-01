import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createTask, _resetTaskStoreForTests } from '$lib/server/taskStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  _resetTaskStoreForTests();
});

afterEach(() => {
  _resetTaskStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

function getReq(search = ''): Parameters<typeof GET>[0] {
  return {
    url: new URL('http://x/api/plans/evidence' + search)
  } as Parameters<typeof GET>[0];
}

describe('GET /api/plans/evidence', () => {
  it('returns empty corpus + zero stats when no tasks exist', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence).toEqual([]);
    expect(body.stats).toEqual({
      byKind: {
        run_event: 0, task: 0, url: 0, file: 0, chat_message: 0,
        proposal: 0, stage_focus: 0, stage_pause_context: 0,
        stage_feedback: 0, stage_alternative: 0
      },
      total: 0,
      withLabel: 0
    });
  });

  it('returns evidence corpus with correct shapes and stats', async () => {
    createTask({
      id: 't-1',
      subject: 'task one',
      planId: 'p1',
      evidence: [
        { kind: 'url', ref: 'https://example.com/a', label: 'Example A' },
        { kind: 'file', ref: '/tmp/log.txt' }
      ]
    });
    createTask({
      id: 't-2',
      subject: 'task two',
      planId: 'p2',
      evidence: [
        { kind: 'url', ref: 'https://example.com/b', label: 'Example B' }
      ]
    });

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.evidence.length).toBe(3);
    expect(body.evidence.find((row: { ref: string }) => row.ref === 'https://example.com/b')).toMatchObject({
      taskId: 't-2',
      taskSubject: 'task two',
      planId: 'p2',
      kind: 'url',
      ref: 'https://example.com/b',
      label: 'Example B'
    });
    expect(body.evidence.find((row: { ref: string }) => row.ref === 'https://example.com/a')).toMatchObject({
      taskId: 't-1',
      taskSubject: 'task one',
      planId: 'p1',
      kind: 'url',
      ref: 'https://example.com/a',
      label: 'Example A'
    });

    expect(body.stats.total).toBe(3);
    expect(body.stats.withLabel).toBe(2);
    expect(body.stats.byKind).toEqual({
      run_event: 0, task: 0, url: 2, file: 1, chat_message: 0,
      proposal: 0, stage_focus: 0, stage_pause_context: 0,
      stage_feedback: 0, stage_alternative: 0
    });
  });

  it('filters by kind', async () => {
    createTask({
      id: 't-1',
      subject: 'task one',
      planId: 'p1',
      evidence: [
        { kind: 'url', ref: 'https://a.com' },
        { kind: 'file', ref: '/tmp/f1' }
      ]
    });

    const res = await GET(getReq('?kind=file'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.length).toBe(1);
    expect(body.evidence[0].kind).toBe('file');
    expect(body.stats.total).toBe(2); // stats are global, not filtered
  });

  it('filters by planId', async () => {
    createTask({
      id: 't-1',
      subject: 'task one',
      planId: 'p1',
      evidence: [{ kind: 'url', ref: 'https://a.com' }]
    });
    createTask({
      id: 't-2',
      subject: 'task two',
      planId: 'p2',
      evidence: [{ kind: 'url', ref: 'https://b.com' }]
    });

    const res = await GET(getReq('?planId=p1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.length).toBe(1);
    expect(body.evidence[0].taskId).toBe('t-1');
  });

  it('filters by q (search across ref, label, subject)', async () => {
    createTask({
      id: 't-1',
      subject: 'alpha task',
      planId: 'p1',
      evidence: [{ kind: 'url', ref: 'https://alpha.com', label: 'Alpha link' }]
    });
    createTask({
      id: 't-2',
      subject: 'beta task',
      planId: 'p2',
      evidence: [{ kind: 'url', ref: 'https://beta.com' }]
    });

    const resRef = await GET(getReq('?q=alpha'));
    const bodyRef = await resRef.json();
    expect(bodyRef.evidence.length).toBe(1);
    expect(bodyRef.evidence[0].taskId).toBe('t-1');

    const resLabel = await GET(getReq('?q=link'));
    const bodyLabel = await resLabel.json();
    expect(bodyLabel.evidence.length).toBe(1);
    expect(bodyLabel.evidence[0].taskId).toBe('t-1');

    const resSubj = await GET(getReq('?q=beta'));
    const bodySubj = await resSubj.json();
    expect(bodySubj.evidence.length).toBe(1);
    expect(bodySubj.evidence[0].taskId).toBe('t-2');
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      createTask({
        id: `t-${i}`,
        subject: `task ${i}`,
        planId: 'p1',
        evidence: [{ kind: 'url', ref: `https://x.com/${i}` }]
      });
    }

    const res = await GET(getReq('?limit=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.length).toBe(2);
  });

  it('ignores invalid kind filter (returns all)', async () => {
    createTask({
      id: 't-1',
      subject: 'task one',
      planId: 'p1',
      evidence: [{ kind: 'url', ref: 'https://a.com' }]
    });

    const res = await GET(getReq('?kind=not_a_kind'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.length).toBe(1);
  });

  it('excludes deleted tasks from corpus', async () => {
    createTask({
      id: 't-live',
      subject: 'live task',
      planId: 'p1',
      status: 'completed',
      evidence: [{ kind: 'url', ref: 'https://live.com' }]
    });
    createTask({
      id: 't-dead',
      subject: 'dead task',
      planId: 'p1',
      status: 'deleted',
      evidence: [{ kind: 'url', ref: 'https://dead.com' }]
    });

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.length).toBe(1);
    expect(body.evidence[0].taskId).toBe('t-live');
    expect(body.stats.total).toBe(1);
  });
});
