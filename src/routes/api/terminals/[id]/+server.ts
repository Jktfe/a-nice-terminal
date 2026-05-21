/**
 * GET   /api/terminals/[id] → record + alive flag
 * PATCH /api/terminals/[id] body { name?, autoForwardRoomId?, autoForwardChat? }
 *   Updates the JWPK-visible terminal entity record. Per T2d (2026-05-14).
 *   Empty body is a no-op (returns current record).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTerminalRecord, updateTerminalRecord, parseAllowlist, deriveHandle } from '$lib/server/terminalRecordsStore';
import { listTerminals } from '$lib/server/ptyClient';

export const GET: RequestHandler = async ({ params }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');
  const record = getTerminalRecord(sessionId);
  if (!record) throw error(404, 'terminal not found');
  const alive = (await listTerminals()).includes(sessionId);
  return json({
    sessionId, name: record.name,
    autoForwardRoomId: record.auto_forward_room_id,
    autoForwardChat: record.auto_forward_chat,
    agentKind: record.agent_kind,
    tmuxTargetPane: record.tmux_target_pane,
    linkedChatRoomId: record.linked_chat_room_id,
    createdBy: record.created_by,
    allowlist: parseAllowlist(record.allowlist),
    handle: record.handle,
    derivedHandle: deriveHandle(record),
    createdAtMs: record.created_at_ms, updatedAtMs: record.updated_at_ms,
    alive
  });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw) throw error(400, 'body must be a JSON object.');
  const patch: Record<string, unknown> = {};
  if (typeof raw.name === 'string') patch.name = raw.name;
  if (raw.autoForwardRoomId === null || typeof raw.autoForwardRoomId === 'string') patch.autoForwardRoomId = raw.autoForwardRoomId;
  if (raw.autoForwardChat === 0 || raw.autoForwardChat === 1) patch.autoForwardChat = raw.autoForwardChat;
  if (raw.agentKind === null || typeof raw.agentKind === 'string') patch.agentKind = raw.agentKind;
  // S2: allow allowlist updates via PATCH (string[] | null). createdBy is
  // immutable post-creation — caller must set on create.
  if (raw.allowlist === null) patch.allowlist = null;
  else if (Array.isArray(raw.allowlist)) {
    patch.allowlist = (raw.allowlist as unknown[]).filter(
      (h): h is string => typeof h === 'string' && h.length > 0
    );
  }
  // S7: handle is settable on PATCH (back-compat for records created pre-S7).
  if (raw.handle === null) patch.handle = null;
  else if (typeof raw.handle === 'string') patch.handle = raw.handle.trim() || null;
  const updated = updateTerminalRecord(sessionId, patch);
  if (!updated) throw error(404, 'terminal not found');
  return json({
    sessionId, name: updated.name,
    autoForwardRoomId: updated.auto_forward_room_id,
    autoForwardChat: updated.auto_forward_chat,
    agentKind: updated.agent_kind,
    createdBy: updated.created_by,
    allowlist: parseAllowlist(updated.allowlist),
    handle: updated.handle,
    derivedHandle: deriveHandle(updated),
    updatedAtMs: updated.updated_at_ms
  });
};
