// ANT — QwenCliDriver
// File: src/drivers/qwen-cli/driver.ts
//
// Implements the AgentDriver interface for Qwen Code CLI v0.15.3.
// Based on live terminal capture from Slot 7 audit 2026-04-27.
//
// Qwen CLI (--yolo mode) auto-executes shell commands and file edits.
// TUI uses ✦ for responses, ⠼/⠹ spinners for thinking, ╭╰ boxes for tool results.
// Prompt: ">" prefix. Status bar: "YOLO mode (shift + tab to cycle)".
// Very similar to Claude Code's TUI patterns.
//
// Design: respond() accepts a sendKeys callback (same pattern as other drivers).

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

// ─── Detection patterns (from Slot 7 probe 2026-04-27) ──────────────────────

// User prompt / ready line. Terminal captures can include either the prompt
// prefix or the rendered input hint after box drawing is stripped.
const PROMPT_RE = /^\s*(?:>\s|\*\s+Type your message or @path\/to\/file)/m;

// Response prefix (filled diamond)
const RESPONSE_RE = /^\s*✦\s/m;

// Thinking spinners (braille patterns)
const THINKING_RE = /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s/m;
const THINKING_MSG_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+(.+?)\s*\(\d+s\s*·\s*esc to cancel\)/;
const BUSY_RE = /\((?:\d+m\s*)?\d+s(?:\s+[_·]\s+\d+\s+tokens)?\s+esc to cancel\)/i;
const INITIALISING_RE = /\bInitializing\.\.\./i;

// Tool result box patterns
const TOOL_SUCCESS_RE = /^\s*│\s*✓\s+Shell\s/m;
const TOOL_FAIL_RE = /^\s*│\s*✗\s+Shell\s/m;
const TOOL_GENERIC_RE = /\b(?:Shell|run_shell_command|Run Shell Command|Bash)\b/i;
const SUCCESS_RE = /\b(?:Message sent successfully|Command completed|completed successfully)\b/i;

// Status bar
const INPUT_HINT_RE = /Type your message or @path/;

// Model from startup banner: "API Key | qwen3.6:latest (/model to change)"
const MODEL_RE = /API Key\s*\|\s*(\S+)/;
const MODEL_ACTIVE_RE = /active_model=([A-Za-z0-9._:/-]+)/i;
// Or from inline: "qwen3.6:latest xhigh"
const MODEL_INLINE_RE = /^(qwen[\d.]+(?::\S+)?)\s+\w+high/m;
const WORKSPACE_RE = /((?:~|\/Users\/[^/\s]+)\/(?:CascadeProjects|[^/\s]+)\/[A-Za-z0-9._-]+)/;

// Chrome patterns (UI elements, not content)
const CHROME_PATTERNS = [
  /^─{10,}$/,                        // horizontal rules
  /^\s*>\s*$/,                        // empty prompt
  /^\s*\*\s+Type your message/,       // input hint
  /^q{8,}/i,                           // stripped box drawing from tmux capture
  /YOLO mode/,                        // status bar
  /shift \+ tab to cycle/,            // mode cycle hint
  /^\s*╭─|^\s*╰─|^\s*│\s/,           // tool result box borders
  /^\s*Tips?:/,                       // startup tips
  /^\s*██[╔║╗╚═╝]/,                  // ASCII art banner
  /^\s*▄▄▄▄|^\s*╚══/,                // banner decorations
  /^>_ Qwen Code/,                   // version banner
  /^\s*_?\s*Initializing\.\.\./i,    // startup status
  /^\s*_?\s*Press\s+.+\s+to edit queued messages/i,
  /Warning.*NODE_TLS/,               // node TLS warning
];

