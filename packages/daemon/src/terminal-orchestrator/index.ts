/**
 * terminal-orchestrator/index.ts
 *
 * Public API for the terminal orchestration layer.
 * Use `getTerminalBackend()` to obtain the singleton backend for the
 * current platform (Ghostty on macOS by default).
 */

export type { TerminalBackend, TerminalInfo, CreateOptions } from "./terminal-backend.js";
export { GhosttyBackend } from "./ghostty-backend.js";

import { GhosttyBackend } from "./ghostty-backend.js";
import type { TerminalBackend } from "./terminal-backend.js";

let _backend: TerminalBackend | null = null;

/**
 * Returns the singleton TerminalBackend instance.
 * Defaults to GhosttyBackend; swap the implementation here to support
 * WezTerm, Kitty, or any other terminal emulator in the future.
 */
export function getTerminalBackend(): TerminalBackend {
  if (!_backend) _backend = new GhosttyBackend();
  return _backend;
}
