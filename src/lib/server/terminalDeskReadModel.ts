import type { TerminalRecord } from './terminalRecordsStore';
import { deriveHandle, parseAllowlist } from './terminalRecordsStore';
import type { TerminalRow } from './terminalsStore';
import { getHandleRow, getLiveBinding } from './handleBindingsStore';
import {
  readTerminalDeliveryMode,
  readTerminalDeliveryTargetMode
} from './terminalDeliveryMode';

export type DeskLifecycle = 'active' | 'parked' | 'retired' | 'deleted';
export type PaneBindingState = 'bound' | 'moved' | 'unwitnessed' | 'unclaimed' | 'parked';

export type TerminalDeskReadModel = {
  desk: {
    id: string;
    name: string;
    lifecycle: DeskLifecycle;
    ownerHandles: string[];
    createdBy: string | null;
    createdAtMs: number;
    updatedAtMs: number;
  };
  antHandleClaim: {
    handle: string;
    lifecycle: 'active' | 'retired' | 'deleted' | null;
    owners: string[];
    source: 'handles' | 'terminal_record';
    createdBy: string | null;
    createdAtMs: number | null;
    vacatedAtMs: number | null;
  } | null;
  paneBinding: {
    state: PaneBindingState;
    witnessed: boolean;
    handle: string | null;
    tmuxPane: string | null;
    pid: number | null;
    pidStart: string | null;
    terminalId: string;
    boundAtMs: number | null;
    tombstonedAtMs: number | null;
  };
  cliProfile: {
    cliType: string | null;
    accountType: string | null;
    cliFamily: string | null;
    rootFolder: string | null;
    bootCommand: string | null;
    cliSessionId: string | null;
    cliSessionSource: string | null;
  };
  terminalConfig: {
    coOwners: string[];
    messageDeliveryType: 'inject' | 'queue_raw' | 'queue_summarise';
    deliveryTargetType: 'room_flow' | 'handle_only';
    autoForwardRoomId: string | null;
    autoForwardChat: number;
    linkedChatRoomId: string | null;
    currentStatus: string | null;
    paneStatus: string | null;
  };
};

export function buildTerminalDeskReadModel(input: {
  record: TerminalRecord;
  terminalRow?: TerminalRow | null;
  alive: boolean;
  accountType?: string | null;
  modelFamily?: string | null;
  agentKind?: string | null;
}): TerminalDeskReadModel {
  const { record, terminalRow = null, alive } = input;
  const explicitHandle = record.handle && record.handle.trim().length > 0 ? record.handle : null;
  const handleRow = explicitHandle ? getHandleRow(explicitHandle) : null;
  const liveBinding = explicitHandle ? getLiveBinding(explicitHandle) : null;
  const bindingBelongsToDesk =
    liveBinding !== null &&
    (liveBinding.terminal_id === record.session_id ||
      (record.tmux_target_pane !== null && liveBinding.pane === record.tmux_target_pane));
  const coOwners = parseAllowlist(record.allowlist) ?? [];
  const ownerHandles = handleRow?.owners ?? coOwners;
  const paneState: PaneBindingState = liveBinding
    ? (bindingBelongsToDesk ? 'bound' : 'moved')
    : explicitHandle
      ? (alive ? 'unwitnessed' : 'parked')
      : (alive ? 'unclaimed' : 'parked');

  return {
    desk: {
      id: record.session_id,
      name: record.name,
      lifecycle: lifecycleFor(record, terminalRow, alive, bindingBelongsToDesk),
      ownerHandles,
      createdBy: record.created_by,
      createdAtMs: record.created_at_ms,
      updatedAtMs: record.updated_at_ms
    },
    antHandleClaim: explicitHandle
      ? {
          handle: explicitHandle,
          lifecycle: handleRow?.lifecycle ?? null,
          owners: handleRow?.owners ?? coOwners,
          source: handleRow ? 'handles' : 'terminal_record',
          createdBy: handleRow?.created_by ?? record.created_by,
          createdAtMs: handleRow?.created_at_ms ?? null,
          vacatedAtMs: handleRow?.vacated_at_ms ?? null
        }
      : null,
    paneBinding: {
      state: paneState,
      witnessed: bindingBelongsToDesk,
      handle: explicitHandle,
      tmuxPane: bindingBelongsToDesk ? liveBinding?.pane ?? null : record.tmux_target_pane,
      pid: bindingBelongsToDesk ? liveBinding?.pid ?? null : terminalRow?.pid ?? null,
      pidStart: bindingBelongsToDesk ? liveBinding?.pid_start ?? null : terminalRow?.pid_start ?? null,
      terminalId: record.session_id,
      boundAtMs: bindingBelongsToDesk ? liveBinding?.bound_at_ms ?? null : null,
      tombstonedAtMs: bindingBelongsToDesk ? liveBinding?.tombstoned_at_ms ?? null : null
    },
    cliProfile: {
      cliType: input.agentKind ?? terminalRow?.agent_kind ?? record.agent_kind,
      accountType: input.accountType ?? null,
      cliFamily: input.modelFamily ?? null,
      rootFolder: terminalRow?.last_path ?? null,
      bootCommand: record.boot_command,
      cliSessionId: record.cli_session_id,
      cliSessionSource: record.cli_session_source
    },
    terminalConfig: {
      coOwners,
      messageDeliveryType: readTerminalDeliveryMode(terminalRow?.meta),
      deliveryTargetType: readTerminalDeliveryTargetMode(terminalRow?.meta),
      autoForwardRoomId: record.auto_forward_room_id,
      autoForwardChat: record.auto_forward_chat,
      linkedChatRoomId: record.linked_chat_room_id,
      currentStatus: terminalRow?.agent_status ?? null,
      paneStatus: terminalRow?.pane_status ?? null
    }
  };
}

function lifecycleFor(
  record: TerminalRecord,
  terminalRow: TerminalRow | null,
  alive: boolean,
  bindingBelongsToDesk: boolean
): DeskLifecycle {
  if (terminalRow?.status === 'deleted') return 'deleted';
  if (terminalRow?.status === 'archived') return 'retired';
  if (alive || bindingBelongsToDesk) return 'active';
  if (record.superseded_at_ms !== null) return 'retired';
  return 'parked';
}
