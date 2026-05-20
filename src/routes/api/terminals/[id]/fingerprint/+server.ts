// /api/terminals/:id/fingerprint — M3.2a Q6 surface.
// GET (no writeBack)   → read-only detection. Auth: NONE (global read,
//                        matches /agent-status pattern).
// GET ?writeBack=1     → admin-bearer required (Q5 B1 lock); HIGH-confidence
//                        path mutates terminals.agent_kind+meta; MED/LOW
//                        meta-only. Best-effort — never blocks response.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTerminalById } from '$lib/server/terminalsStore';
import { applyFingerprintWriteBack, detectFingerprint } from '$lib/server/fingerprintDetector';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';

export const GET: RequestHandler = async ({ params, url, request }) => {
  const terminalId = params.id ?? '';
  if (terminalId.length === 0) throw error(400, 'terminal id required');
  const terminal = getTerminalById(terminalId);
  if (!terminal) throw error(404, 'terminal not found');
  const writeBack = url.searchParams.get('writeBack') === '1';
  if (writeBack) requireAdminAuth(request);
  const result = detectFingerprint(terminal);
  if (writeBack) {
    try { applyFingerprintWriteBack(terminal, result); } catch { /* best-effort */ }
  }
  return json(result);
};
