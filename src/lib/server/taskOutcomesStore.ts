/**
 * taskOutcomesStore — APPEND-ONLY delivery-signal INSTRUMENT.
 *
 * GEPA-for-ANT verdict (gepa-for-ant.html): do NOT build the optimiser
 * yet — the objective is UNMEASURABLE today because the tasks schema
 * can't distinguish a clean completion from a reopened/corrected/
 * human-helped one. The first real step is to INSTRUMENT, not optimise:
 * add a task_outcome label so "delivery-not-tokens" (fewer reopens /
 * corrections / interventions) becomes a readable signal a future
 * optimiser can climb.
 *
 * This store is that instrument. It is deliberately ADDITIVE and
 * LOW-RISK:
 *   - it writes to a NEW table (`task_outcomes`, db.ts) — the existing
 *     `tasks` table is NOT altered;
 *   - it only ever INSERTs (append-only) — outcome rows are never
 *     mutated or deleted;
 *   - recording at lifecycle transitions is additive (callers keep their
 *     existing behaviour; recording failures must never break a task
 *     mutation — see `recordTaskOutcome` swallow note);
 *   - the optimiser can be dropped wholesale without touching task CRUD.
 *
 * outcome ∈ { clean | reopened | corrected | abandoned }
 *   clean      — pending→in_progress→completed with no status reversal
 *                or reassignment.
 *   reopened   — a status REVERSAL was recorded: completed→(anything live)
 *                or in_progress→pending.
 *   corrected  — a human/operator re-scope/correction in the task's
 *                linked room (operator-actored mutation after work began).
 *   abandoned  — deleted / cancelled / never-started.
 *
 * ───────────────────────────────────────────────────────────────────────
 * DERIVATION-ACCURACY HONESTY (read before trusting the numbers):
 * The GEPA design said "derive from the existing audit_events status
 * deltas". Empirically (real DB 2026-06, 466 task rows) there are ZERO
 * audit_events with task-related kinds — the task stores never emitted
 * any. So for the 466 PRE-INSTRUMENT tasks the only durable signal is the
 * CURRENT `tasks.status` snapshot + timestamps. The backfill therefore
 * uses a two-tier derivation:
 *   (1) audit_events status-delta history when present (forward-correct;
 *       finds nothing today but is right the moment task audit lands), and
 *   (2) the tasks.status TERMINAL-STATE snapshot as the fallback.
 * Snapshot-derived rows are conservative: a task that was reopened and
 * then re-completed before the instrument existed looks 'clean' in the
 * snapshot (the reversal left no trace). The signal therefore UNDER-counts
 * reopens/corrections for historical data and only becomes high-fidelity
 * for tasks whose transitions are recorded live going forward. This is
 * the expected shape of a fresh instrument and is surfaced, not hidden.
 * ───────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import { asAuditEventSource } from './auditEventsStore';

export type TaskOutcome = 'clean' | 'reopened' | 'corrected' | 'abandoned';

const TASK_OUTCOMES: ReadonlySet<string> = new Set<TaskOutcome>([
  'clean', 'reopened', 'corrected', 'abandoned'
]);

export function isTaskOutcome(value: unknown): value is TaskOutcome {
  return typeof value === 'string' && TASK_OUTCOMES.has(value);
}

export type TaskOutcomeSource = 'live' | 'backfill';

export type TaskOutcomeRecord = {
  id: string;
  taskId: string;
  outcome: TaskOutcome;
  reason: string | null;
  atMs: number;
  actor: string | null;
  source: TaskOutcomeSource;
};

type TaskOutcomeRow = {
  rowid?: number;
  id: string;
  task_id: string;
  outcome: string;
  reason: string | null;
  at_ms: number;
  actor: string | null;
  source: string;
};

function rowToRecord(row: TaskOutcomeRow): TaskOutcomeRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    outcome: (isTaskOutcome(row.outcome) ? row.outcome : 'abandoned'),
    reason: row.reason,
    atMs: row.at_ms,
    actor: row.actor,
    source: (row.source === 'backfill' ? 'backfill' : 'live')
  };
}

export type RecordTaskOutcomeInput = {
  taskId: string;
  outcome: TaskOutcome;
  reason?: string | null;
  actor?: string | null;
  atMs?: number;
  source?: TaskOutcomeSource;
};

/**
 * Append ONE outcome row. Append-only: never updates/deletes. Returns the
 * inserted record. Throws on a bad outcome value (programmer error) — but
 * lifecycle callers should use `recordTaskOutcomeSafe` so a logging
 * failure can never break the underlying task mutation.
 */
