import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { getTask } from '$lib/server/tasksStore';
import {
  completeValidationRun,
  createValidationRun,
  createValidationSchema,
  getValidationSchema,
  listValidationRunsForClaim
} from '$lib/server/validationLensStore';
import type { ValidationVerifierKind } from '$lib/server/validationScoring';

type Payload = {
  outcome?: unknown;
  score?: unknown;
  evidence?: unknown;
};

type ParsedValidationTask = {
  claimId: string;
  lensSlug: string;
  verifierKind: ValidationVerifierKind;
  claimText: string;
  sourcePointer: string | null;
};

function parsePayload(value: unknown): Payload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Payload;
}

function firstMatch(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[1]?.trim() ?? null;
}

function parseVerifierKind(value: string | null): ValidationVerifierKind | null {
  if (value === 'agent' || value === 'human' || value === 'file' || value === 'context_summary') {
    return value;
  }
  return null;
}

function parseValidationTask(description: string): ParsedValidationTask | null {
  const claimId = firstMatch(description, /Validate claim `([^`]+)` using lens `([^`]+)`\./);
  const lensSlug = firstMatch(description, /using lens `([^`]+)`\./);
  const verifierKind = parseVerifierKind(firstMatch(description, /^Verifier kind:\s*(.+)$/m));
  const sourcePointer = firstMatch(description, /^Source pointer:\s*(.+)$/m);
  const claimText = firstMatch(description, /^>\s*(.+)$/m);
  if (!claimId || !lensSlug || !verifierKind || !claimText) return null;
  return { claimId, lensSlug, verifierKind, claimText, sourcePointer };
}

function ensureValidationSchema(id: string, createdBy: string): void {
  if (getValidationSchema(id)) return;
  createValidationSchema({
    id,
    name: id,
    description: 'Auto-created schema row for task-submitted validation evidence.',
    lensKind: 'custom',
    rulesJson: '{}',
    createdBy,
    archivedAtMs: null
  });
}

function runIdForTask(taskId: string): string {
  return `validation_run_${taskId}`;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const task = getTask(params.taskId);
  if (!task) throw error(404, 'Task not found.');
  if (!task.roomId) throw error(400, 'Validation verifier task is not room-scoped.');

  const payload = parsePayload(await request.json().catch(() => ({})));
  const auth = requireChatRoomMutationAuth(task.roomId, request, payload);
  if (task.status !== 'done') {
    throw error(400, 'Only completed validation verifier tasks can write validation runs.');
  }

  const outcome = payload.outcome === 'pass' ? 'passed' : payload.outcome === 'fail' ? 'failed' : null;
  if (!outcome) throw error(400, 'outcome must be pass or fail.');

  const parsed = parseValidationTask(task.description);
  if (!parsed) throw error(400, 'Task does not contain validation verifier metadata.');

  const id = runIdForTask(task.id);
  const existing = listValidationRunsForClaim(parsed.claimId).find((run) => run.id === id);
  ensureValidationSchema(parsed.lensSlug, auth.handle);

  if (!existing) {
    createValidationRun({
      id,
      schemaId: parsed.lensSlug,
      claimAnchor: parsed.claimId,
      claimText: parsed.claimText,
      status: 'pending',
      score: null,
      resultJson: null,
      runBy: task.assignedTo ?? auth.handle
    });
  }

  const score = typeof payload.score === 'number' && Number.isFinite(payload.score)
    ? Math.max(0, Math.min(100, Math.round(payload.score)))
    : undefined;
  const resultJson = JSON.stringify({
    verifierKind: parsed.verifierKind,
    taskId: task.id,
    sourcePointer: parsed.sourcePointer,
    evidence: typeof payload.evidence === 'string' ? payload.evidence : null
  });
  completeValidationRun(id, outcome, score, resultJson);
  const validationRun = listValidationRunsForClaim(parsed.claimId).find((run) => run.id === id);

  return json({
    validationRun,
    reused: existing !== undefined
  });
};
