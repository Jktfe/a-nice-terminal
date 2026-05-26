/**
 * F slice — auto-register the calling terminal after `ant invite redeem`
 * (or `ant invite join-url`) so PTY-inject can deliver mentions to the
 * newly-joined handle's pane without a separate `ant register` call.
 *
 * NMT feedback #F (hs9jv51zrh msg_sd5f3sw30s + msg_fpz9iyy4x1 + msg_s0kz6fncxa,
 * 2026-05-26): James S ran `ant invite exchange` + `ant invite redeem`
 * over Tailscale to join room 0mcytty7ng as @jsCC. The redeem created
 * `chat_room_members` but no `room_memberships` row because no
 * `terminal_records` row existed for @jsCC; `bindRoomHandleToLiveTerminal`
 * returned null → fanout had no terminal_id for @jsCC → silent no-op →
 * James built a 5-min polling cron (cron job 68ec3708) to route around
 * the gap.
 *
 * Diagnosis confirmed: bindRoomHandleToLiveTerminal (src/lib/server/
 * terminalHandleBinding.ts:37) needs an EXISTING room_memberships row OR
 * a terminal_records row for the handle. A fresh remote operator has
 * neither — the redeem leaves their handle dangling.
 *
 * Fix shape: after a successful redeem, register the calling tmux pane
 * against the just-joined handle (via /api/identity/register with the
 * caller's PID chain + pane + agent_kind) AND add the membership row
 * (via /api/sessions/add membership-mode) so fanout has somewhere to
 * deliver. Skipped when:
 *   - `--no-register` flag set
 *   - No tmux pane detectable ($TMUX_PANE unset and no --pane flag)
 *
 * Failure modes are best-effort: a register-failure does NOT fail the
 * redeem. The user always sees the redeem success; the auto-register
 * status is appended as a separate line. This preserves the redeem
 * exit-code contract for any callers that depend on it.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const DEFAULT_REGISTER_TTL_SECONDS = 12 * 60 * 60;

/**
 * Derive a stable terminal-name from handle + roomId so re-redeems on the
 * same machine for the same (handle, room) yield the same name and hit
 * the existing-name UPSERT branch of `/api/identity/register` instead of
 * piling new rows.
 *
 * Shape: redeem-<handleStripped>-<short-roomId>
 */
export function deriveTerminalName(handle, roomId) {
  const stripped = handle.startsWith('@') ? handle.slice(1) : handle;
  const shortRoom = roomId.slice(-6);
  return `redeem-${stripped}-${shortRoom}`;
}

/**
 * Decide which pane to bind. Explicit --pane wins; else $TMUX_PANE; else
 * null (signals "no pane, skip auto-register").
 */
export function resolveTmuxPane(flagsPane, envTmuxPane) {
  if (typeof flagsPane === 'string' && flagsPane.length > 0) return flagsPane;
  if (typeof envTmuxPane === 'string' && envTmuxPane.length > 0) return envTmuxPane;
  return null;
}

/**
 * Attempt to register the calling terminal against the handle just joined,
 * then add the room-membership row that fanout walks.
 *
 * Returns { status, terminalId?, terminalName?, reason? }:
 *   - status: 'registered'  — both register + add-membership succeeded
 *             'skipped'     — operator opt-out or no pane (reason populated)
 *             'failed'      — register or add-membership errored; redeem still
 *                             succeeded, caller surfaces the warning
 */
export async function attemptAutoRegister({
  handle,
  roomId,
  baseUrl,
  runtime,
  flags,
  envTmuxPane,
  processIdentityChainImpl = processIdentityChain
}) {
  if (flags['no-register'] === 'true') {
    return { status: 'skipped', reason: 'no-register flag' };
  }
  const pane = resolveTmuxPane(flags.pane, envTmuxPane);
  if (pane === null) {
    return { status: 'skipped', reason: 'no pane (no --pane flag and $TMUX_PANE unset)' };
  }
  const name = typeof flags.name === 'string' && flags.name.length > 0
    ? flags.name
    : deriveTerminalName(handle, roomId);
  const agentKind = typeof flags['agent-kind'] === 'string' && flags['agent-kind'].length > 0
    ? flags['agent-kind']
    : null;

  const pidChain = processIdentityChainImpl();
  if (pidChain.length === 0) {
    return { status: 'failed', reason: 'PID chain unavailable (ps unreadable)' };
  }

  // Step 1 — register the terminal. This writes the terminals row with
  // the pane so getTerminalById + tmux_target_pane both resolve.
  const registerBody = {
    name,
    pids: pidChain,
    ttl_seconds: DEFAULT_REGISTER_TTL_SECONDS,
    source: 'cli-redeem-autoregister',
    meta: { handle, cwd: runtime.cwd ?? process.cwd() },
    pane
  };
  if (agentKind !== null) registerBody.agent_kind = agentKind;
  const registerResponse = await runtime.fetchImpl(
    `${baseUrl}/api/identity/register`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registerBody)
    }
  );
  if (!registerResponse.ok) {
    const text = await registerResponse.text().catch(() => '');
    return {
      status: 'failed',
      reason: `register ${registerResponse.status}: ${text.slice(0, 160)}`
    };
  }
  const registerPayload = await registerResponse.json();
  const terminalId = registerPayload.terminal_id;

  // Step 2 — add the room-membership row. bindRoomHandleToLiveTerminal in
  // chatMembershipBinding tries this on first message, but the side-rooms
  // fanout fix (2026-05-20) only re-binds when an existing terminal can
  // be found by handle. For a fresh remote join we have to seed the row
  // ourselves; otherwise fanout silently skips this member until the
  // first inbound message triggers bind via the lookup path.
  const addMembershipResponse = await runtime.fetchImpl(
    `${baseUrl}/api/sessions/add`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room_id: roomId,
        handle,
        terminal_name: name
      })
    }
  );
  if (!addMembershipResponse.ok) {
    const text = await addMembershipResponse.text().catch(() => '');
    return {
      status: 'failed',
      reason: `add-membership ${addMembershipResponse.status}: ${text.slice(0, 160)}`,
      terminalId,
      terminalName: name
    };
  }

  return { status: 'registered', terminalId, terminalName: name };
}

/**
 * Render the auto-register outcome as a human-readable line that follows
 * the existing tab-separated redeem-success line in the CLI output. Kept
 * separate from `attemptAutoRegister` so tests can pin the rendering
 * without mocking the runtime.
 */
export function formatAutoRegisterOutcome(outcome, handle, roomId) {
  if (outcome.status === 'registered') {
    return `Bound terminal ${outcome.terminalName} (${outcome.terminalId}) to ${handle} for PTY-inject delivery.`;
  }
  if (outcome.status === 'skipped') {
    if (outcome.reason === 'no-register flag') {
      return `Auto-register skipped (--no-register). Run \`ant register --handle ${handle} --name <terminalName> --pane $TMUX_PANE\` to enable PTY-inject delivery.`;
    }
    // no pane case
    return `Auto-register skipped (${outcome.reason}). Run \`ant register --handle ${handle} --name <terminalName> --pane $TMUX_PANE\` from inside a tmux pane to enable PTY-inject delivery.`;
  }
  // failed
  const idTrail = outcome.terminalId ? ` (terminal_id ${outcome.terminalId})` : '';
  return `Auto-register failed${idTrail}: ${outcome.reason}. Redeem succeeded; rerun \`ant register --handle ${handle} --name <terminalName> --pane $TMUX_PANE\` manually if PTY-inject delivery doesn't start.`;
}