export function recordTaskOutcome(input: RecordTaskOutcomeInput): TaskOutcomeRecord {
  if (!isTaskOutcome(input.outcome)) {
    throw new Error(`recordTaskOutcome: invalid outcome '${String(input.outcome)}'.`);
  }
  const db = getIdentityDb();
  const id = randomUUID();
  const atMs = input.atMs ?? Date.now();
  const source: TaskOutcomeSource = input.source ?? 'live';
  db.prepare(
    `INSERT INTO task_outcomes (id, task_id, outcome, reason, at_ms, actor, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.taskId,
    input.outcome,
    input.reason ?? null,
    atMs,
    input.actor ?? null,
    source
  );
  return {
    id,
    taskId: input.taskId,
    outcome: input.outcome,
    reason: input.reason ?? null,
    atMs,
    actor: input.actor ?? null,
    source
  };
}

/**
 * Lifecycle-safe variant: records the outcome but NEVER throws — a failed
 * instrument write must not break a task PATCH/DELETE. Returns the record
 * on success, or null if anything went wrong (and logs to stderr). This is
 * what the API route hooks call.
 */
export function recordTaskOutcomeSafe(input: RecordTaskOutcomeInput): TaskOutcomeRecord | null {
  try {
    return recordTaskOutcome(input);
  } catch (cause) {
    // Instrument-only: swallow so task mutations are never blocked by the
    // delivery-signal logger. Surface for observability, don't rethrow.
    console.error('[taskOutcomesStore] recordTaskOutcomeSafe failed:', cause);
    return null;
  }
}

/**
 * Classify a single status transition into an outcome, or null when the
 * transition is not itself outcome-bearing (e.g. pending→in_progress is
 * progress, not an outcome). `operatorActor` true marks the actor as a
 * human/operator (drives the 'corrected' classification when work had
 * already begun).
 *
 * Exported for direct unit-testing of the classifier independent of the
 * route wiring.
 */
export function classifyTransition(opts: {
  from: string | null;
  to: string;
  workHadBegun: boolean;
  operatorActor?: boolean;
}): TaskOutcome | null {
  const { from, to, workHadBegun, operatorActor } = opts;

  // Terminal abandonment.
  if (to === 'deleted' || to === 'cancelled') {
    return 'abandoned';
  }

  // Status reversal — a completed task going back to any live state, or an
  // in_progress task dropping back to pending, is a reopen.
  if (from === 'completed' && to !== 'completed') {
    return 'reopened';
  }
  if (from === 'in_progress' && to === 'pending') {
    return 'reopened';
  }

  // Clean completion: reached completed without (in this transition) being
  // a reversal. The "no reversal across the whole lifecycle" guarantee is
  // enforced by the SEQUENCE classifier below; a single forward
  // completed-transition is the clean signal.
  if (to === 'completed' && from !== 'completed') {
    return 'clean';
  }

  // Operator re-scope/correction while work was already underway, with no
  // status change of its own (e.g. a human edits subject/scope on an
  // in_progress task). Only meaningful once work had begun.
  if (operatorActor && workHadBegun && to === from) {
    return 'corrected';
  }

  return null;
}

/**
 * Derive the SINGLE summary outcome for a task from an ordered list of its
 * status transitions (oldest→newest). This is the audit-history path used
 * by the backfill when task status-delta events exist. Precedence:
 *   abandoned > reopened > corrected > clean > (null: never completed).
 * A task that completed cleanly but was later reopened is 'reopened'; a
 * task reopened then re-completed is still 'reopened' (the reversal
 * happened — it was not a clean delivery).
 */
export function deriveOutcomeFromTransitions(
  transitions: Array<{ from: string | null; to: string; operatorActor?: boolean }>
): { outcome: TaskOutcome; reason: string } | null {
  let sawCompleted = false;
  let sawReopen = false;
  let sawCorrected = false;
  let sawAbandoned = false;
  let workHadBegun = false;

  for (const t of transitions) {
    if (t.to === 'in_progress' || t.from === 'in_progress') workHadBegun = true;
    const c = classifyTransition({
      from: t.from,
      to: t.to,
      workHadBegun,
      operatorActor: t.operatorActor
    });
    if (c === 'abandoned') sawAbandoned = true;
    else if (c === 'reopened') sawReopen = true;
    else if (c === 'corrected') sawCorrected = true;
    else if (c === 'clean') sawCompleted = true;
  }

  if (sawAbandoned) return { outcome: 'abandoned', reason: 'transitioned to deleted/cancelled' };
  if (sawReopen) return { outcome: 'reopened', reason: 'a status reversal was recorded' };
  if (sawCorrected) return { outcome: 'corrected', reason: 'operator re-scope after work began' };
  if (sawCompleted) return { outcome: 'clean', reason: 'completed with no reversal/correction' };
  return null; // never completed and not abandoned → no terminal outcome yet
}

/**
 * Snapshot fallback: derive a terminal outcome from a task's CURRENT
 * status alone (no history). Conservative — see the honesty note at the
 * top of this file. Returns null for non-terminal states (pending /
 * in_progress / blocked) which have no outcome yet.
 */
export function deriveOutcomeFromSnapshot(status: string): { outcome: TaskOutcome; reason: string } | null {
  switch (status) {
    case 'completed':
      return { outcome: 'clean', reason: 'snapshot: terminal status completed (no history)' };
    case 'deleted':
      return { outcome: 'abandoned', reason: 'snapshot: terminal status deleted (no history)' };
    // 'cancelled' is the JWPK label; it maps to db 'deleted', but guard it.
    case 'cancelled':
      return { outcome: 'abandoned', reason: 'snapshot: terminal status cancelled (no history)' };
    default:
      return null; // pending / in_progress / blocked: not terminal
  }
}

// ─── reads ───────────────────────────────────────────────────────────────

/** All outcome rows for a task, oldest→newest. */
export function listOutcomesForTask(taskId: string): TaskOutcomeRecord[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, task_id, outcome, reason, at_ms, actor, source
         FROM task_outcomes WHERE task_id = ? ORDER BY at_ms ASC, id ASC`
    )
    .all(taskId) as TaskOutcomeRow[];
  return rows.map(rowToRecord);
}

