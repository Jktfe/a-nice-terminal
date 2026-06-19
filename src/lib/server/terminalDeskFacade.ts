/**
 * Port audit (2026-06-19): source
 * codex/desk-core-model:src/lib/server/terminalDeskCore.ts lines 56-443.
 * Verdict: CHANGE. vNext simplification: this file is only the deployed
 * /api/desks facade over today's terminal tables plus the atomic handle-move
 * verb; the branch-only lifecycle/config/binding verbs stay out until each
 * lands as a separate contract slice.
 */

import {
  deriveHandle,
  getTerminalRecord,
  listTerminalRecords,
  parseAllowlist,
  type TerminalRecord
} from './terminalRecordsStore';
import {
  getHandleRow,
  getLiveBinding,
  getLiveBindingByTerminal,
  type HandleBindingRow,
  type HandleLifecycle,
  type HandleRow
} from './handleBindingsStore';
import {
  getTerminalById,
  listTerminalClassByIds,
  listTerminalRowsByIds,
  type TerminalRow
} from './terminalsStore';
import {
  readTerminalDeliveryMode,
  readTerminalDeliveryTargetMode,
  type TerminalDeliveryMode,
  type TerminalDeliveryTargetMode
} from './terminalDeliveryMode';
import { moveHandleClaimToTerminal } from './terminalHandleClaimStore';

export type TerminalDeskLifecycle = 'active' | 'parked' | 'retired' | 'deleted';
export type TerminalPaneBindingState = 'bound' | 'unwitnessed' | 'missing';
export type TerminalPaneBindingSource = 'handle_binding' | 'terminal_record' | 'none';
export type TerminalPersistencePolicy = '1h' | '24h' | '7d' | 'forever';
export type TerminalKillDefault = 'prompt' | 'archive' | 'delete' | 'just-kill';
export type TerminalWriteGrant = { handle: string; mode: 'read' | 'read_write' };

export type TerminalDeskClaim = {
  handle: string;
  lifecycle: HandleLifecycle;
  owners: string[];
  vacatedAtMs: number | null;
  createdAtMs: number | null;
  createdBy: string | null;
};

export type TerminalDeskPaneBinding = {
  state: TerminalPaneBindingState;
  source: TerminalPaneBindingSource;
  bindingId: number | null;
  terminalId: string;
  pane: string | null;
  pid: number | null;
  pidStart: string | null;
  boundAtMs: number | null;
  tombstonedAtMs: number | null;
  tombstoneReason: string | null;
};

export type TerminalDeskCliProfile = {
  cli: string | null;
  accountType: string | null;
  modelFamily: string | null;
  bootCommand: string | null;
  cliSessionId: string | null;
  cliSessionSource: string | null;
  rootFolder: string | null;
  contextFill: number | null;
};

export type TerminalDeskConfig = {
  persistence: TerminalPersistencePolicy;
  messageDelivery: TerminalDeliveryMode;
  deliveryTarget: TerminalDeliveryTargetMode;
  defaultKillAction: TerminalKillDefault;
  coOwners: string[];
  writeGrants: TerminalWriteGrant[];
};

