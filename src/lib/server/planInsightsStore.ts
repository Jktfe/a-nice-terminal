/**
 * planInsightsStore — Lane-D PLANS cross-plan analytics.
 *
 * `computeInsights()` is a single read-only aggregator that joins
 * across tasks + plans + plan_rooms + chat_rooms to surface the "state
 * of the union" — plan lifecycle counts, task status / priority
 * breakdowns, duration stats over timestamped tasks, top plans / rooms /
 * blocked tasks, and the global dependency-graph density.
 *
 * SQL is preferred over JS loops for the obvious aggregates. Median and
 * the top-plans roll-ups need per-row inspection, so they fall back to
 * an in-JS pass over a single SELECT to keep query count down.
 *
 * READ-ONLY: this module never mutates state, and never imports a
 * write-capable helper. JWPK SURFACE-SIZE-ONLY: no caching, no TTL.
 */

import { getIdentityDb } from './db';
import { planCompletion, type PlanCompletion } from './taskStore';

export type PlansInsights = {
  generatedAtMs: number;
  plans: {
    total: number;
    active: number;
    archived: number;
    deletedSoft: number;
    avgCompletionPctActive: number;
  };
  tasks: {
    total: number;
    byStatus: { pending: number; in_progress: number; blocked: number; completed: number };
    byPriority: { [priority: string]: number };
    withTimestamps: number;
    standalone: number;
  };
  duration: {
    measuredCount: number;
    totalMs: number;
    avgMs: number;
    medianMs: number;
    minMs: number;
    maxMs: number;
  } | null;
  topPlans: {
    byCompletedCount: { planId: string; title: string | null; completed: number; total: number; pct: number }[];
    byTotalCount: { planId: string; title: string | null; completed: number; total: number; pct: number }[];
  };
  topRooms: { roomId: string; roomName: string; planCount: number }[];
  topAgents: { agent: string; completed: number; total: number }[];
  mostBlockedTasks: { taskId: string; subject: string; planId: string | null; blockedByCount: number }[];
  dependencies: { taskCount: number; edgeCount: number };
};

const TOP_N = 5;

type PlanLifecycleRow = {
  id: string;
  archived_at_ms: number | null;
  deleted_at_ms: number | null;
};

type TaskRollupRow = {
  id: string;
  subject: string;
  status: string;
  priority: number | null;
  plan_id: string | null;
  assigned_agent: string | null;
  blocked_by: string;
  started_at_ms: number | null;
  ended_at_ms: number | null;
};

type RoomRollupRow = {
  room_id: string;
  room_name: string;
  plan_count: number;
};

