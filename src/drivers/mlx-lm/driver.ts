// ANT — MlxLmDriver (STUB — RETIRED)
// File: src/drivers/mlx-lm/driver.ts
//
// Stub driver for mlx_lm (Apple MLX LM).
// Probe date: 2026-04-14
//
// RETIRED: Per CLAUDE.md project instructions, mlx_lm is marked as RETIRED.
// The mlx_lm Python module is not installed (`import mlx_lm` fails with
// ModuleNotFoundError), though the wrapper scripts exist at:
//   ~/.local/bin/mlx_lm
//   ~/.local/bin/mlx_lm.generate
//
// mlx_lm was a Python package for running LLMs on Apple Silicon via the
// MLX framework. It used `mlx_lm.generate --model <hf-model> --prompt "..."`.
// There were no interactive TUI events — pure completion to stdout.
//
// This driver is a no-op stub. detect() always returns null.

import type {
  AgentDriver,
  NormalisedEvent,
  RawEvent,
  RawOutput,
  UserChoice,
} from '../../fingerprint/types.js';

export class MlxLmDriver implements AgentDriver {
  detect(_raw: RawEvent): NormalisedEvent | null {
    // RETIRED — not functional. Stub only.
    return null;
  }

  async respond(_event: NormalisedEvent, _choice: UserChoice): Promise<void> {}

  isSettled(_event: NormalisedEvent, _output: RawOutput): boolean {
    return true;
  }
}