/**
 * The LATEST recorded outcome per task (one row per task_id). Used by the
 * delivery-signal read so re-recording a task's outcome (e.g. a reopen
 * after a clean completion) supersedes the earlier label rather than
 * double-counting it.
 */
export function listLatestOutcomes(): TaskOutcomeRecord[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT o.rowid, o.id, o.task_id, o.outcome, o.reason, o.at_ms, o.actor, o.source
         FROM task_outcomes o
        WHERE o.rowid = (
          SELECT newest.rowid
            FROM task_outcomes newest
           WHERE newest.task_id = o.task_id
           ORDER BY newest.at_ms DESC, newest.rowid DESC
           LIMIT 1
        )
        ORDER BY o.task_id ASC`
    )
    .all() as TaskOutcomeRow[];
  return rows.map(rowToRecord);
}

export type DeliverySignal = {
  /** Distinct tasks that have at least one recorded outcome. */
  total: number;
  clean: number;
  reopened: number;
  corrected: number;
  abandoned: number;
  /**
   * The headline delivery ratio: clean / (clean + reopened + corrected).
   * Abandoned tasks are EXCLUDED from the denominator — an abandoned task
   * was never a delivery attempt that succeeded or regressed, so counting
   * it would dilute the "of the work we shipped, how much shipped cleanly"
   * question the optimiser cares about. null when there is no completed-or-
   * regressed work to measure yet.
   */
  cleanRatio: number | null;
  /** How many of the counted tasks came from the snapshot backfill vs live. */
  bySource: { live: number; backfill: number };
};

/**
 * The delivery signal: count/ratio of outcomes over the LATEST outcome per
 * task. This is the readable "delivery-not-tokens" metric the GEPA design
 * wants a future optimiser to climb (clean up, reopened+corrected down).
 */
export function deliverySignal(): DeliverySignal {
  const latest = listLatestOutcomes();
  let clean = 0, reopened = 0, corrected = 0, abandoned = 0;
  let live = 0, backfill = 0;
  for (const r of latest) {
    if (r.outcome === 'clean') clean++;
    else if (r.outcome === 'reopened') reopened++;
    else if (r.outcome === 'corrected') corrected++;
    else if (r.outcome === 'abandoned') abandoned++;
    if (r.source === 'backfill') backfill++;
    else live++;
  }
  const delivered = clean + reopened + corrected;
  return {
    total: latest.length,
    clean,
    reopened,
    corrected,
    abandoned,
    cleanRatio: delivered === 0 ? null : clean / delivered,
    bySource: { live, backfill }
  };
}

// ─── backfill ──────────────────────────────────────────────────────────

type TaskSnapshotRow = { id: string; status: string };

export type BackfillResult = {
  /** Tasks examined. */
  scanned: number;
  /** Outcome rows newly inserted this run. */
  inserted: number;
  /** Tasks skipped because they already had a backfill row (idempotency). */
  skippedExisting: number;
  /** Tasks with no terminal outcome to derive (pending/in_progress/blocked). */
  skippedNoOutcome: number;
  /** How many derived rows came from audit-history vs the status snapshot. */
  derivedFrom: { auditHistory: number; snapshot: number };
};

/**
 * Backfill outcome rows for existing tasks. IDEMPOTENT and READ-ONLY over
 * `tasks` + `audit_events` (it only writes to `task_outcomes`, and only
 * when a task has no prior backfill row). Safe to re-run.
 *
 * Two-tier derivation per task:
 *   1. audit-history: if `audit_events` carries status-delta events for the
 *      task, derive the summary outcome from the ordered transitions
 *      (forward-correct; finds nothing on today's DB but right once task
 *      audit lands).
 *   2. snapshot fallback: otherwise derive from the task's current status.
 *
 * Idempotency key: existence of ANY backfill-source row for the task_id.
 * Re-running never duplicates. Live rows recorded after a backfill are NOT
 * disturbed and DO suppress a later backfill for that task (the live signal
 * is strictly better than a snapshot guess).
 */
export function backfillTaskOutcomes(): BackfillResult {
  const db = getIdentityDb();

  const tasks = db
    .prepare(`SELECT id, status FROM tasks ORDER BY created_at_ms ASC`)
    .all() as TaskSnapshotRow[];

  // Set of task_ids that already have ANY outcome row (live or backfill) —
  // these are skipped so the backfill never duplicates and never overwrites
  // a better live signal.
  const existingRows = db
    .prepare(`SELECT DISTINCT task_id FROM task_outcomes`)
    .all() as { task_id: string }[];
  const alreadyRecorded = new Set(existingRows.map((r) => r.task_id));

  const auditByTask = buildAuditTransitionIndex();

  const result: BackfillResult = {
    scanned: 0,
    inserted: 0,
    skippedExisting: 0,
    skippedNoOutcome: 0,
    derivedFrom: { auditHistory: 0, snapshot: 0 }
  };

  const insertMany = db.transaction((rows: TaskSnapshotRow[]) => {
    for (const task of rows) {
      result.scanned++;
      if (alreadyRecorded.has(task.id)) {
        result.skippedExisting++;
        continue;
      }

      // Tier 1: audit-history.
      const transitions = auditByTask.get(task.id);
      let derived: { outcome: TaskOutcome; reason: string } | null = null;
      let derivedFrom: 'auditHistory' | 'snapshot' = 'snapshot';
      if (transitions && transitions.length > 0) {
        derived = deriveOutcomeFromTransitions(transitions);
        if (derived) derivedFrom = 'auditHistory';
      }
      // Tier 2: snapshot fallback.
      if (!derived) {
        derived = deriveOutcomeFromSnapshot(task.status);
        derivedFrom = 'snapshot';
      }

      if (!derived) {
        result.skippedNoOutcome++;
        continue;
      }

      recordTaskOutcome({
        taskId: task.id,
        outcome: derived.outcome,
        reason: `backfill (${derivedFrom}): ${derived.reason}`,
        actor: 'system:backfill',
        source: 'backfill'
      });
      result.inserted++;
      if (derivedFrom === 'auditHistory') result.derivedFrom.auditHistory++;
      else result.derivedFrom.snapshot++;
    }
  });
  insertMany(tasks);

  return result;
}

/**
 * Read audit_events and build an ordered transition list per task_id from
 * any task status-delta events. Tolerant of the (today empty) case: returns
 * an empty map when no task audit events exist.
 *
 * Recognised shapes (forward-compatible — none exist on today's DB):
 *   - kind matching /^task\.status/ or entity_kind === 'task', with
 *     before_json.status → after_json.status carrying the delta.
 * Operator actoring (for 'corrected') is inferred from actor_agent_id /
 * an `operator` marker in after_json when present.
 */
function buildAuditTransitionIndex(): Map<
  string,
  Array<{ from: string | null; to: string; operatorActor?: boolean }>
> {
  const index = new Map<
    string,
    Array<{ from: string | null; to: string; operatorActor?: boolean }>
  >();

  const source = asAuditEventSource();
  // Page through the whole log in at_ms order. 500 is the store's MAX_LIMIT.
  let sinceMs = -1;
  // Guard against pathological loops; the real log is ~1k rows.
  for (let page = 0; page < 10_000; page++) {
    const rows = source.listSince(sinceMs, 500);
    if (rows.length === 0) break;
    for (const row of rows) {
      const isTaskEvent =
        row.entity_kind === 'task' || /^task\.status/.test(row.kind);
      if (!isTaskEvent) continue;
      const before = safeParse(row.before_json);
      const after = safeParse(row.after_json);
      const to = pickStatus(after);
      if (to === null) continue;
      const from = pickStatus(before);
      const operatorActor =
        typeof (after as Record<string, unknown> | null)?.operator === 'boolean'
          ? Boolean((after as Record<string, unknown>).operator)
          : false;
      const list = index.get(row.entity_id) ?? [];
      list.push({ from, to, operatorActor });
      index.set(row.entity_id, list);
    }
    const last = rows[rows.length - 1];
    if (last.at_ms <= sinceMs) break; // no forward progress — stop.
    sinceMs = last.at_ms;
    if (rows.length < 500) break; // last page.
  }
  return index;
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pickStatus(value: unknown): string | null {
  if (value && typeof value === 'object' && 'status' in (value as Record<string, unknown>)) {
    const s = (value as Record<string, unknown>).status;
    return typeof s === 'string' ? s : null;
  }
  return null;
}

/** Test-only reset: hard-deletes every row in the task_outcomes table. */
export function _resetTaskOutcomesForTests(): void {
  getIdentityDb().prepare(`DELETE FROM task_outcomes`).run();
}
