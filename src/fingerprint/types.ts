// ANT Fingerprinting Pipeline — shared TypeScript types
// File: src/fingerprint/types.ts
//
// EventClass matches the 7 normalised classes from the ANT spec.
// AgentDriver interface matches spec exactly: detect / respond / isSettled.

// ─── Normalised event classes (from spec) ─────────────────────────────────────

export type EventClass =
  | 'permission_request'   // agent asking to read/write/execute → Approve/Deny card
  | 'multi_choice'         // numbered or tab-able options → Button group
  | 'confirmation'         // yes/no, proceed/cancel → Confirm/Cancel dialog
  | 'free_text'            // agent asking for typed input → Inline text input
  | 'tool_auth'            // authorising a specific tool use → Tool auth card
  | 'progress'             // streaming / long-running task → Progress indicator
  | 'error_retry';         // agent hit an error, needs direction → Retry/Abort/Modify

// ─── Normalised event ─────────────────────────────────────────────────────────
// A single parsed event extracted from a tmux control-mode capture burst.
// The capture daemon emits these; the runner stores them as events_json.

export interface NormalisedEvent {
  seq: number;               // monotonic sequence within the probe run
  ts: number;                // ms offset from probe injection (Date.now() delta)
  source: 'tmux' | 'pty';   // which capture source produced this event
  type:
    | 'output'               // terminal text output
    | 'prompt_detected'      // shell prompt reappeared (agent finished)
    | 'pane_changed'         // tmux pane focus changed
    | 'session_renamed'      // tmux session rename event
    | 'error';               // parse error from the control-mode stream
  raw: string;               // original tmux control-mode line (before ANSI strip)
  text: string;              // ANSI-stripped, whitespace-normalised content
  pane_id?: string;          // tmux %pane-id when available
}

// ─── Driver types ─────────────────────────────────────────────────────────────

export type DriverType = 'tmux' | 'applescript' | 'http';

export interface TmuxDriverConfig {
  session: string;           // tmux session name
  pane?: string;             // target pane (default: active pane)
  idle_timeout_ms?: number;  // ms to wait after last output before declaring idle (default 3000)
  prompt_pattern?: string;   // regex string to detect shell prompt re-emergence
}

export interface HttpDriverConfig {
  endpoint: string;          // POST endpoint that accepts { prompt: string }
  api_key_env?: string;      // env var name holding the bearer token
  timeout_ms?: number;
}

export interface AppleScriptDriverConfig {
  app: string;               // e.g. "Cursor", "Windsurf"
  window_title?: string;
}

export type DriverConfig = TmuxDriverConfig | HttpDriverConfig | AppleScriptDriverConfig;

// ─── Driver spec ──────────────────────────────────────────────────────────────
// Mirrors the driver_specs DB table; describes how to drive a specific agent.

export interface DriverSpec {
  id: string;
  name: string;
  driver_type: DriverType;
  config: DriverConfig;
  created_at: string;
  updated_at: string;
}

// ─── Raw types (inputs to AgentDriver methods) ───────────────────────────────

/** A single event from the capture pipeline — tmux output line or JSONL record. */
export interface RawEvent {
  source: 'tmux_output' | 'jsonl';
  ts: number;           // epoch ms
  text: string;         // ANSI-stripped tmux line, or raw JSONL string
  raw: string;          // original bytes before stripping
}

/** The user's response to an interactive event. */
export type UserChoice =
  | { type: 'approve' }
  | { type: 'deny' }
  | { type: 'select'; index: number }          // for multi_choice: 0-based index
  | { type: 'text'; value: string }            // for free_text
  | { type: 'confirm'; yes: boolean }          // for confirmation
  | { type: 'retry' }
  | { type: 'abort' };

/** A window of recent raw output used to check settled state. */
export interface RawOutput {
  lines: RawEvent[];
  last_ts: number;
}

// ─── Agent driver interface (from spec) ──────────────────────────────────────
// Every driver — Claude Code, Gemini CLI, Ollama, etc. — implements this.
// The ANT event bus calls these methods; it never contains agent-specific logic.

export interface AgentDriver {
  /**
   * Inspect a raw event (tmux output line or JSONL record) and return a
   * NormalisedEvent if this is an interactive event, or null if it is not.
   */
  detect(raw: RawEvent): NormalisedEvent | null;

  /**
   * Send the user's response back to the agent in its expected input format
   * (tmux send-keys, JSONL write, etc.).
   */
  respond(event: NormalisedEvent, choice: UserChoice): Promise<void>;

  /**
   * Determine whether the interactive event has been resolved — the agent has
   * accepted the response and moved on.
   */
  isSettled(event: NormalisedEvent, output: RawOutput): boolean;

  /**
   * Return true if this line is UI chrome (status bar, spinner, decoration)
   * that should be filtered from the terminal text view. Only meaningful
   * agent output (tool results, code, explanations) should pass through.
   * Optional — if not implemented, all lines pass through.
   */
  isChrome?(line: string): boolean;
}

// ─── Probe runner interface (orchestration layer above AgentDriver) ───────────
// The runner uses sendPrompt/waitForIdle/drainOutput — not part of the spec
// AgentDriver interface, but needed by the fingerprinting harness.

export interface ProbeHarness {
  spec: DriverSpec;
  sendPrompt(prompt: string): Promise<void>;
  waitForIdle(timeout_ms?: number): Promise<'idle_timeout' | 'prompt_detected' | 'error'>;
  drainOutput(): NormalisedEvent[];
  dispose(): void;
}

// ─── Probe definitions ────────────────────────────────────────────────────────

export interface ProbeDefinition {
  id: string;                // P01–P10
  event_class: EventClass;
  label: string;
  description: string;
  prompt: string;
}

export interface ProbePromptFile {
  version: string;
  description: string;
  probes: ProbeDefinition[];
}

// ─── Run results ──────────────────────────────────────────────────────────────

export interface ProbeResult {
  id: string;
  run_id: string;
  driver_id: string;
  probe_id: string;
  event_class: EventClass;
  prompt_sent: string;
  raw_output: string;
  normalised: string;
  events: NormalisedEvent[];
  duration_ms: number;
  exit_signal: 'idle_timeout' | 'prompt_detected' | 'error';
  created_at: string;
}

export interface ProbeRun {
  run_id: string;
  driver: DriverSpec;
  probes: ProbeDefinition[];
  results: ProbeResult[];
  started_at: string;
  finished_at?: string;
}
