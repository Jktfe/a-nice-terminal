/**
 * PATCH /api/terminals/[id]/family — set or clear the per-terminal model
 * family (JWPK msg_om51nvohx5 2026-06-11). Body: { family: string | null }.
 * Allow-listed (the desk pane's dropdown enum); null/empty clears. Distinct
 * from the free-text `model` field — family is the coarse grouping tier.
 *
 * Auth + ownership identical to the model endpoint.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
import { getTerminalById, setTerminalModelFamily } from '$lib/server/terminalsStore';

export const MODEL_FAMILIES = [
  'Claude', 'Codex', 'MiniMax', 'Kimi', 'Qwen', 'glm', 'Gemini', 'Quiver',
  'Gemma', 'GPT-OSS', 'AFM', 'Other-Ollama-Cloud', 'Other-Cloud', 'Other-Local'
] as const;

// model_family is operator-managed classification (see the account endpoint's
// note): admin-or-operator gate, no per-owner check, no IDOR fail-open.
function requireOperatorOrAdmin(request: Request): void {
  if (tryAdminBearer(request) || tryOperatorSession(request)) return;
  throw error(401, 'admin-bearer or operator session required');
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  requireOperatorOrAdmin(request);
  const id = params.id ?? '';
  if (!id) throw error(400, 'id required.');
  const terminal = getTerminalById(id);
  if (!terminal) throw error(404, 'terminal not found.');

  const body = (await request.json().catch(() => null)) as { family?: unknown } | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required.');
  const v = body.family;
  if (v !== null && typeof v !== 'string') throw error(400, 'family must be a string or null.');
  if (typeof v === 'string' && v.length > 0 && !MODEL_FAMILIES.includes(v as (typeof MODEL_FAMILIES)[number])) {
    throw error(400, `family must be one of: ${MODEL_FAMILIES.join(', ')}`);
  }
  const ok = setTerminalModelFamily(id, v ?? null);
  if (!ok) throw error(404, 'terminal not found.');
  return json({ ok: true });
};
