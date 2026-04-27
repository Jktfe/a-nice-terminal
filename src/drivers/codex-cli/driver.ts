// ANT — CodexCliDriver
// File: src/drivers/codex-cli/driver.ts
//
// Implements the AgentDriver interface for Codex CLI (OpenAI).
// Generated from probe run 2026-04-14 against codex v0.118.0.
// Slot 5 audit on 2026-04-27 confirmed v0.125.0 is persistent.
// See spec.json for detection patterns and NOTES.md for deviations.
//
// Key deviation: Codex 0.118.0 (gpt-5.4 xhigh) auto-runs ALL operations
// (read, write, execute) without any permission TUI. v0.118.0 exited after
// each response; v0.125.0 remains interactive after responses.
//
// Design: respond() accepts a sendKeys callback (same pattern as ClaudeCodeDriver).

import type {
  AgentDriver,
  EventClass,
  NormalisedEvent,
  RawEvent,
  RawOutput,
  UserChoice,
} from '../../fingerprint/types.js';
import type { AgentStatus } from '../../lib/shared/agent-status.js';

export type SendKeysFn = (keys: string[]) => Promise<void>;

// ─── Detection patterns (from probe run 2026-04-14) ──────────────────────────

// Codex prompt indicator (user input line)
const PROMPT_RE = /^›\s*/m;

// Codex response bullet prefix
const BULLET_RE = /^•\s+/m;

// Progress: shown during model generation
const PROGRESS_RE = /^•\s+Working\s+\(\d+s\s+•\s+esc to interrupt\)/m;

// Tool call result patterns (P01, P02, P03 validated)
const TOOL_READ_RE    = /^•\s+Explored\s*$/m;
const TOOL_READ_SUB_RE = /^\s+└\s+Read\s+\S/m;
const TOOL_WRITE_RE   = /^•\s+Added\s+\S+\s+\(\+\d+\s+-\d+\)/m;
const TOOL_RAN_RE     = /^•\s+Ran\s+bash\s+/m;

// Session exit signal
const SESSION_EXIT_RE = /To continue this session, run codex resume/;

// Token usage line
const TOKEN_USAGE_RE = /^Token usage:/m;