function parseBlockedBy(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function median(sortedMs: number[]): number {
  if (sortedMs.length === 0) return 0;
  const mid = Math.floor(sortedMs.length / 2);
  if (sortedMs.length % 2 === 1) return sortedMs[mid];
  // Even-length: integer-average the two middle values.
  return Math.floor((sortedMs[mid - 1] + sortedMs[mid]) / 2);
}

export function computeInsights(): PlansInsights {
  const db = getIdentityDb();

  // ── Plans lifecycle ────────────────────────────────────────────
  // The "total plans" denominator unions explicit plans rows + any
  // plan_id referenced from non-deleted tasks (legacy implicit plans
  // that pre-date the plans entity). plans-table lifecycle counts use
  // the explicit rows only — implicit plans are always "active".
  const planRows = db
    .prepare(`SELECT id, archived_at_ms, deleted_at_ms FROM plans`)
    .all() as PlanLifecycleRow[];

  const implicitPlanIds = (
    db
      .prepare(
        `SELECT DISTINCT plan_id FROM tasks
          WHERE plan_id IS NOT NULL
            AND status != 'deleted'
            AND plan_id NOT IN (SELECT id FROM plans)`
      )
      .all() as { plan_id: string }[]
  ).map((r) => r.plan_id);

  const explicitTotal = planRows.length;
  const totalPlans = explicitTotal + implicitPlanIds.length;
  const archivedPlans = planRows.filter(
    (p) => p.archived_at_ms !== null && p.deleted_at_ms === null
  ).length;
  const deletedSoftPlans = planRows.filter((p) => p.deleted_at_ms !== null).length;
  const explicitActivePlans = planRows.filter(
    (p) => p.archived_at_ms === null && p.deleted_at_ms === null
  );
  const activePlans = explicitActivePlans.length + implicitPlanIds.length;

  // Active plans average completion — implicit plans count too.
  const activePlanIds = [
    ...explicitActivePlans.map((p) => p.id),
    ...implicitPlanIds
  ];
  let avgCompletionPctActive = 0;
  if (activePlanIds.length > 0) {
    const sum = activePlanIds.reduce((acc, id) => acc + planCompletion(id).pct, 0);
    avgCompletionPctActive = sum / activePlanIds.length;
  }

  // ── Tasks (non-deleted) ────────────────────────────────────────
  const taskRows = db
    .prepare(
      `SELECT id, subject, status, priority, plan_id, assigned_agent,
              blocked_by, started_at_ms, ended_at_ms
         FROM tasks
        WHERE status != 'deleted'`
    )
    .all() as TaskRollupRow[];

  const byStatus = { pending: 0, in_progress: 0, blocked: 0, completed: 0 };
  const byPriority: { [priority: string]: number } = { '1': 0, '2': 0, '3': 0, none: 0 };
  let withTimestamps = 0;
  let standalone = 0;
  const durationsMs: number[] = [];

  for (const t of taskRows) {
    if (t.status === 'pending') byStatus.pending++;
    else if (t.status === 'in_progress') byStatus.in_progress++;
    else if (t.status === 'blocked') byStatus.blocked++;
    else if (t.status === 'completed') byStatus.completed++;

    const key = t.priority === null ? 'none' : String(t.priority);
    byPriority[key] = (byPriority[key] ?? 0) + 1;

    if (t.plan_id === null) standalone++;
    if (
      t.started_at_ms !== null &&
      t.ended_at_ms !== null &&
      t.ended_at_ms > t.started_at_ms
    ) {
      withTimestamps++;
      durationsMs.push(t.ended_at_ms - t.started_at_ms);
    }
  }

  // ── Duration stats ─────────────────────────────────────────────
  let duration: PlansInsights['duration'] = null;
  if (durationsMs.length > 0) {
    const sorted = [...durationsMs].sort((a, b) => a - b);
    const totalMs = sorted.reduce((a, b) => a + b, 0);
    duration = {
      measuredCount: sorted.length,
      totalMs,
      avgMs: Math.floor(totalMs / sorted.length),
      medianMs: median(sorted),
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1]
    };
  }

  // ── Top plans by completed + total ─────────────────────────────
  // SQL aggregate per plan_id, then JS-resolve titles via planCompletion
  // so we don't re-implement the read-only title resolver here.
  const planCountRows = db
    .prepare(
      `SELECT plan_id,
              COUNT(*) AS total,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
         FROM tasks
        WHERE plan_id IS NOT NULL AND status != 'deleted'
        GROUP BY plan_id`
    )
    .all() as { plan_id: string; total: number; completed: number | null }[];

  const planAggregates: PlanCompletion[] = planCountRows.map((r) => {
    const total = r.total ?? 0;
    const completed = r.completed ?? 0;
    return {
      planId: r.plan_id,
      // Use planCompletion(plan_id) to lift the title resolver in
      // exactly one place. Cheap — one SQL hit per plan, capped TOP_N.
      title: planCompletion(r.plan_id).title,
      total,
      completed,
      pct: total === 0 ? 0 : completed / total
    };
  });

  const byCompletedCount = [...planAggregates]
    .sort((a, b) => {
      if (b.completed !== a.completed) return b.completed - a.completed;
      // Tie-break by total desc, then plan_id asc for stability.
      if (b.total !== a.total) return b.total - a.total;
      return a.planId.localeCompare(b.planId);
    })
    .slice(0, TOP_N);

  const byTotalCount = [...planAggregates]
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.completed !== a.completed) return b.completed - a.completed;
      return a.planId.localeCompare(b.planId);
    })
    .slice(0, TOP_N);

  // ── Top rooms by attached-plan count ───────────────────────────
  const roomRows = db
    .prepare(
      `SELECT pr.room_id AS room_id,
              r.name     AS room_name,
              COUNT(*)   AS plan_count
         FROM plan_rooms pr
         JOIN chat_rooms r ON r.id = pr.room_id
        WHERE r.deleted_at_ms IS NULL AND r.archived_at_ms IS NULL
        GROUP BY pr.room_id, r.name
        ORDER BY plan_count DESC, r.name ASC
        LIMIT ?`
    )
    .all(TOP_N) as RoomRollupRow[];

  const topRooms = roomRows.map((r) => ({
    roomId: r.room_id,
    roomName: r.room_name,
    planCount: r.plan_count
  }));

  // ── Top assigned agents ────────────────────────────────────────
  const agentRows = db
    .prepare(
      `SELECT assigned_agent AS agent,
              COUNT(*) AS total,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
         FROM tasks
        WHERE assigned_agent IS NOT NULL AND status != 'deleted'
        GROUP BY assigned_agent
        ORDER BY completed DESC, total DESC
        LIMIT ?`
    )
    .all(TOP_N) as { agent: string; total: number; completed: number | null }[];

  const topAgents = agentRows.map((r) => ({
    agent: r.agent,
    completed: r.completed ?? 0,
    total: r.total ?? 0
  }));

  // ── Most-blocked tasks ─────────────────────────────────────────
  // blocked_by is a JSON array, so we have to project it in JS — but
  // we can pre-filter to rows where the JSON isn't the empty literal.
  const candidateRows = db
    .prepare(
      `SELECT id, subject, plan_id, blocked_by
         FROM tasks
        WHERE status != 'deleted' AND blocked_by != '[]'`
    )
    .all() as { id: string; subject: string; plan_id: string | null; blocked_by: string }[];

  const mostBlockedTasks = candidateRows
    .map((r) => ({
      taskId: r.id,
      subject: r.subject,
      planId: r.plan_id,
      blockedByCount: parseBlockedBy(r.blocked_by).length
    }))
    .filter((t) => t.blockedByCount > 0)
    .sort((a, b) => {
      if (b.blockedByCount !== a.blockedByCount) return b.blockedByCount - a.blockedByCount;
      return a.taskId.localeCompare(b.taskId);
    })
    .slice(0, TOP_N);

  // ── Dependency graph density ───────────────────────────────────
  // Edge = a single (task, blocker) pair. Sum of |blocked_by| over
  // non-deleted tasks gives the directed-edge count; bidirectional
  // mirror in `blocks` would double-count so we deliberately use one
  // side only.
  let edgeCount = 0;
  for (const r of taskRows) {
    edgeCount += parseBlockedBy(r.blocked_by).length;
  }

  return {
    generatedAtMs: Date.now(),
    plans: {
      total: totalPlans,
      active: activePlans,
      archived: archivedPlans,
      deletedSoft: deletedSoftPlans,
      avgCompletionPctActive
    },
    tasks: {
      total: taskRows.length,
      byStatus,
      byPriority,
      withTimestamps,
      standalone
    },
    duration,
    topPlans: { byCompletedCount, byTotalCount },
    topRooms,
    topAgents,
    mostBlockedTasks,
    dependencies: { taskCount: taskRows.length, edgeCount }
  };
}
