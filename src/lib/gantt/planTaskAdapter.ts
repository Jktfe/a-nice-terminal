/**
 * planTaskAdapter — maps ANT plan tasks (the shape returned by
 * `/api/plans/:id/tasks`) into the @svar-ui/svelte-gantt ITask + ILink
 * shape consumed by the Gantt component.
 *
 * Plan tasks don't carry explicit Gantt start/end fields — they have
 * createdAtMs (when the row was inserted), updatedAtMs (last touched),
 * and optional startedAtMs / endedAtMs lifecycle marks. We synthesise
 * a Gantt-friendly window from those signals; a Slice B follow-up will
 * add proper plannedStart / plannedEnd columns + drag-to-edit.
 *
 * Mapping rules (Slice A):
 *   - start  = startedAtMs > 0   ? startedAtMs   : createdAtMs
 *   - end    = endedAtMs   > 0   ? endedAtMs     : (status=completed ? updatedAtMs : start + DEFAULT_DURATION_MS)
 *   - text   = subject
 *   - type   = 'task' (no summary/milestone discrimination yet)
 *   - progress = 1 if completed/done, 0.5 if in_progress, 0 otherwise
 *   - dependency link = { source: blockedByTaskId, target: thisTaskId, type: 'e2s' }
 *     (blockedBy means: that task must finish before this one starts → end-to-start)
 *
 * Window bounds returned alongside the tasks so the page can render a
 * 'window {start} → {end}' subtitle without re-deriving from the bars.
 */

const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;
const MIN_VISIBLE_DURATION_MS = 60 * 60 * 1000; // 1h so single-day tasks aren't invisible bars

type RawPlanTask = {
  id?: unknown;
  subject?: unknown;
  status?: unknown;
  blockedBy?: unknown;
  startedAtMs?: unknown;
  endedAtMs?: unknown;
  createdAtMs?: unknown;
  updatedAtMs?: unknown;
};

export type GanttTask = {
  id: string;
  text: string;
  start: Date;
  end: Date;
  duration?: number;
  progress: number;
  type: 'task';
  status: string;
};

export type GanttLink = {
  id: string;
  source: string;
  target: string;
  type: 'e2s';
};

export type AdaptedGantt = {
  tasks: GanttTask[];
  links: GanttLink[];
  windowStart: Date;
  windowEnd: Date;
  startLabel: string;
  endLabel: string;
};

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function statusToProgress(status: string): number {
  if (status === 'completed' || status === 'done' || status === 'passing') return 1;
  if (status === 'in_progress') return 0.5;
  return 0;
}

function deriveWindow(tasks: GanttTask[]): { start: Date; end: Date } {
  if (tasks.length === 0) {
    const now = Date.now();
    return { start: new Date(now - 7 * 86_400_000), end: new Date(now + 7 * 86_400_000) };
  }
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = Number.NEGATIVE_INFINITY;
  for (const t of tasks) {
    minMs = Math.min(minMs, t.start.getTime());
    maxMs = Math.max(maxMs, t.end.getTime());
  }
  // Pad ±5% so the leftmost/rightmost bars aren't flush against the edges.
  const span = Math.max(maxMs - minMs, MIN_VISIBLE_DURATION_MS);
  const pad = span * 0.05;
  return { start: new Date(minMs - pad), end: new Date(maxMs + pad) };
}

function formatDateLabel(d: Date): string {
  // Short human label for the window subtitle: "12 Mar 2026".
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function adaptPlanTasksToGantt(rawTasks: readonly unknown[]): AdaptedGantt {
  const tasks: GanttTask[] = [];
  const knownIds = new Set<string>();
  for (const raw of rawTasks) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as RawPlanTask;
    const id = asString(row.id);
    const subject = asString(row.subject);
    if (!id || !subject) continue;
    const status = asString(row.status) ?? 'pending';
    const startedAt = asNumber(row.startedAtMs);
    const endedAt = asNumber(row.endedAtMs);
    const createdAt = asNumber(row.createdAtMs) ?? Date.now();
    const updatedAt = asNumber(row.updatedAtMs) ?? createdAt;
    const startMs = startedAt && startedAt > 0 ? startedAt : createdAt;
    const endMs = endedAt && endedAt > 0
      ? endedAt
      : status === 'completed' || status === 'done' || status === 'passing'
        ? Math.max(updatedAt, startMs + MIN_VISIBLE_DURATION_MS)
        : startMs + DEFAULT_DURATION_MS;
    tasks.push({
      id,
      text: subject,
      start: new Date(startMs),
      end: new Date(Math.max(endMs, startMs + MIN_VISIBLE_DURATION_MS)),
      progress: statusToProgress(status),
      type: 'task',
      status
    });
    knownIds.add(id);
  }

  // Links: drop refs to tasks not in this plan so the Gantt doesn't render
  // dangling dependency arrows.
  const links: GanttLink[] = [];
  for (const raw of rawTasks) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as RawPlanTask;
    const id = asString(row.id);
    if (!id || !knownIds.has(id)) continue;
    const blockedBy = asStringArray(row.blockedBy);
    for (const sourceId of blockedBy) {
      if (!knownIds.has(sourceId) || sourceId === id) continue;
      links.push({ id: `${sourceId}__${id}`, source: sourceId, target: id, type: 'e2s' });
    }
  }

  const { start, end } = deriveWindow(tasks);
  return {
    tasks,
    links,
    windowStart: start,
    windowEnd: end,
    startLabel: formatDateLabel(start),
    endLabel: formatDateLabel(end)
  };
}
