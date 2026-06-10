/**
 * PTY inject bridge — tmux paste-buffer + Enter for verified agent panes.
 *
 * Safety boundary (gate-binding):
 *   1. No pane is verified from registration alone. verifyPaneTargetState
 *      runs `tmux capture-pane` against the live pane; only a successful
 *      ready-state match transitions pane_status -> verified.
 *   2. Every child tmux call goes through runScrubbedTmux with arg ARRAYS
 *      (no shell), and deletes TMUX / TMUX_PANE / TMUX_PLUGIN_MANAGER_PATH
 *      from the child env (feedback_pty_daemon_no_nested_tmux).
 *   3. claude_code panes get the v3 double-return (paste, +150ms Enter,
 *      +300ms Enter) per feedback_plain_text_pty + v3 ask-pty-bridge.ts.
 *   4. Unverified / stale / non-claude_code panes get NO paste + NO Enter.
 *      They get a rate-limited system marker in the room so delivery
 *      failure is visible (1 marker per (room, handle) per 60 min).
 *   5. Fanout guard (chatMessageStore boundary in routes/messages/+server.ts)
 *      excludes system / system-break messages so stale markers never
 *      re-trigger fanout.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { getDiscussion } from './chatDiscussionStore';
import type { MessageDeliveryEnvelope } from './messageDeliveryEnvelope';
import {
  type TerminalRow,
  markPaneVerified,
  markPaneStale
} from './terminalsStore';
import { getIdentityDb } from './db';

const TMUX_BIN = process.env.ANT_TMUX_BIN ?? '/opt/homebrew/bin/tmux';
const STALE_MARKER_WINDOW_SECONDS = 60 * 60;

type SpawnImpl = (
  bin: string,
  args: string[],
  options: { input?: string | Buffer; env: NodeJS.ProcessEnv }
) => SpawnSyncReturns<Buffer>;

let injectedSpawn: SpawnImpl | null = null;

export function setSpawnImplForTests(impl: SpawnImpl | null): void {
  injectedSpawn = impl;
}

const staleMarkerLastEmitted = new Map<string, number>();

export function resetBridgeStateForTests(): void {
  injectedSpawn = null;
  staleMarkerLastEmitted.clear();
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function runScrubbedTmux(args: string[], stdinData?: string | Buffer): SpawnSyncReturns<Buffer> {
  const childEnv = { ...process.env } as Record<string, string | undefined>;
  delete childEnv.TMUX;
  delete childEnv.TMUX_PANE;
  delete childEnv.TMUX_PLUGIN_MANAGER_PATH;
  const spawn = injectedSpawn ?? (spawnSync as unknown as SpawnImpl);
  return spawn(TMUX_BIN, args, { input: stdinData, env: childEnv as NodeJS.ProcessEnv });
}

export type PaneVerifyOutcome = 'verified' | 'stale' | 'unknown';

function isQwenShellCommandMode(captured: string): boolean {
  const tail = captured
    .split('\n')
    .slice(-20)
    .join('\n');
  return (
    /\bshell mode enabled\s*\(\s*esc to disable\s*\)/i.test(tail)
    || /^\s*[x✗]\s+Shell Command\b/im.test(tail)
    || /\bbash:\s+-c:\s+unexpected EOF\b/i.test(tail)
    || /^\s*\[ANT:\s+command not found\b/im.test(tail)
    || /\bcommand not found:\s+\[ANT\b/i.test(tail)
  );
}

function isClaudeCodeAgent(agentKind: string | null): boolean {
  return agentKind === 'claude-code' || agentKind === 'claude';
}

function matchReadyStateFor(agentKind: string | null, captured: string): boolean {
  const normalized = normalizeAgentKind(agentKind);
  if (isClaudeCodeAgent(normalized)) {
    const hasPromptIndicator = captured.includes('│ >') || captured.includes('❯');
    const isStreaming = captured.includes('esc to interrupt');
    return hasPromptIndicator && !isStreaming;
  }
  if (normalized === 'qwen' || normalized === 'qwen-cli') {
    return !isQwenShellCommandMode(captured);
  }
  // T1c (2026-05-14): non-claude_code agents have no per-CLI ready-state
  // semantics. Default to "ready" so fanout delivery proceeds for bare
  // shells, codex, gemini, etc. — matches v3 PtyInjectionAdapter behaviour
  // (unconditional ptmWrite + \r). claude_code keeps its prompt-aware
  // verify because its TUI buffers input differently.
  return true;
}

export function verifyPaneTargetState(terminal: TerminalRow): PaneVerifyOutcome {
  if (!terminal.tmux_target_pane) return 'unknown';
  const result = runScrubbedTmux([
    'capture-pane', '-t', terminal.tmux_target_pane, '-p', '-S', '-50'
  ]);
  if (result.status !== 0) {
    markPaneStale(terminal.id);
    return 'stale';
  }
  const captured = (result.stdout ?? Buffer.alloc(0)).toString('utf8');
  if (captured.length === 0) return 'unknown';

  let agentKind = terminal.agent_kind;
  if (!agentKind && terminal.id) {
    try {
      const db = getIdentityDb();
      const row = db
        .prepare(`SELECT agent_kind FROM terminal_records WHERE session_id = ? AND superseded_at_ms IS NULL`)
        .get(terminal.id) as { agent_kind: string | null } | undefined;
      if (row && row.agent_kind) {
        agentKind = row.agent_kind;
      }
    } catch {
      // ignore
    }
  }

  if (matchReadyStateFor(agentKind, captured)) {
    markPaneVerified(terminal.id);
    return 'verified';
  }
  return 'unknown';
}

class InjectTmuxFailure extends Error {}

function pasteBufferToTarget(pane: string, text: string, options: { bracketedPaste?: boolean } = {}): void {
  const bufferName = `ant-inject-${process.pid}-${Date.now()}`;
  const loadResult = runScrubbedTmux(['load-buffer', '-b', bufferName, '-'], text);
  if (loadResult.status !== 0) {
    throw new InjectTmuxFailure(`tmux load-buffer failed: status ${loadResult.status}`);
  }
  let pasteFailed: InjectTmuxFailure | null = null;
  try {
    const pasteArgs = options.bracketedPaste
      ? ['paste-buffer', '-p', '-b', bufferName, '-t', pane]
      : ['paste-buffer', '-b', bufferName, '-t', pane];
    const pasteResult = runScrubbedTmux(pasteArgs);
    if (pasteResult.status !== 0) {
      pasteFailed = new InjectTmuxFailure(`tmux paste-buffer failed: status ${pasteResult.status}`);
    }
  } finally {
    const deleteResult = runScrubbedTmux(['delete-buffer', '-b', bufferName]);
    if (pasteFailed) throw pasteFailed;
    if (deleteResult.status !== 0) {
      throw new InjectTmuxFailure(`tmux delete-buffer failed: status ${deleteResult.status}`);
    }
  }
}

function sendEnterToTarget(pane: string): void {
  const result = runScrubbedTmux(['send-keys', '-t', pane, 'Enter']);
  if (result.status !== 0) {
    throw new InjectTmuxFailure(`tmux send-keys failed: status ${result.status}`);
  }
}

export { InjectTmuxFailure };

/**
 * JWPK msg_q8g79255t9 (2026-05-19) + msg_90rkzmqc3v (2026-06-10): some CLIs
 * treat pasted newlines as separate submissions or get stuck in a multi-line
 * compose buffer. Use tmux bracketed paste for those agents so the receiving
 * TUI treats the payload as one paste instead of per-line submits. Keep
 * Codex/Claude on plain paste because their TUIs already handle multiline
 * paste-buffer payloads.
 *
 * Pattern mirrors the gemini bracket-strip transform JWPK referenced in
 * the same message — per-CLI message-mangle table. Extend here as more
 * CLIs grow their own quirks.
 */
