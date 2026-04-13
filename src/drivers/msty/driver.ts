// ANT — MstyDriver (STUB — NOT INSTALLED)
// File: src/drivers/msty/driver.ts
//
// Stub driver for Msty CLI.
// Probe date: 2026-04-14
//
// `msty` was not found on this machine (`which msty` returned not found).
// This stub exists to document the planned driver location.
//
// Msty is a local AI desktop application with an optional CLI interface.
// When available, expected interaction model: pure completion CLI
// (similar to `llm`), with no permission TUIs.
//
// detect() always returns null.

import type {
  AgentDriver,
  NormalisedEvent,
  RawEvent,
  RawOutput,
  UserChoice,
} from '../../fingerprint/types.js';

export class MstyDriver implements AgentDriver {
  detect(_raw: RawEvent): NormalisedEvent | null {
    // msty not installed — stub only.
    return null;
  }

  async respond(_event: NormalisedEvent, _choice: UserChoice): Promise<void> {}

  isSettled(_event: NormalisedEvent, _output: RawOutput): boolean {
    return true;
  }
}
