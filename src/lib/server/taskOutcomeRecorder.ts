/**
 * taskOutcomeRecorder — the LIVE lifecycle hook for the delivery-signal
 * instrument (see taskOutcomesStore.ts for the table + reads).
 *
 * Sits between the /api/tasks/:taskId route and the append-only
 * task_outcomes store. Given a task's before/after status (in DB-enum
 * terms — 'pending'|'in_progress'|'blocked'|'completed'|'deleted') plus a
 * flag for whether a non-status correction occurred under an operator, it
 * classifies the transition and appends ONE outcome row when the
 * transition is outcome-bearing.
 *
 * ADDITIVE + non-blocking: uses `recordTaskOutcomeSafe`, so a failure here
 * can NEVER break the task PATCH/DELETE it observes. Non-outcome
 * transitions (e.g. pending→in_progress) record nothing.
 *
 * Both task surfaces funnel through here:
 *   - Lane-D taskStore statuses ARE the DB enum already.
 *   - JWPK tasksStore statuses (todo/in_progress/done/cancelled/blocked)
 *     map to the DB enum; callers should pass the DB-enum form (the JWPK
 *     store persists the DB enum, and getTask/before snapshots expose the
 *     JWPK form, so a tiny mapper is provided).
 */

import {
  classifyTransition,
  recordTaskOutcomeSafe,
  type TaskOutcome,
  type TaskOutcomeRecord
} from './taskOutcomesStore';

/** Map a JWPK status label to the canonical DB-enum status. */
const JWPK_TO_DB: Record<string, string> = {
  todo: 'pending',
  in_progress: 'in_progress',
  done: 'completed',
  cancelled: 'deleted',
  blocked: 'blocked'
};

export function jwpkStatusToDb(status: string): string {
  return JWPK_TO_DB[status] ?? status;
}

export type RecordTaskTransitionInput = {
  taskId: string;
  /** DB-enum status BEFORE the mutation (null if unknown). */
  fromStatus: string | null;
  /** DB-enum status AFTER the mutation. */
  toStatus: string;
  /**
   * True if this mutation changed scope (subject/title/description) on a
   * task where work had already begun, under an operator/human actor —
   * drives the 'corrected' classification when the status itself is
   * unchanged.
   */
  operatorRescopeAfterWork?: boolean;
  actor?: string | null;
};

/**
 * Classify and (if outcome-bearing) append one task_outcomes row. Returns
 * the recorded outcome, or null when the transition carries no outcome.
 * Never throws.
 */
export function recordTaskTransitionOutcome(
  input: RecordTaskTransitionInput
): TaskOutcomeRecord | null {
  const workHadBegun =
    input.fromStatus === 'in_progress' ||
    input.fromStatus === 'completed' ||
    input.fromStatus === 'blocked';

  // The classifier handles status-bearing transitions. The 'corrected'
  // case (no status change) only fires when the route flags an operator
  // re-scope after work began.
  let outcome: TaskOutcome | null = classifyTransition({
    from: input.fromStatus,
    to: input.toStatus,
    workHadBegun,
    operatorActor: input.operatorRescopeAfterWork === true
  });

  // Explicit operator re-scope with an unchanged status: classifyTransition
  // returns 'corrected' only when to === from. If the route already flagged
  // a re-scope and the status genuinely didn't move, honour it.
  if (
    outcome === null &&
    input.operatorRescopeAfterWork === true &&
    input.fromStatus === input.toStatus &&
    workHadBegun
  ) {
    outcome = 'corrected';
  }

  if (outcome === null) return null;

  const reason = reasonFor(outcome, input.fromStatus, input.toStatus);
  return recordTaskOutcomeSafe({
    taskId: input.taskId,
    outcome,
    reason,
    actor: input.actor ?? null,
    source: 'live'
  });
}

function reasonFor(outcome: TaskOutcome, from: string | null, to: string): string {
  const arrow = `${from ?? '∅'}→${to}`;
  switch (outcome) {
    case 'clean':
      return `live: completed without reversal (${arrow})`;
    case 'reopened':
      return `live: status reversal (${arrow})`;
    case 'corrected':
      return `live: operator re-scope after work began (${arrow})`;
    case 'abandoned':
      return `live: abandoned (${arrow})`;
  }
}