function normalizeAgentKind(agentKind: string | null): string | null {
  if (!agentKind) return null;
  return agentKind.trim().toLowerCase().replace(/_/g, '-');
}

function isNewlineFragileAgent(agentKind: string | null): boolean {
  return new Set([
    'pi',
    'qwen',
    'qwen-cli',
    'antigravity',
    'agy',
    'gemini',
    'gemini-cli',
    'copilot',
    'copilot-cli',
    'github-copilot-cli'
  ]).has(agentKind ?? '');
}

function needsBracketGuard(agentKind: string | null): boolean {
  return new Set(['gemini', 'gemini-cli', 'antigravity', 'agy']).has(agentKind ?? '');
}

function needsBracketedPaste(agentKind: string | null): boolean {
  return isNewlineFragileAgent(agentKind);
}

function needsDoubleEnter(agentKind: string | null): boolean {
  return isClaudeCodeAgent(agentKind)
    || new Set(['copilot', 'copilot-cli', 'github-copilot-cli']).has(agentKind ?? '');
}

function transformBodyForAgent(text: string, agentKind: string | null): string {
  const normalized = normalizeAgentKind(agentKind);
  let transformed = text;
  // JWPK msg_jt41dxztok (2026-05-19): Gemini CLI treats leading `[` as a
  // slash/command-mode trigger and gets wedged in a weird terminal state
  // after every envelope. Convert leading `[ANT ...]` to `(ANT ...)` so
  // it renders as plain prose. The trailing `[ANT reply instruction: ...]`
  // suffix gets the same treatment for consistency.
  if (needsBracketGuard(normalized)) {
    transformed = transformed
      .replace(/^\[ANT ([^\]]+)\]/m, '(ANT $1)')
      .replace(/\[ANT reply instruction: ([^\]]+)\]/g, '(ANT reply instruction: $1)');
  }
  return transformed;
}