export type TerminalDesk = {
  deskId: string;
  name: string;
  displayHandle: string;
  lifecycle: TerminalDeskLifecycle;
  owners: string[];
  claim: TerminalDeskClaim | null;
  activeBinding: TerminalDeskPaneBinding;
  cliProfile: TerminalDeskCliProfile;
  config: TerminalDeskConfig;
  linkedChatRoomId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export class TerminalDeskError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type TerminalDeskHandleMutationResult = {
  desk: TerminalDesk;
  handle: string;
  movedFromDeskId: string | null;
};

type TerminalClass = {
  accountType: string | null;
  modelFamily: string | null;
};

function parseMeta(metaRaw: string | null | undefined): Record<string, unknown> {
  if (!metaRaw) return {};
  try {
    const parsed = JSON.parse(metaRaw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normaliseHandle(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function normaliseHandleList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const handle = normaliseHandle(value);
    if (handle) seen.add(handle);
  }
  return [...seen].sort();
}

function readPersistence(meta: Record<string, unknown>): TerminalPersistencePolicy {
  return meta.persistence === '1h'
    || meta.persistence === '24h'
    || meta.persistence === '7d'
    || meta.persistence === 'forever'
    ? meta.persistence
    : 'forever';
}

function readKillDefault(meta: Record<string, unknown>): TerminalKillDefault {
  return meta.killDefault === 'archive'
    || meta.killDefault === 'delete'
    || meta.killDefault === 'just-kill'
    || meta.killDefault === 'prompt'
    ? meta.killDefault
    : 'prompt';
}

function readWriteGrants(meta: Record<string, unknown>): TerminalWriteGrant[] {
  if (!Array.isArray(meta.writeGrants)) return [];
  return meta.writeGrants.flatMap((grant): TerminalWriteGrant[] => {
    if (!grant || typeof grant !== 'object') return [];
    const rawHandle = (grant as { handle?: unknown }).handle;
    const rawMode = (grant as { mode?: unknown }).mode;
    if (typeof rawHandle !== 'string') return [];
    const handle = normaliseHandle(rawHandle)?.toLowerCase();
    if (!handle) return [];
    if (rawMode !== 'read' && rawMode !== 'read_write') return [];
    return [{ handle, mode: rawMode }];
  }).sort((a, b) => a.handle.localeCompare(b.handle) || a.mode.localeCompare(b.mode));
}

function claimFromRows(handle: string | null, row: HandleRow | null): TerminalDeskClaim | null {
  if (!handle) return null;
  return {
    handle,
    lifecycle: row?.lifecycle ?? 'active',
    owners: [...(row?.owners ?? [])].sort(),
    vacatedAtMs: row?.vacated_at_ms ?? null,
    createdAtMs: row?.created_at_ms ?? null,
    createdBy: row?.created_by ?? null
  };
}

function liveBindingForRecord(record: TerminalRecord): HandleBindingRow | null {
  const byTerminal = getLiveBindingByTerminal(record.session_id);
  if (byTerminal) return byTerminal;
  if (!record.handle) return null;
  const byHandle = getLiveBinding(record.handle);
  if (!byHandle) return null;
  if (byHandle.terminal_id === null || byHandle.terminal_id === record.session_id) return byHandle;
  return null;
}

function bindingFromRows(
  record: TerminalRecord,
  terminal: TerminalRow | null,
  binding: HandleBindingRow | null
): TerminalDeskPaneBinding {
  if (binding) {
    return {
      state: 'bound',
      source: 'handle_binding',
      bindingId: binding.id,
      terminalId: record.session_id,
      pane: binding.pane,
      pid: binding.pid,
      pidStart: binding.pid_start,
      boundAtMs: binding.bound_at_ms,
      tombstonedAtMs: binding.tombstoned_at_ms,
      tombstoneReason: binding.tombstone_reason
    };
  }

  if (record.handle) {
    return {
      state: 'missing',
      source: 'none',
      bindingId: null,
      terminalId: record.session_id,
      pane: null,
      pid: null,
      pidStart: null,
      boundAtMs: null,
      tombstonedAtMs: null,
      tombstoneReason: null
    };
  }

  const pane = record.tmux_target_pane ?? terminal?.tmux_target_pane ?? null;
  return {
    state: pane ? 'unwitnessed' : 'missing',
    source: pane ? 'terminal_record' : 'none',
    bindingId: null,
    terminalId: record.session_id,
    pane,
    pid: terminal?.pid ?? null,
    pidStart: terminal?.pid_start ?? null,
    boundAtMs: null,
    tombstonedAtMs: null,
    tombstoneReason: null
  };
}

function lifecycleFromRows(
  record: TerminalRecord,
  terminal: TerminalRow | null,
  claim: TerminalDeskClaim | null,
  binding: TerminalDeskPaneBinding
): TerminalDeskLifecycle {
  if (terminal?.status === 'deleted') return 'deleted';
  if (claim?.lifecycle === 'deleted') return 'deleted';
  if (claim?.lifecycle === 'retired') return 'retired';
  if (claim?.vacatedAtMs !== null && claim?.vacatedAtMs !== undefined) return 'parked';
  if (terminal?.status === 'archived') return 'parked';
  if (record.superseded_at_ms !== null) return 'parked';
  if (binding.state === 'missing') return 'parked';
  return 'active';
}

function configFromRows(record: TerminalRecord, terminal: TerminalRow | null): TerminalDeskConfig {
  const meta = parseMeta(terminal?.meta);
  const coOwnersFromRecord = parseAllowlist(record.allowlist);
  return {
    persistence: readPersistence(meta),
    messageDelivery: readTerminalDeliveryMode(terminal?.meta),
    deliveryTarget: readTerminalDeliveryTargetMode(terminal?.meta),
    defaultKillAction: readKillDefault(meta),
    coOwners: coOwnersFromRecord && coOwnersFromRecord.length > 0
      ? [...coOwnersFromRecord].sort()
      : normaliseHandleList(meta.coOwners),
    writeGrants: readWriteGrants(meta)
  };
}

function ownersForDesk(record: TerminalRecord, claim: TerminalDeskClaim | null, config: TerminalDeskConfig): string[] {
  const owners = new Set<string>();
  if (record.created_by) owners.add(record.created_by);
  for (const owner of claim?.owners ?? []) owners.add(owner);
  for (const owner of config.coOwners) owners.add(owner);
  return [...owners].sort();
}

export function projectTerminalRecordToDesk(
  record: TerminalRecord,
  options: {
    terminal?: TerminalRow | null;
    terminalClass?: TerminalClass | null;
  } = {}
): TerminalDesk {
  const terminal = options.terminal ?? getTerminalById(record.session_id);
  const terminalClass = options.terminalClass ?? listTerminalClassByIds([record.session_id]).get(record.session_id) ?? null;
  const handleRow = record.handle ? getHandleRow(record.handle) : null;
  const claim = claimFromRows(record.handle, handleRow);
  const activeBinding = bindingFromRows(record, terminal, liveBindingForRecord(record));
  const config = configFromRows(record, terminal);
  const lifecycle = lifecycleFromRows(record, terminal, claim, activeBinding);

  return {
    deskId: record.session_id,
    name: record.name,
    displayHandle: deriveHandle(record),
    lifecycle,
    owners: ownersForDesk(record, claim, config),
    claim,
    activeBinding,
    cliProfile: {
      cli: terminal?.agent_kind ?? record.agent_kind ?? null,
      accountType: terminalClass?.accountType ?? null,
      modelFamily: terminalClass?.modelFamily ?? null,
      bootCommand: record.boot_command,
      cliSessionId: record.cli_session_id,
      cliSessionSource: record.cli_session_source,
      rootFolder: terminal?.last_path ?? null,
      contextFill: terminal?.agent_context_fill ?? null
    },
    config,
    linkedChatRoomId: record.linked_chat_room_id,
    createdAtMs: record.created_at_ms,
    updatedAtMs: record.updated_at_ms
  };
}

export function getTerminalDesk(deskId: string): TerminalDesk | null {
  const record = getTerminalRecord(deskId);
  if (!record) return null;
  return projectTerminalRecordToDesk(record);
}

export function listTerminalDesks(): TerminalDesk[] {
  const records = listTerminalRecords();
  const ids = records.map((record) => record.session_id);
  const terminalsById = listTerminalRowsByIds(ids);
  const classesById = listTerminalClassByIds(ids);
  return records.map((record) => projectTerminalRecordToDesk(record, {
    terminal: terminalsById.get(record.session_id) ?? null,
    terminalClass: classesById.get(record.session_id) ?? null
  }));
}

export function moveTerminalDeskHandle(input: {
  deskId: string;
  handle: string;
  actor: string;
  reason?: string | null;
}): TerminalDeskHandleMutationResult {
  try {
    const result = moveHandleClaimToTerminal({
      rawHandle: input.handle,
      targetTerminalId: input.deskId,
      actor: input.actor,
      reason: input.reason ?? 'operator-handle-move'
    });
    const desk = getTerminalDesk(input.deskId);
    if (!desk) throw new TerminalDeskError(404, 'Desk not found.');
    return {
      desk,
      handle: result.handle,
      movedFromDeskId: result.previousTerminalIds[0] ?? null
    };
  } catch (cause) {
    if (cause instanceof TerminalDeskError) throw cause;
    const message = cause instanceof Error ? cause.message : 'Could not move handle claim.';
    if (message.startsWith('terminal not found:')) throw new TerminalDeskError(404, 'Desk not found.');
    throw new TerminalDeskError(400, message);
  }
}
