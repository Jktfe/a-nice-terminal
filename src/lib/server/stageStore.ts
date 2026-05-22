/**
 * stageStore — read-only projection over plan_events + task evidence
 * to derive Stage current-focus state from the existing event stream.
 *
 * M-State (Stage v1) slice 2 — no new tables, no new write path. The
 * focus_position state is already encoded in EvidenceRef kind='stage_focus'
 * entries on plan_events + task.evidence[] (added in slice 1). This file
 * folds those events into "what's the current focus for stage X?"
 * answers without committing to a new persistence layer.
 *
 * The intentionally narrow shape lets M-Viewer / M-Voice / future
 * subscribers ask one question: getCurrentFocus(stageId). The full
 * event stream (listFocusEvents) is also exposed for UI timelines.
 *
 * The "subscribe" path is deliberately NOT implemented here — Stage v1
 * relays focus through the existing chat fanout + SSE channels, so
 * subscribers attach to those primitives directly. This file is the
 * "where is the focus NOW?" query side only.
 */

import { getIdentityDb } from './db';
import type { EvidenceRef } from './planModeStore';

const STAGE_FOCUS_KIND = 'stage_focus' as const;

/**
 * A single focus event, projected from EvidenceRef + the row it lived on.
 * `source` tells subscribers whether the event came from a plan event
 * (intentional milestone) or a task evidence array (in-progress work).
 */
export type StageFocusEvent = {
  stageId: string;
  ref: string;
  label: string | null;
  narration: string | null;
  source: 'plan_event' | 'task';
  sourceId: string;
  /** the row's ts_millis (plan_event) or created_at_ms (task). */
  tsMs: number;
};

type PlanEventEvidenceRow = {
  id: string;
  ts_millis: number;
  evidence_json: string;
};

type TaskEvidenceRow = {
  id: string;
  created_at_ms: number;
  evidence: string;
};

function parseEvidence(raw: string | null | undefined): EvidenceRef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EvidenceRef[]) : [];
  } catch {
    return [];
  }
}

function extractStageId(ref: EvidenceRef): string | null {
  // Convention: ref string is "stage:<stageId>:<position>" OR plain stage id.
  // Pick the part between the first two colons when present, else use the
  // whole ref. Keeps the projection forgiving while the on-wire convention
  // settles.
  if (typeof ref.ref !== 'string' || ref.ref.length === 0) return null;
  const parts = ref.ref.split(':');
  if (parts.length >= 2 && parts[0] === 'stage') {
    return parts[1] ?? null;
  }
  return ref.ref;
}

/**
 * List every stage_focus event for a given stageId, in chronological
 * order (oldest first). Combines plan_events + tasks evidence into one
 * timeline.
 */
export function listFocusEvents(stageId: string): StageFocusEvent[] {
  const db = getIdentityDb();
  const out: StageFocusEvent[] = [];

  const planRows = db
    .prepare(`SELECT id, ts_millis, evidence_json FROM plan_events ORDER BY ts_millis ASC`)
    .all() as PlanEventEvidenceRow[];
  for (const row of planRows) {
    for (const ref of parseEvidence(row.evidence_json)) {
      if (ref.kind !== STAGE_FOCUS_KIND) continue;
      const evStageId = extractStageId(ref);
      if (evStageId !== stageId) continue;
      out.push({
        stageId,
        ref: ref.ref,
        label: ref.label ?? null,
        narration: ref.narration ?? null,
        source: 'plan_event',
        sourceId: row.id,
        tsMs: row.ts_millis
      });
    }
  }

  const taskRows = db
    .prepare(
      `SELECT id, created_at_ms, evidence FROM tasks
       WHERE status != 'deleted' ORDER BY created_at_ms ASC`
    )
    .all() as TaskEvidenceRow[];
  for (const row of taskRows) {
    for (const ref of parseEvidence(row.evidence)) {
      if (ref.kind !== STAGE_FOCUS_KIND) continue;
      const evStageId = extractStageId(ref);
      if (evStageId !== stageId) continue;
      out.push({
        stageId,
        ref: ref.ref,
        label: ref.label ?? null,
        narration: ref.narration ?? null,
        source: 'task',
        sourceId: row.id,
        tsMs: row.created_at_ms
      });
    }
  }

  out.sort((a, b) => a.tsMs - b.tsMs);
  return out;
}

/**
 * Return the most recent stage_focus event for the given stageId, or null
 * if nothing has been published yet. Subscribers should refresh on the
 * SSE chat fanout when a stage_focus message is broadcast.
 */
export function getCurrentFocus(stageId: string): StageFocusEvent | null {
  const events = listFocusEvents(stageId);
  if (events.length === 0) return null;
  return events[events.length - 1] ?? null;
}