// Text-level interactive patterns (TODO: validate P04/P06/P07/P10)
const CHOICE_QUESTION_RE = /(which one|please choose|pick one|choose one|select one|which would you)/i;
const NUMBERED_LIST_RE   = /^\s*\d+\.\s+\S/m;
const CONFIRM_RE         = /(shall I go ahead|want me to proceed|are you sure|proceed\?)/i;
const FREE_TEXT_RE       = /^•\s+.+\?\s*$/m;
const ERROR_RETRY_RE     = /^•\s+.+(doesn't exist|does not exist|not found|failed|error)[^]*?(would you like|want me to|shall I|did you mean)/ims;

// ─── NormalisedEvent extension ────────────────────────────────────────────────

export interface CodexEvent extends NormalisedEvent {
  class:   EventClass;
  payload: Record<string, unknown>;
}

// ─── CodexCliDriver ───────────────────────────────────────────────────────────

export class CodexCliDriver implements AgentDriver {

  /**
   * Detect interactive events from a single raw tmux output line.
   *
   * NOTE: Codex 0.118.0 auto-runs all tool calls without approval TUIs.
   * Slot 5 showed v0.125.0 in YOLO mode remains persistent after responses.
   * This driver never emits permission_request or tool_auth events.
   * It focuses on:
   *  - progress: "• Working (Ns • esc to interrupt)"
   *  - tool result lines (emitted as progress for runner awareness)
   *  - free_text / multi_choice / confirmation / error_retry: text patterns
   */
  detect(raw: RawEvent): NormalisedEvent | null {
    const { text, ts } = raw;

    // Progress — model is generating
    if (PROGRESS_RE.test(text)) {
      const seconds = text.match(/\((\d+)s/)?.[1];
      return this.makeEvent(ts, raw.raw, text, 'progress', {
        elapsed_seconds: seconds ? parseInt(seconds, 10) : 0,
      });
    }

    // Tool result lines — emit progress so runner knows what happened
    if (TOOL_READ_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Read' });
    }
    if (TOOL_WRITE_RE.test(text)) {
      const file = text.match(/•\s+Added\s+(\S+)/)?.[1] ?? 'unknown';
      return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Write', file });
    }
    if (TOOL_RAN_RE.test(text)) {
      const cmd = text.match(/•\s+Ran\s+bash\s+(.+)$/)?.[1]?.trim() ?? 'unknown';
      return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Execute', command: cmd });
    }

    // Session exit — signal to runner that the session is done
    if (SESSION_EXIT_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', {
        signal: 'session_exit',
        resume_line: text.trim(),
      });
    }

    // Text-level interactive patterns on bullet lines
    if (BULLET_RE.test(text)) {
      // error_retry (more specific — check before free_text)
      if (ERROR_RETRY_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'error_retry', { message: text.trim() });
      }

      // multi_choice: numbered list + choice question
      if (CHOICE_QUESTION_RE.test(text) && NUMBERED_LIST_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'multi_choice', { question: text.trim(), options: [] });
      }

      // confirmation
      if (CONFIRM_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'confirmation', { question: text.trim() });
      }

      // free_text: bullet line ending in ?
      if (FREE_TEXT_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'free_text', { question: text.trim() });
      }
    }

    return null;
  }

  /**
   * Send the user's response to Codex via the injected sendKeys callback.
   */
  async respond(event: NormalisedEvent, choice: UserChoice, sendKeys?: SendKeysFn): Promise<void> {
    const keys = this.buildKeys((event as CodexEvent).class, choice);
    if (keys === null) return;
    if (!sendKeys) throw new Error('CodexCliDriver.respond requires a sendKeys callback');
    await sendKeys(keys);
  }

  /**
   * True once Codex has settled.
   * Settled = session exit signal on older Codex OR prompt re-appeared AND no
   * progress indicator on persistent Codex.
   */
  isSettled(event: NormalisedEvent, output: RawOutput): boolean {
    const window = output.lines.slice(-10).map(e => e.text).join('\n');
    const eventClass = (event as CodexEvent).class;

    // Codex often exits after responding — that's a settled state
    if (SESSION_EXIT_RE.test(window)) return true;

    switch (eventClass) {
      case 'progress':
        return (
          !PROGRESS_RE.test(window) &&
          (PROMPT_RE.test(window) || SESSION_EXIT_RE.test(window))
        );

      case 'multi_choice':
      case 'confirmation':
      case 'free_text':
      case 'error_retry':
        return PROMPT_RE.test(window) && !PROGRESS_RE.test(window);

      // permission_request / tool_auth never fire from detect() in this driver
      case 'permission_request':
      case 'tool_auth':
        return true;

      default:
        return false;
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private makeEvent(
    ts: number,
    raw: string,
    text: string,
    eventClass: EventClass,
    payload: Record<string, unknown>,
  ): CodexEvent {
    return {
      seq:    0,
      ts,
      source: 'tmux',
      type:   'output',
      raw,
      text,
      class:  eventClass,
      payload,
    };
  }

  private buildKeys(eventClass: EventClass, choice: UserChoice): string[] | null {
    switch (eventClass) {
      // Codex never emits these — return null (no-op)
      case 'permission_request':
      case 'tool_auth':
        return null;

      case 'multi_choice': {
        if (choice.type === 'select') return [String(choice.index + 1), 'Enter'];
        if (choice.type === 'text')   return [choice.value, 'Enter'];
        return null;
      }

      case 'confirmation': {
        if (choice.type === 'confirm') return [choice.yes ? 'yes' : 'no', 'Enter'];
        return ['no', 'Enter'];
      }

      case 'free_text':
      case 'error_retry': {
        if (choice.type === 'text')  return [choice.value, 'Enter'];
        if (choice.type === 'abort') return ['', 'Escape'];
        return null;
      }

      case 'progress':
        return null;

      default:
        return null;
    }
  }

  detectStatus(recentLines: string[]): AgentStatus | null {
    const text = recentLines.join('\n');
    const now = Date.now();

    let state: AgentStatus['state'] = 'unknown';
    let activity: string | undefined;
    let model: string | undefined;

    // Codex state patterns
    if (/Ready/.test(text)) state = 'ready';
    if (/• Working \(\d+s/.test(text)) {
      state = 'busy';
      const match = text.match(/• Working \((\d+)s/);
      if (match) activity = `Working (${match[1]}s)`;
    }
    if (/Context \d+% left/.test(text)) state = state === 'unknown' ? 'ready' : state;

    // Model from status line: "gpt-5.5 xhigh"
    const modelMatch = text.match(/(gpt-[\d.]+\s*\w*)/i);
    if (modelMatch) model = modelMatch[1].trim();

    // Context from status line: "Context 100% left"
    let contextRemainingPct: number | undefined;
    const ctxMatch = text.match(/Context\s+(\d+)%\s+left/);
    if (ctxMatch) contextRemainingPct = parseInt(ctxMatch[1], 10);
    if (contextRemainingPct != null && state === 'unknown') state = 'ready';

    // Codex status line: "gpt-5.5 xhigh · /path · Ready · Context 100% left"
    let workspace: string | undefined;
    const statusLine = recentLines.find(line => /Context\s+\d+%\s+left|Ready|gpt-[\d.]+/i.test(line));
    if (statusLine) {
      const parts = statusLine.split('·').map(part => part.trim()).filter(Boolean);
      const workspacePart = parts.find(part => part.startsWith('/') || part.startsWith('~'));
      if (workspacePart) workspace = workspacePart;
    }

    if (state === 'unknown') return null;

    return {
      state,
      activity,
      model,
      contextUsedPct: contextRemainingPct != null ? 100 - contextRemainingPct : undefined,
      contextRemainingPct,
      workspace,
      detectedAt: now,
    };
  }
}
