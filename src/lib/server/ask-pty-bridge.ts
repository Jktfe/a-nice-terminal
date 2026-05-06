// ANT v3 — Ask → Terminal PTY bridge
//
// Routes /asks resolution actions (approve/reject/answer) into an owning
// terminal session via the same ptm.write() path the WS terminal_input
// handler and chat-injection adapter use. Supports the two-call protocol
// (text + 150ms delay + \r) so prompts submit cleanly across CLIs.

import { queries } from './db';
import { capturePromptInput } from './prompt-capture';

const SUBMIT_DELAY_MS = 150;
const CLAUDE_DOUBLE_RETURN_DELAY_MS = 150;

function ptmWrite(sessionId: string, data: string): void {
  const write = (globalThis as any).__antPtmWrite;
  if (write) {
    write(sessionId, data);
    return;
  }
  // Fallback: pty-client auto-connects to the daemon socket.
  import('./pty-client.js').then((m) => m.ptyClient.write(sessionId, data)).catch(() => {});
}

function sanitizeInline(value: string, max = 2000): string {
  return value
    .slice(0, max)
    .replace(/[\n\r]+/g, ' ')
    .replace(/['"`()$;\\|&<>{}[\]!#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface InjectAskResolutionInput {
  targetSessionId: string;
  action: 'approve' | 'reject' | 'answer';
  answer?: string | null;
  askId: string;
  roomId: string;
}

export interface InjectAskResolutionResult {
  ok: boolean;
  reason?: 'session_not_found' | 'session_not_terminal' | 'empty_payload';
  injected?: string;
  cliFlag?: string | null;
}

/**
 * Inject an ask resolution into the owning terminal.
 *
 * The text written into the PTY is derived from the action:
 *   approve → answer text, falling back to "yes"
 *   reject  → answer text, falling back to "no"
 *   answer  → answer text (required; otherwise empty_payload)
 *
 * The two-call submit protocol (text → 150ms → \r) matches the chat
 * injection adapter; Claude Code receives a second \r at +150ms because
 * a single \r enters quote> continuation mode rather than submitting.
 */
export function injectAskResolution(input: InjectAskResolutionInput): InjectAskResolutionResult {
  const session = queries.getSession(input.targetSessionId) as any;
  if (!session) return { ok: false, reason: 'session_not_found' };
  if (session.type !== 'terminal') return { ok: false, reason: 'session_not_terminal' };

  const trimmed = (input.answer || '').trim();
  let payload: string;
  if (input.action === 'approve') payload = trimmed || 'yes';
  else if (input.action === 'reject') payload = trimmed || 'no';
  else payload = trimmed;

  if (!payload) return { ok: false, reason: 'empty_payload' };

  const safeText = sanitizeInline(payload);
  if (!safeText) return { ok: false, reason: 'empty_payload' };

  let cliFlag: string | null = null;
  try {
    const meta = typeof session.meta === 'string' ? JSON.parse(session.meta) : session.meta || {};
    cliFlag = meta?.cli_flag || meta?.cliFlag || null;
  } catch {}
  const needsDoubleReturn = cliFlag === 'claude-code';

  ptmWrite(input.targetSessionId, safeText);
  capturePromptInput(input.targetSessionId, safeText, {
    captureSource: 'chat_injection',
    transport: 'ask-pty-bridge',
    messageId: input.askId,
    roomId: input.roomId,
    target: session.handle || null,
  });

  setTimeout(() => {
    ptmWrite(input.targetSessionId, '\r');
    if (needsDoubleReturn) {
      setTimeout(() => ptmWrite(input.targetSessionId, '\r'), CLAUDE_DOUBLE_RETURN_DELAY_MS);
    }
  }, SUBMIT_DELAY_MS);

  return { ok: true, injected: safeText, cliFlag };
}
