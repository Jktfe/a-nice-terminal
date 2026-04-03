/**
 * terminal-backend.ts — abstraction layer for native terminal emulators.
 *
 * Defines the TerminalBackend interface so the orchestrator can swap
 * between Ghostty, WezTerm, or any other terminal without rearchitecting.
 */

export interface TerminalInfo {
  /** ANT session ID */
  id: string;
  /** Process PID if known */
  pid?: number;
  /** Tab title if readable */
  title?: string;
  /** Current working directory if readable */
  cwd?: string;
}

export interface CreateOptions {
  /** ANT session ID to associate with this terminal */
  sessionId: string;
  /** Starting directory (default: process.cwd()) */
  cwd?: string;
  /** Command to run (default: ant-capture wrapping $SHELL) */
  command?: string;
  /** Tab title */
  title?: string;
}

export interface TerminalBackend {
  /** Whether this backend is available on the current platform */
  isAvailable(): Promise<boolean>;

  /** Create a new terminal tab/window */
  create(opts: CreateOptions): Promise<TerminalInfo>;

  /** Send raw text input to a terminal */
  input(sessionId: string, text: string): Promise<void>;

  /** Send a key sequence (e.g. ctrl-c, escape) */
  sendKey(sessionId: string, key: string): Promise<void>;

  /** Execute a command and wait for it to finish (via shell hook event) */
  exec(sessionId: string, command: string, timeoutMs?: number): Promise<{ exitCode: number }>;

  /** Bring terminal to front / focus */
  focus(sessionId: string): Promise<void>;

  /** Close the terminal tab */
  close(sessionId: string): Promise<void>;

  /** List all known terminals */
  list(): Promise<TerminalInfo[]>;
}
