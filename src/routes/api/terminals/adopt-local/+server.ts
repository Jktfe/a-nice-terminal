/**
 * POST /api/terminals/adopt-local
 *
 * Register an already-running local antOS tmux session without moving or
 * restarting it. This covers private-socket antOS sessions created before
 * the server-backed terminal path existed: the terminal keeps running on
 * ~/.tmux-antos/default, while the server gains the @handle + terminal record
 * needed for web/antOS inventory parity.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  tryAdminBearer,
  tryOperatorSession,
  tryAntchatOperatorBearer
} from '$lib/server/chatRoomAuthGate';
import {
  createTerminalRecord,
  deriveHandle,
  getTerminalRecord,
  parseAllowlist,
  type TerminalRecordPatch,
  updateTerminalRecord
} from '$lib/server/terminalRecordsStore';
import { validateHandleForRegistration } from '$lib/server/handleValidation';
import { createChatRoom, findChatRoomById } from '$lib/server/chatRoomStore';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { adoptExternalProcessForTerminal } from '$lib/server/terminalsStore';
import { probeTmuxSocketBinding } from '$lib/server/terminalSocketMetadata';
import { bindHandle, ensureHandleOwnedBy } from '$lib/server/handleBindingsStore';

function requireOperatorLikeAuth(request: Request): void {
  if (tryAdminBearer(request) || tryOperatorSession(request) || tryAntchatOperatorBearer(request)) return;
  throw error(401, 'operator login required to adopt a local antOS terminal.');
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sessionIdFrom(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : `local-${Date.now()}`;
}

function ensureLinkedRoom(sessionId: string): ReturnType<typeof getTerminalRecord> {
  let record = getTerminalRecord(sessionId);
  if (!record) return null;
  if (!record.linked_chat_room_id || !findChatRoomById(record.linked_chat_room_id)) {
    const linkedRoom = createChatRoom({
      name: `Terminal: ${record.name}`,
      whoCreatedIt: getOperatorHandle()
    });
    record = updateTerminalRecord(sessionId, { linkedChatRoomId: linkedRoom.id }) ?? record;
  }
  return record;
}

export const POST: RequestHandler = async ({ request }) => {
  requireOperatorLikeAuth(request);
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw error(400, 'Send a JSON object body.');
  }
  const body = raw as Record<string, unknown>;
  const tmuxSocketPath = cleanString(body.tmuxSocketPath);
  const tmuxSessionName = cleanString(body.tmuxSessionName);
  if (!tmuxSocketPath || !tmuxSocketPath.startsWith('/')) {
    throw error(400, 'tmuxSocketPath must be an absolute path.');
  }
  if (!tmuxSessionName) {
    throw error(400, 'tmuxSessionName is required.');
  }

  const probe = probeTmuxSocketBinding({
    tmuxSocketPath,
    tmuxSessionName,
    tmuxTargetPane: cleanString(body.tmuxTargetPane)
  });
  if (!probe) {
    throw error(404, `No live tmux pane found for ${tmuxSessionName}.`);
  }

  const requestedHandle = cleanString(body.handle);
  if (!requestedHandle) throw error(400, 'handle is required.');
  const validation = validateHandleForRegistration(requestedHandle);
  if (!validation.ok) throw error(400, validation.message);
  const handle = validation.canonicalHandle;

  const sessionId = cleanString(body.sessionId) ?? sessionIdFrom(probe.tmuxSessionName);
  if (!/^[A-Za-z0-9_.:-]+$/.test(sessionId)) {
    throw error(400, 'sessionId may contain only letters, numbers, dot, colon, underscore, and dash.');
  }
  const name = cleanString(body.name) ?? handle;
  const operator = getOperatorHandle();
  const creator = cleanString(body.user) ?? operator;

  let record = getTerminalRecord(sessionId);
  if (record && record.handle && record.handle !== handle) {
    throw error(409, `${sessionId} is already registered as ${record.handle}.`);
  }
  if (!record) {
    record = createTerminalRecord({
      sessionId,
      name,
      createdBy: creator,
      handle,
      tmuxTargetPane: probe.tmuxTargetPane
    });
  } else {
    const patch: TerminalRecordPatch = {};
    if (!record.handle) patch.handle = handle;
    if (!record.created_by) patch.createdBy = creator;
    if (record.tmux_target_pane !== probe.tmuxTargetPane) patch.tmuxTargetPane = probe.tmuxTargetPane;
    if (Object.keys(patch).length > 0) {
      record = updateTerminalRecord(sessionId, patch) ?? record;
    }
  }
  record = ensureLinkedRoom(sessionId) ?? record;
  bindHandle({
    handle,
    pane: probe.tmuxTargetPane,
    pid: probe.pid,
    pidStart: probe.pidStart,
    spawnedBy: creator,
    terminalId: sessionId
  });
  ensureHandleOwnedBy(handle, operator, {
    actor: operator,
    reason: 'local-antOS-adopt'
  });

  const terminal = adoptExternalProcessForTerminal({
    record,
    pid: probe.pid,
    pidStart: probe.pidStart,
    ttlSeconds: null,
    reason: 'local antOS private tmux session',
    adoptedBy: creator,
    meta: {
      tmuxSocketPath,
      tmuxSessionName: probe.tmuxSessionName,
      tmuxTargetPane: probe.tmuxTargetPane,
      paneTitle: probe.paneTitle,
      origin: 'antos-local-adopt'
    }
  });

  return json({
    sessionId,
    name: record.name,
    autoForwardRoomId: record.auto_forward_room_id,
    autoForwardChat: record.auto_forward_chat,
    agentKind: record.agent_kind,
    tmuxTargetPane: record.tmux_target_pane,
    tmuxSocketPath,
    tmuxSessionName: probe.tmuxSessionName,
    linkedChatRoomId: record.linked_chat_room_id,
    createdBy: record.created_by,
    allowlist: parseAllowlist(record.allowlist),
    handle: record.handle,
    derivedHandle: deriveHandle(record),
    bootCommand: record.boot_command,
    alive: true,
    adopted: {
      terminalId: terminal.id,
      pid: terminal.pid,
      pidStart: terminal.pid_start
    }
  }, { status: 201 });
};
