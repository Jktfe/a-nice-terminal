/**
 * GET /api/chat-rooms/:roomId/validation-summary
 *
 * Per-room verification summary for the apps "Trust chip" UI.
 *
 * V3 contract — locked eiw05zdurz msg_b6cnyrzdof + ratified
 * msg_00q40hn6ti after the trustState-only + no-badgeTone convergence
 * (apps-team agreement 2026-05-27).
 *
 * Response shape:
 *   {
 *     defaultLensId: string | null,        // V5 territory — null for now
 *     recentRunCount: number,              // validation_runs in last 7d
 *     pendingTaskCount: number,            // validation verifier tasks pending
 *     overallTrustScore: number | null,    // 0-1 raw, tooltip/sorting only
 *     trustState: 'passed' | 'failed' | 'pending' | 'stale' | 'unknown',
 *     criticalGaps: Array<{ claimAnchor, kind, reason }>,
 *     sheetUrl: string,                    // canonical room validation sheet
 *     evidenceFormUrl: string | null,      // signed deep-link for caller's
 *                                          //   next pending verifier task
 *     validationUxEnabled: boolean         // mirrors verification_ux flag
 *   }
 *
 * Server owns trust classification + stale policy. Clients render
 * platform-native colours from `trustState`; they do NOT compute
 * thresholds. See banked spec at
 * memory/project_verification_interface_premium_spec_2026_05_27.md.
 *
 * Auth: same gate as room reads (`requireChatRoomReadAccess`). OSS
 * callers receive `validationUxEnabled: false` so their UI hides the
 * chip; the rest of the payload still populates (read access is free).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { listArtefactsInRoom } from '$lib/server/chatRoomArtefactStore';
import { listValidationRunsForArtefacts } from '$lib/server/validationLensStore';
import { listTasks } from '$lib/server/tasksStore';
import { CURRENT_TIER, getFeatureFlagsForTier } from '$lib/server/featureGates';

type TrustState = 'passed' | 'failed' | 'pending' | 'stale' | 'unknown';

type CriticalGap = {
  claimAnchor: string;
  kind: 'failed-validation';
  reason: string;
};

type ValidationSummary = {
  defaultLensId: string | null;
  recentRunCount: number;
  pendingTaskCount: number;
  overallTrustScore: number | null;
  trustState: TrustState;
  criticalGaps: CriticalGap[];
  sheetUrl: string;
  evidenceFormUrl: string | null;
  validationUxEnabled: boolean;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const VALIDATION_TASK_DESCRIPTION_PATTERN = /Validate claim `[^`]+` using lens `[^`]+`/;
const PASSED_THRESHOLD = 0.8;
const MAX_CRITICAL_GAPS = 5;
const CRITICAL_GAP_TEXT_CHAR_LIMIT = 80;

export const GET: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) throw error(400, 'roomId required.');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'room not found');

  const access = await requireChatRoomReadAccess(request, room);
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  const validationUxEnabled = flags.verification_ux === true;

  const nowMs = Date.now();
  const windowStartMs = nowMs - SEVEN_DAYS_MS;

  const artefacts = listArtefactsInRoom(roomId);
  const artefactIds = artefacts.map((a) => a.id);
  const recentRuns = listValidationRunsForArtefacts(artefactIds, windowStartMs);
  const recentRunCount = recentRuns.length;

  // Validation verifier tasks live in the same room with a recognisable
  // description shape. todo + in_progress count as pending; done/cancelled
  // do not.
  const tasksInRoom = listTasks({ roomId });
  const pendingValidationTasks = tasksInRoom.filter(
    (t) =>
      (t.status === 'todo' || t.status === 'in_progress') &&
      VALIDATION_TASK_DESCRIPTION_PATTERN.test(t.description)
  );
  const pendingTaskCount = pendingValidationTasks.length;

  const completedRunsWithScore = recentRuns.filter(
    (r) => r.completedAtMs !== null && r.score !== null
  );
  const overallTrustScore = computeOverallTrustScore(completedRunsWithScore);

  const lastCompletedAtMs = recentRuns
    .map((r) => r.completedAtMs)
    .filter((ms): ms is number => ms !== null)
    .reduce<number | null>((max, ms) => (max === null || ms > max ? ms : max), null);

  const trustState = deriveTrustState({
    pendingCount: pendingTaskCount,
    overallTrustScore,
    lastCompletedAtMs,
    nowMs
  });

  const criticalGaps = recentRuns
    .filter((r) => r.status === 'failed')
    .slice(0, MAX_CRITICAL_GAPS)
    .map((r) => ({
      claimAnchor: r.claimAnchor,
      kind: 'failed-validation' as const,
      reason:
        r.claimText.length > CRITICAL_GAP_TEXT_CHAR_LIMIT
          ? `${r.claimText.slice(0, CRITICAL_GAP_TEXT_CHAR_LIMIT)}…`
          : r.claimText
    }));

  // Sheet URL is the canonical web view for this room's validation runs.
  // OSS callers can still navigate to it; the server renders a marketing
  // shell when `validationUxEnabled` is false (V1 boundary, banked).
  const sheetUrl = `/validation/rooms/${roomId}`;

  // Evidence form URL = next pending verifier task assigned to the caller
  // (any handle in their family). Returns null when no such task exists.
  const callerTask = pendingValidationTasks.find(
    (t) => t.assignedTo !== null && access.handles.includes(t.assignedTo)
  );
  const evidenceFormUrl = callerTask ? `/tasks/${callerTask.id}/validation-run` : null;

  const summary: ValidationSummary = {
    defaultLensId: null,
    recentRunCount,
    pendingTaskCount,
    overallTrustScore,
    trustState,
    criticalGaps,
    sheetUrl,
    evidenceFormUrl,
    validationUxEnabled
  };
  return json(summary);
};

function computeOverallTrustScore(runs: Array<{ score: number | null }>): number | null {
  if (runs.length === 0) return null;
  const sum = runs.reduce((acc, r) => acc + (r.score ?? 0), 0);
  // Stored scores are 0-100; the contract returns 0-1 raw.
  return sum / runs.length / 100;
}

function deriveTrustState(input: {
  pendingCount: number;
  overallTrustScore: number | null;
  lastCompletedAtMs: number | null;
  nowMs: number;
}): TrustState {
  if (input.overallTrustScore === null && input.lastCompletedAtMs === null) {
    // No runs at all in window. If verifier tasks are queued, we're
    // 'pending' (work in flight); otherwise 'unknown' (never validated).
    return input.pendingCount > 0 ? 'pending' : 'unknown';
  }
  // Stale wins over passed/failed once the freshest run is older than the
  // window. This is the server-owned policy clients must not duplicate.
  if (
    input.lastCompletedAtMs !== null &&
    input.nowMs - input.lastCompletedAtMs > SEVEN_DAYS_MS
  ) {
    return 'stale';
  }
  if (input.pendingCount > 0 && input.overallTrustScore === null) return 'pending';
  if (input.overallTrustScore === null) return 'unknown';
  return input.overallTrustScore >= PASSED_THRESHOLD ? 'passed' : 'failed';
}
