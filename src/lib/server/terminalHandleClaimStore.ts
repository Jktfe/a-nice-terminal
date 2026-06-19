import { getIdentityDb } from './db';
import { appendLedger } from './identityLedgerStore';
import { validateHandleForRegistration } from './handleValidation';
import { getHandleRow, bindHandle, ensureHandleOwnedBy, tombstoneBinding } from './handleBindingsStore';
import { getTerminalRecord, type TerminalRecord } from './terminalRecordsStore';
import { getTerminalById } from './terminalsStore';

export type TerminalHandleClaimMoveResult = {
  handle: string;
  targetTerminalId: string;
  previousTerminalIds: string[];
  replacedHandle: string | null;
  binding: {
    bound: boolean;
    pane: string | null;
    pid: number | null;
    pidStart: string | null;
    bindingId: number | null;
  };
};

export function moveHandleClaimToTerminal(input: {
  rawHandle: string;
  targetTerminalId: string;
  actor: string;
  reason?: string | null;
  atMs?: number;
}): TerminalHandleClaimMoveResult {
  const validation = validateHandleForRegistration(input.rawHandle);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  const handle = validation.canonicalHandle;
  const nowMs = input.atMs ?? Date.now();
  const db = getIdentityDb();
  const moveClaim = db.transaction((): TerminalHandleClaimMoveResult => {
    const target = getTerminalRecord(input.targetTerminalId);
    if (!target) {
      throw new Error(`terminal not found: ${input.targetTerminalId}`);
    }
    const previousRows = db
      .prepare(`SELECT session_id FROM terminal_records WHERE handle = ? AND session_id != ?`)
      .all(handle, input.targetTerminalId) as { session_id: string }[];
    const previousTerminalIds = previousRows.map((row) => row.session_id);
    const replacedHandle = target.handle && target.handle !== handle ? target.handle : null;

    if (previousTerminalIds.length > 0) {
      const placeholders = previousTerminalIds.map(() => '?').join(',');
      db.prepare(
        `UPDATE terminal_records
            SET handle = NULL, updated_at_ms = ?
          WHERE session_id IN (${placeholders})`
      ).run(nowMs, ...previousTerminalIds);
    }
    db.prepare(
      `UPDATE terminal_records SET handle = ?, updated_at_ms = ? WHERE session_id = ?`
    ).run(handle, nowMs, input.targetTerminalId);

    if (replacedHandle) {
      tombstoneBinding(replacedHandle, 'replaced-by-handle-move', nowMs);
    }

    ensureHandleOwnedBy(handle, input.actor, {
      actor: input.actor,
      reason: input.reason ?? 'handle-move',
      atMs: nowMs
    });

    const binding = bindHandleToTargetPane({
      handle,
      target,
      actor: input.actor,
      atMs: nowMs
    });

    appendLedger({
      kind: 'handle.moved',
      handle,
      actor: input.actor,
      atMs: nowMs,
      detail: {
        reason: input.reason ?? 'handle-move',
        target_terminal_id: input.targetTerminalId,
        previous_terminal_ids: previousTerminalIds,
        replaced_handle: replacedHandle,
        binding_bound: binding.bound,
        pane: binding.pane,
        pid: binding.pid
      }
    });

    return {
      handle,
      targetTerminalId: input.targetTerminalId,
      previousTerminalIds,
      replacedHandle,
      binding
    };
  });

  return moveClaim();
}

export function canMoveHandleClaim(input: {
  callerHandle: string;
  targetRecord: TerminalRecord;
  rawHandle: string;
  operatorHandle: string;
}): boolean {
  const caller = normaliseHandle(input.callerHandle);
  if (caller === normaliseHandle(input.operatorHandle)) return true;
  const validation = validateHandleForRegistration(input.rawHandle);
  if (!validation.ok) return false;
  const handleRow = getHandleRow(validation.canonicalHandle);
  const allowed = new Set<string>();
  addHandle(allowed, input.targetRecord.created_by);
  addHandle(allowed, input.targetRecord.handle);
  for (const owner of parseJsonHandleList(input.targetRecord.allowlist)) {
    addHandle(allowed, owner);
  }
  for (const owner of handleRow?.owners ?? []) {
    addHandle(allowed, owner);
  }
  return allowed.has(caller);
}

function bindHandleToTargetPane(input: {
  handle: string;
  target: TerminalRecord;
  actor: string;
  atMs: number;
}): TerminalHandleClaimMoveResult['binding'] {
  const terminal = getTerminalById(input.target.session_id);
  if (!terminal || !input.target.tmux_target_pane) {
    return {
      bound: false,
      pane: input.target.tmux_target_pane,
      pid: terminal?.pid ?? null,
      pidStart: terminal?.pid_start ?? null,
      bindingId: null
    };
  }
  const row = bindHandle({
    handle: input.handle,
    pane: input.target.tmux_target_pane,
    pid: terminal.pid,
    pidStart: terminal.pid_start,
    spawnedBy: input.actor,
    terminalId: input.target.session_id,
    atMs: input.atMs
  });
  return {
    bound: true,
    pane: row.pane,
    pid: row.pid,
    pidStart: row.pid_start,
    bindingId: row.id
  };
}

function addHandle(target: Set<string>, raw: string | null | undefined): void {
  if (!raw) return;
  target.add(normaliseHandle(raw));
}

function normaliseHandle(raw: string): string {
  return `@${raw.trim().replace(/^@+/, '')}`.toLowerCase();
}

function parseJsonHandleList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}