// Interactive patterns
const CONFIRM_RE = /(shall I|want me to|proceed\?|are you sure|do you want|would you like)/i;
const CHOICE_QUESTION_RE = /(which one|please choose|pick one|choose one|select one|which would you)/i;
const NUMBERED_LIST_RE = /^\s*\d+\.\s+\S/m;
const FREE_TEXT_RE = /\?\s*$/m;
const ERROR_RETRY_RE = /(error|failed|not found|doesn't exist)[^]*?(would you like|want me to|shall I|try again)/ims;

// ─── NormalisedEvent extension ────────────────────────────────────────────────

export interface QwenEvent extends NormalisedEvent {
  class: EventClass;
  payload: Record<string, unknown>;
}

// ─── QwenCliDriver ────────────────────────────────────────────────────────────

export class QwenCliDriver implements AgentDriver {

  detect(raw: RawEvent): NormalisedEvent | null {
    const { text, ts } = raw;

    // Thinking / busy indicators
    if (INITIALISING_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { activity: 'Initializing' });
    }

    if (THINKING_RE.test(text) || BUSY_RE.test(text)) {
      const match = text.match(THINKING_MSG_RE);
      return this.makeEvent(ts, raw.raw, text, 'progress', {
        activity: match ? match[1].trim() : text.trim(),
      });
    }

    // Tool execution results
    if (TOOL_SUCCESS_RE.test(text)) {
      const cmd = text.match(/✓\s+Shell\s+(.+)/)?.[1]?.trim() ?? 'unknown';
      return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Shell', command: cmd, success: true });
    }
    if (TOOL_FAIL_RE.test(text)) {
      const cmd = text.match(/✗\s+Shell\s+(.+)/)?.[1]?.trim() ?? 'unknown';
      return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Shell', command: cmd, success: false });
    }
    if (TOOL_GENERIC_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { tool: 'Shell' });
    }
    if (SUCCESS_RE.test(text)) {
      return this.makeEvent(ts, raw.raw, text, 'progress', { signal: 'success' });
    }

    // Interactive patterns
    if (RESPONSE_RE.test(text) || PROMPT_RE.test(text)) {
      if (ERROR_RETRY_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'error_retry', { message: text.trim() });
      }
      if (CHOICE_QUESTION_RE.test(text) && NUMBERED_LIST_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'multi_choice', { question: text.trim(), options: [] });
      }
      if (CONFIRM_RE.test(text)) {
        return this.makeEvent(ts, raw.raw, text, 'confirmation', { question: text.trim() });
      }
      if (FREE_TEXT_RE.test(text) && text.length > 10) {
        return this.makeEvent(ts, raw.raw, text, 'free_text', { question: text.trim() });
      }
    }

    return null;
  }

  async respond(event: NormalisedEvent, choice: UserChoice, sendKeys?: SendKeysFn): Promise<void> {
    const keys = this.buildKeys((event as QwenEvent).class, choice);
    if (keys === null) return;
    if (!sendKeys) throw new Error('QwenCliDriver.respond requires a sendKeys callback');
    await sendKeys(keys);
  }

  isSettled(event: NormalisedEvent, output: RawOutput): boolean {
    const window = output.lines.slice(-10).map(e => e.text).join('\n');
    const eventClass = (event as QwenEvent).class;

    switch (eventClass) {
      case 'progress':
        return PROMPT_RE.test(window) && !THINKING_RE.test(window) && !BUSY_RE.test(window) && !INITIALISING_RE.test(window);

      case 'multi_choice':
      case 'confirmation':
      case 'free_text':
      case 'error_retry':
        return PROMPT_RE.test(window) && !THINKING_RE.test(window) && !BUSY_RE.test(window);

      case 'permission_request':
      case 'tool_auth':
        return true; // --yolo mode, never fires

      default:
        return false;
    }
  }

  isChrome(line: string): boolean {
    return CHROME_PATTERNS.some(re => re.test(line));
  }

  detectStatus(recentLines: string[]): AgentStatus | null {
    const text = recentLines.join('\n');
    const now = Date.now();

    let state: AgentStatus['state'] = 'unknown';
    let activity: string | undefined;
    let model: string | undefined;

    // Detect model from banner or status
    const bannerMatch = text.match(MODEL_RE);
    if (bannerMatch) model = bannerMatch[1];
    const activeModelMatch = text.match(MODEL_ACTIVE_RE);
    if (!model && activeModelMatch) model = activeModelMatch[1];
    if (!model) {
      const inlineMatch = text.match(MODEL_INLINE_RE);
      if (inlineMatch) model = inlineMatch[1];
    }

    let workspace: string | undefined;
    const workspaceMatch = text.match(WORKSPACE_RE);
    if (workspaceMatch) workspace = workspaceMatch[1];

    // Detect state
    if (INITIALISING_RE.test(text)) {
      state = 'busy';
      activity = 'Initializing';
    } else if (THINKING_RE.test(text) || BUSY_RE.test(text)) {
      state = 'busy';
      const match = text.match(THINKING_MSG_RE);
      if (match) activity = match[1].trim();
      if (!activity) {
        const busyLine = recentLines.find(line => BUSY_RE.test(line));
        if (busyLine) activity = busyLine.trim();
      }
    } else if (PROMPT_RE.test(text) || INPUT_HINT_RE.test(text)) {
      state = 'ready';
    }

    if (state === 'unknown' && !model && !workspace) return null;
    if (state === 'unknown') state = 'ready';

    return {
      state,
      activity,
      model,
      workspace,
      detectedAt: now,
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private makeEvent(
    ts: number,
    raw: string,
    text: string,
    eventClass: EventClass,
    payload: Record<string, unknown>,
  ): QwenEvent {
    return {
      seq: 0,
      ts,
      source: 'tmux',
      type: 'output',
      raw,
      text,
      class: eventClass,
      payload,
    };
  }

  private buildKeys(eventClass: EventClass, choice: UserChoice): string[] | null {
    switch (eventClass) {
      case 'permission_request':
      case 'tool_auth':
        return null; // --yolo mode

      case 'multi_choice': {
        if (choice.type === 'select') return [String(choice.index + 1), 'Enter'];
        if (choice.type === 'text') return [choice.value, 'Enter'];
        return null;
      }

      case 'confirmation': {
        if (choice.type === 'confirm') return [choice.yes ? 'yes' : 'no', 'Enter'];
        return ['no', 'Enter'];
      }

      case 'free_text':
      case 'error_retry': {
        if (choice.type === 'text') return [choice.value, 'Enter'];
        if (choice.type === 'abort') return ['', 'Escape'];
        return null;
      }

      case 'progress':
        return null;

      default:
        return null;
    }
  }
}