export function twoCallSubmit(
  pane: string,
  text: string,
  agentKind: string | null,
  onScheduledFailure: (cause: unknown) => void = () => {},
  scheduler: (cb: () => void, ms: number) => void = setTimeout
): void {
  let resolvedAgentKind = normalizeAgentKind(agentKind);
  if (!resolvedAgentKind && pane) {
    try {
      const db = getIdentityDb();
      const recordRow = db
        .prepare(
          `SELECT agent_kind FROM terminal_records
            WHERE tmux_target_pane = ?
              AND superseded_at_ms IS NULL
            LIMIT 1`
        )
        .get(pane) as { agent_kind: string | null } | undefined;
      if (recordRow && recordRow.agent_kind) {
        resolvedAgentKind = normalizeAgentKind(recordRow.agent_kind);
      } else {
        const termRow = db
          .prepare(
            `SELECT agent_kind FROM terminals
              WHERE tmux_target_pane = ?
            LIMIT 1`
          )
          .get(pane) as { agent_kind: string | null } | undefined;
        if (termRow && termRow.agent_kind) {
          resolvedAgentKind = normalizeAgentKind(termRow.agent_kind);
        }
      }
    } catch {
      // ignore
    }
  }

  const transformed = transformBodyForAgent(text, resolvedAgentKind);
  pasteBufferToTarget(pane, transformed, { bracketedPaste: needsBracketedPaste(resolvedAgentKind) });
  scheduler(() => {
    try {
      sendEnterToTarget(pane);
      if (
        needsDoubleEnter(resolvedAgentKind)
      ) {
        scheduler(() => {
          try { sendEnterToTarget(pane); }
          catch (cause) { onScheduledFailure(cause); }
        }, 150);
      }
    } catch (cause) {
      onScheduledFailure(cause);
    }
  }, 150);
}

export type EnvelopeMessage = {
  roomName: string;
  roomId: string;
  messageId: string;
  senderHandle: string;
  body: string;
  // M3.4b T3: optional discussion membership. ADDITIVE — absent means
  // existing envelope shape unchanged (preserves M4 remote-bridge + M3.b.5
  // heads-down zero-byte behaviour). Present means disc=<id> tag in header
  // and [Discussion closed ...] marker prepended to body if status='closed'.
  discussion_id?: string;
  // JWPK msg_wcq5fwlhg7 (2026-05-19): optional reply-parent context.
  // When the source message has parentMessageId, the fanout looks up the
  // parent and passes its summary here so the receiving agent sees BOTH
  // (a) reply-to=msg_<id> tag in the header (machine-readable) AND
  // (b) ↳ replying to @<handle>: "<truncated body>" line in the envelope
  // (human-readable for the LLM consuming the pty-inject). Both signals
  // are ADDITIVE — absent means existing envelope shape unchanged.
  replyParent?: { messageId: string; senderHandle: string; body: string };
  deliveryEnvelope?: MessageDeliveryEnvelope;
};

export type EnvelopeInput = {
  head: EnvelopeMessage;
  batchedExtras?: EnvelopeMessage[];
};

function isSingleRoomBatch(head: EnvelopeMessage, extras: EnvelopeMessage[]): boolean {
  return extras.every((m) => m.roomId === head.roomId);
}

function discTag(m: EnvelopeMessage): string {
  return m.discussion_id ? ` disc=${m.discussion_id}` : '';
}

function replyToTag(m: EnvelopeMessage): string {
  return m.replyParent ? ` reply-to=${m.replyParent.messageId}` : '';
}

const REPLY_PARENT_PREVIEW_CHARS = 120;

/**
 * Single-line preview of the parent message body for the reply-context
 * line. Collapses whitespace (newlines + runs of spaces) to a single
 * space so the envelope stays on a single line per message — agents
 * parse the envelope line-by-line and a multi-line excerpt would
 * confuse the existing routing regexes (e.g. `^[ANT room` in
 * terminalReplyRouter). Truncates to 120 chars with an ellipsis.
 */
function previewParentBody(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= REPLY_PARENT_PREVIEW_CHARS) return collapsed;
  return `${collapsed.slice(0, REPLY_PARENT_PREVIEW_CHARS - 1)}…`;
}

function replyContextLine(m: EnvelopeMessage): string {
  if (!m.replyParent) return '';
  const preview = previewParentBody(m.replyParent.body);
  return `\n  ↳ replying to ${m.replyParent.senderHandle}: "${preview}"`;
}

function renderBodyWithClosedMarker(m: EnvelopeMessage): string {
  if (!m.discussion_id) return m.body;
  const d = getDiscussion(m.discussion_id);
  if (!d || d.status !== 'closed') return m.body;
  const summary = d.summary ?? '';
  return `[Discussion closed, summary: "${summary}"] ${m.body}`;
}

