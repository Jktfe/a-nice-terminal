/**
 * POST /api/helper/status — a helper relays its bound handle's STATUS (Picture 3,
 * JWPK 2026-06-15). A paneless agent (desktop / mcp) can't post its own status in
 * clean-identity mode; its bound helper relays it on its behalf. Lease-gated:
 * the attachment must carry the postStatus scope (reader/agent both do — but
 * NEVER authorMessages; a lease-holder relays status, it does not author).
 *
 * Body: { status: "idle" | "thinking" | "working" | "response-required" }
 *   → 200 { ok, handle, status }
 *
 * Sets agent_status on the handle's live terminal (source 'helper'); the room /
 * terminals page surface it like any other status. The status SOURCE is the
 * helper's to decide (e.g. 'response-required' when it just delivered a message);
 * this endpoint just accepts + records it.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveLeaseBySecret, touchLease, ATTACHMENT_SCOPES } from '$lib/server/helperLeaseStore';
import { findActiveTerminalRecordByHandle } from '$lib/server/terminalRecordsStore';
import { setAgentStatus, isAllowedAgentStatus } from '$lib/server/agentStatusStore';

export const POST: RequestHandler = async ({ request }) => {
  const secret = request.headers.get('x-ant-attachment') ?? '';
  const lease = secret.trim().length > 0 ? resolveLeaseBySecret(secret.trim()) : null;
  if (!lease) throw error(401, 'a live attachment is required (x-ant-attachment).');
  if (!ATTACHMENT_SCOPES[lease.role].postStatus) {
    throw error(403, 'this attachment may not post status.');
  }
  try { touchLease(lease.id); } catch { /* heartbeat best-effort */ }

  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const status = body?.status;
  if (!isAllowedAgentStatus(status)) {
    throw error(400, 'status must be one of: idle, thinking, working, response-required.');
  }

  // A lease-holder is never a member, but a paneless handle still has a terminal
  // record; status lands on that terminal's row (terminals.id == session_id).
  const record = findActiveTerminalRecordByHandle(lease.handle);
  if (!record) throw error(404, `no live terminal for ${lease.handle} to carry status.`);

  setAgentStatus({ terminalId: record.session_id, newStatus: status, source: 'helper' });
  return json({ ok: true, handle: lease.handle, status });
};
