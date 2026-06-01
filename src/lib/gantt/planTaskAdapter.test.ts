import { describe, it, expect } from 'vitest';
import { adaptPlanTasksToGantt } from './planTaskAdapter';

describe('adaptPlanTasksToGantt', () => {
  it('returns empty bundle for empty input + sensible default window', () => {
    const result = adaptPlanTasksToGantt([]);
    expect(result.tasks).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.windowStart).toBeInstanceOf(Date);
    expect(result.windowEnd).toBeInstanceOf(Date);
    expect(result.windowEnd.getTime()).toBeGreaterThan(result.windowStart.getTime());
  });

  it('synthesises start from createdAtMs when startedAtMs absent', () => {
    const createdAtMs = Date.UTC(2026, 0, 15);
    const result = adaptPlanTasksToGantt([
      { id: 't1', subject: 'first task', status: 'pending', createdAtMs }
    ]);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('t1');
    expect(result.tasks[0].start.getTime()).toBe(createdAtMs);
    // pending tasks get a default 1-day forward window if no end is set
    expect(result.tasks[0].end.getTime()).toBe(createdAtMs + 24 * 60 * 60 * 1000);
    expect(result.tasks[0].progress).toBe(0);
    expect(result.tasks[0].text).toBe('first task');
  });

  it('uses endedAtMs when present', () => {
    const startedAtMs = Date.UTC(2026, 0, 15);
    const endedAtMs = Date.UTC(2026, 0, 18);
    const result = adaptPlanTasksToGantt([
      { id: 't1', subject: 'spans 3 days', status: 'completed', startedAtMs, endedAtMs, createdAtMs: startedAtMs - 86400000 }
    ]);
    expect(result.tasks[0].start.getTime()).toBe(startedAtMs);
    expect(result.tasks[0].end.getTime()).toBe(endedAtMs);
    expect(result.tasks[0].progress).toBe(1);
  });

  it('maps status to progress: completed=1, in_progress=0.5, pending=0', () => {
    const result = adaptPlanTasksToGantt([
      { id: 'a', subject: 'A', status: 'completed', createdAtMs: 1000 },
      { id: 'b', subject: 'B', status: 'in_progress', createdAtMs: 1000 },
      { id: 'c', subject: 'C', status: 'pending', createdAtMs: 1000 },
      { id: 'd', subject: 'D', status: 'blocked', createdAtMs: 1000 }
    ]);
    expect(result.tasks.find((t) => t.id === 'a')?.progress).toBe(1);
    expect(result.tasks.find((t) => t.id === 'b')?.progress).toBe(0.5);
    expect(result.tasks.find((t) => t.id === 'c')?.progress).toBe(0);
    expect(result.tasks.find((t) => t.id === 'd')?.progress).toBe(0);
  });

  it('synthesises blockedBy → e2s dependency links, dropping unknown sources', () => {
    const result = adaptPlanTasksToGantt([
      { id: 'a', subject: 'A', status: 'completed', createdAtMs: 1000 },
      { id: 'b', subject: 'B', status: 'pending', blockedBy: ['a', 'ghost'], createdAtMs: 2000 }
    ]);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toMatchObject({ source: 'a', target: 'b', type: 'e2s' });
  });

  it('skips rows missing id or subject', () => {
    const result = adaptPlanTasksToGantt([
      { id: 'good', subject: 'Good', status: 'pending', createdAtMs: 1000 },
      { id: '', subject: 'No id', status: 'pending', createdAtMs: 1000 },
      { id: 'no-subject', subject: '', status: 'pending', createdAtMs: 1000 },
      null,
      'not an object'
    ]);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('good');
  });

  it('enforces a minimum visible duration so single-point tasks render as visible bars', () => {
    const t = Date.UTC(2026, 5, 1, 12, 0, 0);
    const result = adaptPlanTasksToGantt([
      { id: 'instant', subject: 'no-duration task', status: 'completed', startedAtMs: t, endedAtMs: t, createdAtMs: t }
    ]);
    // Same start/end input — adapter should bump end by at least 1 hour
    const span = result.tasks[0].end.getTime() - result.tasks[0].start.getTime();
    expect(span).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});
