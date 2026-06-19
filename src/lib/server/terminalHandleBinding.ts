import { findTerminalRecordByHandle } from './terminalRecordsStore';
import { addMembership, getTerminalIdByHandle, isCandidateStale } from './roomMembershipsStore';
import {
  adoptExternalProcessForTerminal,
  autoRegisterTerminalForSpawnedSession,
  getTerminalById,
  lookupTerminalByPidChain,
  type PidChainEntry,
  type TerminalRow
} from './terminalsStore';
import { ensureSessionForTerminal } from './antSessionStore';
import { addMember, rebindMemberSessionIfStale } from './membershipStore';
import { reclaimCleanHandleIfStale } from './roomHandleLeaseClean';
import { resolveOrNull } from './sessionResolver';
import { mirrorAddMembership } from './v02ChatRoomBridge';
import { bindHandle, getLiveBinding } from './handleBindingsStore';

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

// 0.1.8 slice B (Xeno windows-cli-auth-wedge follow-up 2026-05-22):
// liveness check on the existing binding. Without this, a broken-walker
// register (pre-0.1.6 Windows or any POSIX ps failure) leaves a terminal
// row with pid_start: null bound to the room_memberships entry; any
// subsequent register with a working walker silently no-ops on the
// early-return, leaving the user wedged. Yesterday's xenocc-windows
// row from 0.1.5 was exactly this shape — needed manual `ant add
// membership` to re-bind.
function isExistingTerminalStillLive(terminal: TerminalRow): boolean {
  // Broken-walker registrations leave pid_start: null (POSIX `ps` failed,
  // or pre-0.1.6 Windows walker without CIM support). Treat as dead so
  // a re-register with a working walker can supersede the binding.
  if (terminal.pid_start === null) return false;
  // Expired by TTL: caller is expected to re-register past expires_at.
  // Don't pin a stale binding against fresh identity claims.
  // expires_at is stored in UNIX SECONDS (see upsertTerminal +
  // currentUnixSeconds), so compare against seconds, not Date.now() ms.
  if (terminal.expires_at !== null && terminal.expires_at * 1000 < Date.now()) return false;
  return true;
}

/**
 * Make `ant bind` SELF-HEAL drift (2026-06-08, @speedy 0djd8b8cjq).
 *
 * bindRoomHandleToLiveTerminal historically wrote ONLY the legacy terminal-keyed
 * `room_memberships` (via addMembership). But the POST gate reads the clean
 * SESSION-keyed surfaces — `room_handle_lease` (isCleanMember) and
 * `room_membership` — so bind reported "Bound" yet the agent still 403'd ("bound
 * but can't post"), and the only fix was a manual DB lease alignment. After bind
 * resolves the genuinely-live terminal, also bind the CLEAN surfaces to that
 * terminal's durable session so the post gate resolves it.
 *
 * Reuses register's exact, tested no-hijack self-heal (PART 2): a genuinely-live
 * DIFFERENT holder keeps clean @x (reclaim/rebind are strict no-ops on it); only
 * a stale/unresolvable incumbent is re-keyed to this session. addMember covers
 * the fresh case (no clean row yet) and claims the lease. No auth gate is
 * touched — this is a WRITE that makes the existing gate find the row it requires.
 */
