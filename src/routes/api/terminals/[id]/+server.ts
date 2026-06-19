/**
 * GET   /api/terminals/[id] → record + alive flag
 * PATCH /api/terminals/[id] body { name?, autoForwardRoomId?, autoForwardChat? }
 *   Updates the JWPK-visible terminal entity record. Per T2d (2026-05-14).
 *   Empty body is a no-op (returns current record).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTerminalRecord, updateTerminalRecord, parseAllowlist, deriveHandle } from '$lib/server/terminalRecordsStore';
import { validateHandleForRegistration } from '$lib/server/handleValidation';
import { listTerminals } from '$lib/server/ptyClient';
import { resolveTerminalCallerHandle } from '$lib/server/authGate';
import { getOperatorHandle, isOperatorHandle } from '$lib/server/operatorHandle';
import { getTerminalById, listTerminalClassByIds, setTerminalAgentKind } from '$lib/server/terminalsStore';
import {
  socketBackedTerminalAlive,
  terminalSocketBindingFromMeta
} from '$lib/server/terminalSocketMetadata';
import { buildTerminalDeskReadModel } from '$lib/server/terminalDeskReadModel';

export const GET: RequestHandler = async ({ params }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');
  const record = getTerminalRecord(sessionId);
  if (!record) throw error(404, 'terminal not found');
  const terminalRow = getTerminalById(sessionId);
  const socketBinding = terminalSocketBindingFromMeta(terminalRow?.meta);
  const alive = (await listTerminals()).includes(sessionId)
    || (socketBinding ? socketBackedTerminalAlive(terminalRow?.meta, record.tmux_target_pane) : false);
  const agentKind = terminalRow?.agent_kind ?? record.agent_kind;
  const classInfo = listTerminalClassByIds([sessionId]).get(sessionId);
  const deskModel = buildTerminalDeskReadModel({
    record,
    terminalRow,
    alive,
    agentKind,
    accountType: classInfo?.accountType ?? null,
    modelFamily: classInfo?.modelFamily ?? null
  });
  return json({
    sessionId, name: record.name,
    autoForwardRoomId: record.auto_forward_room_id,
    autoForwardChat: record.auto_forward_chat,
    agentKind,
    tmuxTargetPane: record.tmux_target_pane,
    linkedChatRoomId: record.linked_chat_room_id,
    createdBy: record.created_by,
    allowlist: parseAllowlist(record.allowlist),
    handle: record.handle,
    derivedHandle: deriveHandle(record),
    bootCommand: record.boot_command,
    tmuxSocketPath: socketBinding?.tmuxSocketPath ?? null,
    tmuxSessionName: socketBinding?.tmuxSessionName ?? null,
    desk: deskModel.desk,
    antHandleClaim: deskModel.antHandleClaim,
    paneBinding: deskModel.paneBinding,
    cliProfile: deskModel.cliProfile,
    terminalConfig: deskModel.terminalConfig,
    createdAtMs: record.created_at_ms, updatedAtMs: record.updated_at_ms,
    alive
  });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw) throw error(400, 'body must be a JSON object.');
  const existing = getTerminalRecord(sessionId);
  if (!existing) throw error(404, 'terminal not found');
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
  // Sec-iter2 Fix #2 (2026-05-30): validate non-null handle patches before
  // the store write. Closes the PATCH-side attack path: an attacker could
  // PATCH any existing terminal (e.g. one with NULL handle they spawned
  // themselves) to handle='@admin' and gain admin via the approver gate's
  // resolveAuthoritativeCallerHandle. The store-layer choke-point (Fix #1)
  // catches this even if we forget here; the API-layer validation gives
  // the operator a precise 400 reason rather than the store's tagged 500.
  if (raw.handle === null) {
    patch.handle = null;
  } else if (typeof raw.handle === 'string') {
    const trimmed = raw.handle.trim();
    if (trimmed.length === 0) {
      patch.handle = null;
    } else {
      const validation = validateHandleForRegistration(trimmed);
      if (!validation.ok) {
        throw error(400, validation.message);
      }
      patch.handle = validation.canonicalHandle;
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'handle')) {
    const nextHandle = patch.handle as string | null;
    const touchesOperatorHandle =
      (existing.handle !== null && isOperatorHandle(existing.handle)) ||
      (nextHandle !== null && isOperatorHandle(nextHandle));
    if (touchesOperatorHandle) {
      const callerHandle = resolveTerminalCallerHandle(request);
      if (!callerHandle || !isOperatorHandle(callerHandle)) {
        throw error(403, `${getOperatorHandle()} is the server handle and can only be changed by the operator.`);
      }
    }
  }
  // Session recovery: let the operator set/correct the launch command (e.g. for
  // custom agents like Kimi/Minimax). null or empty clears it back to derived.
  if (raw.bootCommand === null) {
    patch.bootCommand = null;
  } else if (typeof raw.bootCommand === 'string') {
    patch.bootCommand = raw.bootCommand;
  }
  const updated = updateTerminalRecord(sessionId, patch);
  if (!updated) throw error(404, 'terminal not found');
  if (Object.prototype.hasOwnProperty.call(patch, 'agentKind')) {
    setTerminalAgentKind(sessionId, patch.agentKind as string | null);
  }
  const terminalRow = getTerminalById(sessionId);
  return json({
    sessionId, name: updated.name,
    autoForwardRoomId: updated.auto_forward_room_id,
    autoForwardChat: updated.auto_forward_chat,
    agentKind: terminalRow?.agent_kind ?? updated.agent_kind,
    createdBy: updated.created_by,
    allowlist: parseAllowlist(updated.allowlist),
    handle: updated.handle,
    derivedHandle: deriveHandle(updated),
    bootCommand: updated.boot_command,
    updatedAtMs: updated.updated_at_ms
  });
};
