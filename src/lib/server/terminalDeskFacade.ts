/**
 * Port audit (2026-06-19): source
 * codex/desk-core-model:src/lib/server/terminalDeskCore.ts lines 56-443
 * and 545-1000.
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
  setTerminalAccountType,
  setTerminalAgentKind,
  setTerminalLastPath,
  setTerminalModelFamily,
  type TerminalRow
} from './terminalsStore';
import {
  isTerminalDeliveryMode,
  isTerminalDeliveryTargetMode,
  readTerminalDeliveryMode,
  readTerminalDeliveryTargetMode,
  type TerminalDeliveryMode,
  type TerminalDeliveryTargetMode
} from './terminalDeliveryMode';
import { moveHandleClaimToTerminal } from './terminalHandleClaimStore';
import { updateTerminalRecord } from './terminalRecordsStore';
import {
  bindHandle,
  getLiveBindingByPane,
  tombstoneBinding
} from './handleBindingsStore';
import { appendLedger } from './identityLedgerStore';
import { getIdentityDb } from './db';

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

export type TerminalDeskPaneMutationResult = {
  desk: TerminalDesk;
  binding: TerminalDeskPaneBinding;
  tombstoned: boolean;
};

export type TerminalDeskCliProfileMutationResult = {
  desk: TerminalDesk;
  profile: TerminalDeskCliProfile;
  terminalRowUpdated: boolean;
};

export type TerminalDeskConfigMutationResult = {
  desk: TerminalDesk;
  config: TerminalDeskConfig;
  terminalRowUpdated: boolean;
  recordUpdated: boolean;
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

function addNormalisedHandle(target: Set<string>, raw: string | null | undefined): void {
  if (!raw) return;
  target.add(`@${raw.trim().replace(/^@+/, '')}`.toLowerCase());
}

export function canManageTerminalDesk(input: {
  actor: string;
  record: TerminalRecord;
  operatorHandle: string;
}): boolean {
  const actor = `@${input.actor.trim().replace(/^@+/, '')}`.toLowerCase();
  if (actor === `@${input.operatorHandle.trim().replace(/^@+/, '')}`.toLowerCase()) return true;
  const allowed = new Set<string>();
  addNormalisedHandle(allowed, input.record.created_by);
  addNormalisedHandle(allowed, input.record.handle);
  for (const coOwner of parseAllowlist(input.record.allowlist) ?? []) {
    addNormalisedHandle(allowed, coOwner);
  }
  const handleRow = input.record.handle ? getHandleRow(input.record.handle) : null;
  for (const owner of handleRow?.owners ?? []) {
    addNormalisedHandle(allowed, owner);
  }
  return allowed.size === 0 || allowed.has(actor);
}

function requireRecord(deskId: string): TerminalRecord {
  const record = getTerminalRecord(deskId);
  if (!record) throw new TerminalDeskError(404, 'Desk not found.');
  return record;
}

function requiredTextOrThrow(rawValue: unknown, label: string): string {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    throw new TerminalDeskError(400, `${label} required.`);
  }
  return rawValue.trim();
}

function optionalIntegerOrNull(rawValue: unknown, label: string): number | null {
  if (rawValue === undefined || rawValue === null) return null;
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    throw new TerminalDeskError(400, `${label} must be a number when supplied.`);
  }
  return Math.trunc(rawValue);
}

function optionalTextOrNull(rawValue: unknown, label: string): string | null {
  if (rawValue === undefined || rawValue === null) return null;
  if (typeof rawValue !== 'string') throw new TerminalDeskError(400, `${label} must be text when supplied.`);
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalTextPatch(rawValue: unknown, label: string): { provided: boolean; value: string | null } {
  if (rawValue === undefined) return { provided: false, value: null };
  return { provided: true, value: optionalTextOrNull(rawValue, label) };
}

function pickAliasPatch(input: {
  primary: unknown;
  alias: unknown;
  primaryLabel: string;
  aliasLabel: string;
}): { provided: boolean; value: unknown } {
  const primaryProvided = input.primary !== undefined;
  const aliasProvided = input.alias !== undefined;
  if (primaryProvided && aliasProvided && input.primary !== input.alias) {
    throw new TerminalDeskError(400, `${input.primaryLabel} and ${input.aliasLabel} must match when both are supplied.`);
  }
  if (primaryProvided) return { provided: true, value: input.primary };
  if (aliasProvided) return { provided: true, value: input.alias };
  return { provided: false, value: undefined };
}

function configTextValue(rawValue: unknown, label: string): string {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    throw new TerminalDeskError(400, `${label} must be text.`);
  }
  return rawValue.trim();
}

function persistenceOrThrow(rawValue: unknown): TerminalPersistencePolicy {
  const value = configTextValue(rawValue, 'persistence');
  if (value === '1h' || value === '24h' || value === '7d' || value === 'forever') return value;
  throw new TerminalDeskError(400, 'persistence must be one of 1h | 24h | 7d | forever.');
}

function killDefaultOrThrow(rawValue: unknown): TerminalKillDefault {
  const value = configTextValue(rawValue, 'defaultKillAction');
  if (value === 'prompt' || value === 'archive' || value === 'delete' || value === 'just-kill') return value;
  throw new TerminalDeskError(400, 'defaultKillAction must be one of prompt | archive | delete | just-kill.');
}

function deliveryModeOrThrow(rawValue: unknown): TerminalDeliveryMode {
  if (isTerminalDeliveryMode(rawValue)) return rawValue;
  throw new TerminalDeskError(400, 'messageDelivery must be inject, queue_raw, or queue_summarise.');
}

function deliveryTargetOrThrow(rawValue: unknown): TerminalDeliveryTargetMode {
  if (isTerminalDeliveryTargetMode(rawValue)) return rawValue;
  throw new TerminalDeskError(400, 'deliveryTarget must be room_flow or handle_only.');
}

function coOwnersOrThrow(rawValue: unknown): string[] {
  if (rawValue === null) return [];
  if (!Array.isArray(rawValue)) throw new TerminalDeskError(400, 'coOwners must be an array of handles.');
  return normaliseHandleList(rawValue).map((handle) => handle.toLowerCase()).sort();
}

function writeGrantsOrThrow(rawValue: unknown): TerminalWriteGrant[] {
  if (rawValue === null) return [];
  if (!Array.isArray(rawValue)) throw new TerminalDeskError(400, 'writeGrants must be an array.');
  const grants = rawValue.map((grant, index): TerminalWriteGrant => {
    if (!grant || typeof grant !== 'object') {
      throw new TerminalDeskError(400, `writeGrants[${index}] must be an object.`);
    }
    const rawHandle = (grant as { handle?: unknown }).handle;
    if (typeof rawHandle !== 'string') {
      throw new TerminalDeskError(400, `writeGrants[${index}].handle must be a handle.`);
    }
    const handle = normaliseHandle(rawHandle)?.toLowerCase();
    const mode = (grant as { mode?: unknown }).mode;
    if (!handle) throw new TerminalDeskError(400, `writeGrants[${index}].handle must be a handle.`);
    if (mode !== 'read' && mode !== 'read_write') {
      throw new TerminalDeskError(400, `writeGrants[${index}].mode must be read or read_write.`);
    }
    return { handle, mode };
  });
  return [...new Map(grants.map((grant) => [`${grant.handle}:${grant.mode}`, grant])).values()]
    .sort((a, b) => a.handle.localeCompare(b.handle) || a.mode.localeCompare(b.mode));
}

function writeTerminalMeta(deskId: string, meta: Record<string, unknown>, atMs: number): boolean {
  const result = getIdentityDb().prepare(
    `UPDATE terminals SET meta = ?, updated_at = ? WHERE id = ?`
  ).run(JSON.stringify(meta), Math.floor(atMs / 1000), deskId);
  return result.changes > 0;
}

function accountTypePatchFromInput(
  accountTypeRaw: unknown,
  subscriptionRaw: unknown
): { provided: boolean; value: string | null } {
  const account = optionalTextPatch(accountTypeRaw, 'accountType');
  const subscription = optionalTextPatch(subscriptionRaw, 'subscription');
  if (account.provided && subscription.provided && account.value !== subscription.value) {
    throw new TerminalDeskError(400, 'accountType and subscription must match when both are supplied.');
  }
  return account.provided ? account : subscription;
}

function activeDeskRecordForPane(pane: string): TerminalRecord | null {
  const row = getIdentityDb()
    .prepare(
      `SELECT * FROM terminal_records
        WHERE tmux_target_pane = ?
          AND superseded_at_ms IS NULL
        ORDER BY created_at_ms DESC
        LIMIT 1`
    )
    .get(pane) as TerminalRecord | undefined;
  return row ?? null;
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

export function bindDeskPane(input: {
  deskId: string;
  pane: unknown;
  pid?: unknown;
  pidStart?: unknown;
  actor: string;
  atMs?: number;
}): TerminalDeskPaneMutationResult {
  const record = requireRecord(input.deskId);
  if (!record.handle) throw new TerminalDeskError(409, 'Desk needs an ANThandle claim before binding a pane.');
  const pane = requiredTextOrThrow(input.pane, 'pane');
  const pid = optionalIntegerOrNull(input.pid, 'pid');
  const pidStart = optionalTextOrNull(input.pidStart, 'pidStart');
  const nowMs = input.atMs ?? Date.now();
  const boundPane = getLiveBindingByPane(pane);
  if (boundPane && boundPane.terminal_id !== input.deskId) {
    throw new TerminalDeskError(409, `Pane ${pane} is already bound to ${boundPane.handle}.`);
  }
  const existingPaneDesk = activeDeskRecordForPane(pane);
  if (existingPaneDesk && existingPaneDesk.session_id !== input.deskId) {
    throw new TerminalDeskError(409, `Pane ${pane} already belongs to Desk ${existingPaneDesk.session_id}.`);
  }
  const updated = updateTerminalRecord(input.deskId, { tmuxTargetPane: pane });
  if (!updated) throw new TerminalDeskError(404, 'Desk not found.');
  bindHandle({
    handle: record.handle,
    pane,
    pid,
    pidStart,
    spawnedBy: input.actor,
    terminalId: input.deskId,
    atMs: nowMs
  });
  const desk = getTerminalDesk(input.deskId);
  if (!desk) throw new TerminalDeskError(404, 'Desk not found.');
  return { desk, binding: desk.activeBinding, tombstoned: false };
}

export function tombstoneDeskPane(input: {
  deskId: string;
  actor: string;
  reason?: unknown;
  atMs?: number;
}): TerminalDeskPaneMutationResult {
  const record = requireRecord(input.deskId);
  if (!record.handle) throw new TerminalDeskError(409, 'Desk has no ANThandle claim to tombstone.');
  const nowMs = input.atMs ?? Date.now();
  const reason = optionalTextOrNull(input.reason, 'reason') ?? 'pane-not-found';
  const tombstoned = tombstoneBinding(record.handle, reason, nowMs);
  appendLedger({
    kind: 'desk.binding_tombstoned',
    handle: record.handle,
    actor: input.actor,
    atMs: nowMs,
    detail: {
      desk_id: input.deskId,
      reason,
      tombstoned
    }
  });
  const desk = getTerminalDesk(input.deskId);
  if (!desk) throw new TerminalDeskError(404, 'Desk not found.');
  return { desk, binding: desk.activeBinding, tombstoned };
}

export function swapDeskCliProfile(input: {
  deskId: string;
  actor: string;
  cli?: unknown;
  accountType?: unknown;
  subscription?: unknown;
  modelFamily?: unknown;
  rootFolder?: unknown;
  bootCommand?: unknown;
  cliSessionId?: unknown;
  cliSessionSource?: unknown;
  atMs?: number;
}): TerminalDeskCliProfileMutationResult {
  const record = requireRecord(input.deskId);
  const cli = optionalTextPatch(input.cli, 'cli');
  const accountType = accountTypePatchFromInput(input.accountType, input.subscription);
  const modelFamily = optionalTextPatch(input.modelFamily, 'modelFamily');
  const rootFolder = optionalTextPatch(input.rootFolder, 'rootFolder');
  const bootCommand = optionalTextPatch(input.bootCommand, 'bootCommand');
  const cliSessionId = optionalTextPatch(input.cliSessionId, 'cliSessionId');
  const cliSessionSource = optionalTextPatch(input.cliSessionSource, 'cliSessionSource');

  const recordPatch: Parameters<typeof updateTerminalRecord>[1] = {};
  if (cli.provided) recordPatch.agentKind = cli.value;
  if (bootCommand.provided) recordPatch.bootCommand = bootCommand.value;
  if (cliSessionId.provided) {
    recordPatch.cliSessionId = cliSessionId.value;
    recordPatch.cliSessionSource = cliSessionSource.provided ? cliSessionSource.value : record.cli_session_source;
  } else if (cliSessionSource.provided) {
    recordPatch.cliSessionId = record.cli_session_id;
    recordPatch.cliSessionSource = cliSessionSource.value;
  }
  if (Object.keys(recordPatch).length > 0 && !updateTerminalRecord(input.deskId, recordPatch)) {
    throw new TerminalDeskError(404, 'Desk not found.');
  }

  let terminalRowUpdated = false;
  const terminal = getTerminalById(input.deskId);
  if (terminal) {
    if (cli.provided) terminalRowUpdated = setTerminalAgentKind(input.deskId, cli.value) || terminalRowUpdated;
    if (accountType.provided) terminalRowUpdated = setTerminalAccountType(input.deskId, accountType.value) || terminalRowUpdated;
    if (modelFamily.provided) terminalRowUpdated = setTerminalModelFamily(input.deskId, modelFamily.value) || terminalRowUpdated;
    if (rootFolder.provided) terminalRowUpdated = setTerminalLastPath(input.deskId, rootFolder.value) || terminalRowUpdated;
  }

  appendLedger({
    kind: 'cli_profile.swapped',
    handle: record.handle,
    actor: input.actor,
    atMs: input.atMs ?? Date.now(),
    detail: {
      desk_id: input.deskId,
      changed: {
        cli: cli.provided,
        account_type: accountType.provided,
        model_family: modelFamily.provided,
        root_folder: rootFolder.provided,
        boot_command: bootCommand.provided,
        cli_session_id: cliSessionId.provided,
        cli_session_source: cliSessionSource.provided
      },
      terminal_row_updated: terminalRowUpdated
    }
  });

  const desk = getTerminalDesk(input.deskId);
  if (!desk) throw new TerminalDeskError(404, 'Desk not found.');
  return { desk, profile: desk.cliProfile, terminalRowUpdated };
}

export function updateDeskConfig(input: {
  deskId: string;
  actor: string;
  persistence?: unknown;
  coOwners?: unknown;
  writeGrants?: unknown;
  defaultKillAction?: unknown;
  killDefault?: unknown;
  messageDelivery?: unknown;
  deliveryMode?: unknown;
  deliveryTarget?: unknown;
  deliveryTargetMode?: unknown;
  atMs?: number;
}): TerminalDeskConfigMutationResult {
  const record = requireRecord(input.deskId);
  const terminal = getTerminalById(input.deskId);
  const meta = parseMeta(terminal?.meta);
  const nextMeta: Record<string, unknown> = { ...meta };
  const changed: Record<string, boolean> = {};
  let recordUpdated = false;
  let terminalMetaNeedsWrite = false;

  if (input.persistence !== undefined) {
    nextMeta.persistence = persistenceOrThrow(input.persistence);
    changed.persistence = true;
    terminalMetaNeedsWrite = true;
  }
  if (input.coOwners !== undefined) {
    const coOwners = coOwnersOrThrow(input.coOwners);
    const updated = updateTerminalRecord(input.deskId, { allowlist: coOwners });
    if (!updated) throw new TerminalDeskError(404, 'Desk not found.');
    nextMeta.coOwners = coOwners;
    changed.coOwners = true;
    recordUpdated = true;
    terminalMetaNeedsWrite = terminal !== null;
  }
  if (input.writeGrants !== undefined) {
    nextMeta.writeGrants = writeGrantsOrThrow(input.writeGrants);
    changed.writeGrants = true;
    terminalMetaNeedsWrite = true;
  }

  const killDefault = pickAliasPatch({
    primary: input.defaultKillAction,
    alias: input.killDefault,
    primaryLabel: 'defaultKillAction',
    aliasLabel: 'killDefault'
  });
  if (killDefault.provided) {
    nextMeta.killDefault = killDefaultOrThrow(killDefault.value);
    changed.defaultKillAction = true;
    terminalMetaNeedsWrite = true;
  }

  const deliveryMode = pickAliasPatch({
    primary: input.messageDelivery,
    alias: input.deliveryMode,
    primaryLabel: 'messageDelivery',
    aliasLabel: 'deliveryMode'
  });
  if (deliveryMode.provided) {
    nextMeta.deliveryMode = deliveryModeOrThrow(deliveryMode.value);
    changed.messageDelivery = true;
    terminalMetaNeedsWrite = true;
  }

  const deliveryTarget = pickAliasPatch({
    primary: input.deliveryTarget,
    alias: input.deliveryTargetMode,
    primaryLabel: 'deliveryTarget',
    aliasLabel: 'deliveryTargetMode'
  });
  if (deliveryTarget.provided) {
    nextMeta.deliveryTargetMode = deliveryTargetOrThrow(deliveryTarget.value);
    changed.deliveryTarget = true;
    terminalMetaNeedsWrite = true;
  }

  if (Object.keys(changed).length === 0) {
    throw new TerminalDeskError(400, 'At least one config field is required.');
  }
  if (terminalMetaNeedsWrite && !terminal) {
    throw new TerminalDeskError(409, 'Desk has no backing terminal row for meta-backed config fields.');
  }
  const atMs = input.atMs ?? Date.now();
  const terminalRowUpdated = terminalMetaNeedsWrite
    ? writeTerminalMeta(input.deskId, nextMeta, atMs)
    : false;

  appendLedger({
    kind: 'desk.config_updated',
    handle: record.handle,
    actor: input.actor,
    atMs,
    detail: {
      desk_id: input.deskId,
      changed,
      terminal_row_updated: terminalRowUpdated,
      record_updated: recordUpdated
    }
  });
  const desk = getTerminalDesk(input.deskId);
  if (!desk) throw new TerminalDeskError(404, 'Desk not found.');
  return { desk, config: desk.config, terminalRowUpdated, recordUpdated };
}