function selfHealCleanBinding(
  roomId: string,
  handle: string,
  terminalId: string,
  actor: string | null = null
): void {
  const terminal = getTerminalById(terminalId);
  if (terminal) {
    const currentBinding = getLiveBinding(handle);
    if (
      currentBinding?.terminal_id !== terminal.id ||
      currentBinding.pane !== terminal.tmux_target_pane ||
      currentBinding.pid !== terminal.pid ||
      currentBinding.pid_start !== terminal.pid_start
    ) {
      bindHandle({
        handle,
        pane: terminal.tmux_target_pane,
        pid: terminal.pid,
        pidStart: terminal.pid_start,
        spawnedBy: actor,
        terminalId: terminal.id
      });
    }
  }

  const session = ensureSessionForTerminal({ terminalId });
  // Ensure a clean membership row exists (+ claim lease) for the fresh case.
  // On a stale-but-non-null incumbent this no-ops the session (hijack guard);
  // the reclaim/rebind below then re-keys it. Order: create → re-key lease →
  // re-key membership, so the row exists before rebind tries to update it.
  addMember(roomId, handle, session.id);
  const isHolderStale = (holderSessionId: string): boolean => {
    const holder = resolveOrNull(holderSessionId);
    if (!holder) return true;
    const holderTerminal = holder.terminal_id ? getTerminalById(holder.terminal_id) : null;
    return !holderTerminal || isCandidateStale(holderTerminal, Date.now());
  };
  const reclaimed = reclaimCleanHandleIfStale(roomId, handle, session.id, isHolderStale);
  if (reclaimed !== null) {
    rebindMemberSessionIfStale(roomId, handle, session.id, isHolderStale);
  }
  // 4th surface (2026-06-08, @speedy): the v0.2 `memberships` roster (read by
  // /typing + roster, keyed by handle→agent) is separate from the lease +
  // clean membership above. Without reopening it, an agent self-heals POST
  // access but /typing + roster still 404 "not a member". mirrorAddMembership
  // is handle-keyed + best-effort (swallows its own errors) and reopens a left
  // membership by inserting a fresh active row. (That FOUR surfaces must be
  // kept in lockstep is the standing argument for the R3 one-canonical-
  // membership rebuild — this is lockstep-4, not the durable fix.)
  mirrorAddMembership({ roomId, handle });
}

export function bindRoomHandleToLiveTerminal(
  roomId: string,
  rawHandle: string,
  callerPidChain: PidChainEntry[] = [],
  actor: string | null = null
): string | null {
  const handle = normalizeHandle(rawHandle);
  if (roomId.trim().length === 0 || handle.length === 0) return null;

  const existingTerminalId = getTerminalIdByHandle(roomId, handle);
  const existingTerminal = existingTerminalId ? getTerminalById(existingTerminalId) : null;
  if (
    existingTerminal &&
    !existingTerminal.source.startsWith('browser') &&
    isExistingTerminalStillLive(existingTerminal)
  ) {
    // Existing legacy binding is live — but the clean session-keyed surfaces the
    // POST gate reads may still be missing/stale (the @speedy 0djd8b8cjq case:
    // room_memberships live, lease absent). Self-heal them before returning.
    selfHealCleanBinding(roomId, handle, existingTerminal.id, actor);
    return existingTerminal.id;
  }

  // Point 2 fix (Xeno windows-cli-auth-wedge follow-up #2, 2026-05-28):
  // when the existing binding fails liveness, prefer the caller's actual
  // pidChain-resolved terminal over the legacy handle→record lookup.
  // findTerminalRecordByHandle picks the FIRST record matching the
  // handle, which is often the SAME stale row that just failed liveness
  // — leaving the user wedged even after a fresh `ant register` cycle.
  // lookupTerminalByPidChain walks the caller's own process tree to find
  // the genuinely-live terminal_records row that THIS shell registered.
  if (callerPidChain.length > 0) {
    const liveTerminal = lookupTerminalByPidChain(callerPidChain);
    if (liveTerminal && isExistingTerminalStillLive(liveTerminal)) {
      addMembership({ room_id: roomId, handle, terminal_id: liveTerminal.id });
      selfHealCleanBinding(roomId, handle, liveTerminal.id, actor);
      return liveTerminal.id;
    }
  }

  const record = findTerminalRecordByHandle(handle);
  if (!record) return null;

  let terminal = getTerminalById(record.session_id);
  if (!terminal && record.tmux_target_pane) {
    terminal = autoRegisterTerminalForSpawnedSession({
      sessionId: record.session_id,
      tmuxTargetPane: record.tmux_target_pane,
      agentKind: record.agent_kind
    });
  }

  if (!terminal && record.tmux_target_pane) {
    const match = /^(\d+):/.exec(record.tmux_target_pane);
    if (match) {
      terminal = adoptExternalProcessForTerminal({
        record,
        pid: Number(match[1]),
        pidStart: null,
        ttlSeconds: 30 * 24 * 60 * 60,
        reason: 'room-handle-live-terminal-binding'
      });
    }
  }

  if (!terminal) return null;
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  selfHealCleanBinding(roomId, handle, terminal.id, actor);
  return terminal.id;
}
