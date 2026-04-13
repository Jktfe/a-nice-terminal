// ANT Fingerprinting Pipeline — shared TypeScript types
// File: src/fingerprint/types.ts

// ─── Event classes ────────────────────────────────────────────────────────────

export type EventClass =
  | 'tool_use'
  | 'tool_result'
  | 'text_message'
  | 'error_recovery'
  | 'multi_step_reasoning'
  | 'file_read'
  | 'file_write'
  | 'bash_execution'
  | 'session_lifecycle'
  | 'search_grep';

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

// ─── Agent driver (runtime) ───────────────────────────────────────────────────
// The live object instantiated by the runner from a DriverSpec.

export interface AgentDriver {
  spec: DriverSpec;
  /** Inject a prompt string into the target agent's input. */
  sendPrompt(prompt: string): Promise<void>;
  /** Wait until the agent has finished responding (idle or prompt detected). */
  waitForIdle(timeout_ms?: number): Promise<'idle_timeout' | 'prompt_detected' | 'error'>;
  /** Drain all buffered output since the last call. */
  drainOutput(): NormalisedEvent[];
  /** Clean up resources (close tmux control socket, etc.). */
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