function replyInstruction(messageId: string): string {
  return `\n\n[ANT reply instruction: respond with: ant chat reply ${messageId} --stdin]`;
}

function renderMessageWithReplyContext(m: EnvelopeMessage): string {
  return `${m.senderHandle}: ${renderBodyWithClosedMarker(m)}${replyContextLine(m)}`;
}

function deliveryEnvelopeLine(m: EnvelopeMessage): string {
  if (!m.deliveryEnvelope) return '';
  return `\n[ANT delivery-envelope] ${JSON.stringify(m.deliveryEnvelope)}`;
}

export function formatEnvelope(input: EnvelopeInput): string {
  const head = input.head;
  const extras = input.batchedExtras ?? [];
  const singleRoom = extras.length === 0 || isSingleRoomBatch(head, extras);
  if (extras.length === 0) {
    const header = `[ANT room ${head.roomName} id=${head.roomId} msg=${head.messageId}${discTag(head)}${replyToTag(head)}]`;
    return `${header} ${renderMessageWithReplyContext(head)}${deliveryEnvelopeLine(head)}${replyInstruction(head.messageId)}`;
  }
  if (singleRoom) {
    const lastMessageId = extras[extras.length - 1].messageId;
    const header = `[ANT room ${head.roomName} id=${head.roomId} msg=${lastMessageId}]`;
    const all = [renderMessageWithReplyContext(head), ...extras.map(renderMessageWithReplyContext)].join(', ');
    const deliveryLines = [head, ...extras].map(deliveryEnvelopeLine).join('');
    return `${header} ${extras.length + 1} messages: ${all}${deliveryLines}${replyInstruction(lastMessageId)}`;
  }
  const lastMessageId = extras[extras.length - 1].messageId;
  const header = `[ANT cross-room msg=${lastMessageId}]`;
  const all = [
    `[room ${head.roomName} id=${head.roomId}] ${renderMessageWithReplyContext(head)}`,
    ...extras.map((m) => `[room ${m.roomName} id=${m.roomId}] ${renderMessageWithReplyContext(m)}`)
  ].join(', ');
  const deliveryLines = [head, ...extras].map(deliveryEnvelopeLine).join('');
  return `${header} ${extras.length + 1} messages: ${all}${deliveryLines}\n\n[ANT reply instruction: respond to the relevant message with: ant chat reply MESSAGE_ID --stdin]`;
}

function staleMarkerKeyFor(roomId: string, handle: string): string {
  return `${roomId}::${handle}`;
}

export function shouldEmitStaleMarker(roomId: string, handle: string): boolean {
  const key = staleMarkerKeyFor(roomId, handle);
  const now = currentUnixSeconds();
  const last = staleMarkerLastEmitted.get(key);
  if (last && now - last < STALE_MARKER_WINDOW_SECONDS) return false;
  staleMarkerLastEmitted.set(key, now);
  return true;
}

export type InjectOutcome = {
  kind: 'paste' | 'marker' | 'marker-suppressed';
  reason: 'verified' | 'stale' | 'unknown' | 'no-pane';
};

export function injectToTerminal(
  terminal: TerminalRow,
  envelope: string,
  roomId: string,
  recipientHandle: string,
  emitSystemMarker: (roomId: string, handle: string, reason: string) => void
): InjectOutcome {
  if (!terminal.tmux_target_pane) return { kind: 'marker-suppressed', reason: 'no-pane' };
  const verifyResult = verifyPaneTargetState(terminal);
  if (verifyResult === 'verified') {
    const onScheduledFailure = (cause: unknown) => {
      if (!(cause instanceof InjectTmuxFailure)) return;
      markPaneStale(terminal.id);
      if (shouldEmitStaleMarker(roomId, recipientHandle)) {
        emitSystemMarker(roomId, recipientHandle, 'stale');
      }
    };
    try {
      twoCallSubmit(terminal.tmux_target_pane, envelope, terminal.agent_kind, onScheduledFailure);
      return { kind: 'paste', reason: 'verified' };
    } catch (cause) {
      if (cause instanceof InjectTmuxFailure) {
        markPaneStale(terminal.id);
        if (shouldEmitStaleMarker(roomId, recipientHandle)) {
          emitSystemMarker(roomId, recipientHandle, 'stale');
          return { kind: 'marker', reason: 'stale' };
        }
        return { kind: 'marker-suppressed', reason: 'stale' };
      }
      throw cause;
    }
  }
  if (shouldEmitStaleMarker(roomId, recipientHandle)) {
    emitSystemMarker(roomId, recipientHandle, verifyResult);
    return { kind: 'marker', reason: verifyResult };
  }
  return { kind: 'marker-suppressed', reason: verifyResult };
}
