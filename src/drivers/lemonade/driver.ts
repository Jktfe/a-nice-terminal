// ANT — LemonadeDriver (STUB)
// File: src/drivers/lemonade/driver.ts
//
// Stub driver for AMD Lemonade.
// Probe date: 2026-04-14
//
// IMPORTANT: Lemonade (/usr/local/bin/lemonade) is an Electron-based
// desktop GUI application, NOT a CLI agent. Invoking it from the terminal
// spawns a system tray + Electron process that crashes on this machine:
//
//   [0414/002624.690325:FATAL] Unable to find helper app
//   Tray launched! (PID: 76949)
//   GPU process exited unexpectedly: exit_code=5
//   Network service crashed, restarting service.
//
// Lemonade does expose a local server (Beacon listener on 0.0.0.0:8000),
// but it requires the GUI to be running and is not a tmux-capturable CLI.
//
// This driver is a no-op stub. detect() always returns null.
// A proper driver would use the HttpDriverConfig against the Beacon API.

import type {
  AgentDriver,
  NormalisedEvent,
  RawEvent,
  RawOutput,
  UserChoice,
} from '../../fingerprint/types.js';

export class LemonadeDriver implements AgentDriver {
  detect(_raw: RawEvent): NormalisedEvent | null {
    // Lemonade is a GUI application — tmux capture is not applicable.
    // A future HTTP driver should target the Beacon API on :8000.
    return null;
  }

  async respond(_event: NormalisedEvent, _choice: UserChoice): Promise<void> {}

  isSettled(_event: NormalisedEvent, _output: RawOutput): boolean {
    return true;
  }
}
