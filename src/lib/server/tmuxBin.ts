/**
 * tmuxBin — single source of truth for which tmux binary the server spawns.
 *
 * Extracted from ptyClient.ts (6cd33e9) so parsers, route handlers, the
 * inject bridge, and the status poller can import the resolved binary
 * without pulling in ptyClient itself: several of their test files
 * vi.mock('node:child_process') with spawnSync-only factories, and
 * ptyClient's module-scope promisify(execFile) would throw under those
 * mocks. This module deliberately imports node:fs only. (There is no
 * import cycle either way — ptyClient imports no local modules — the
 * test-harness entanglement is the reason for the separate module.)
 *
 * Deliberate semantic unification (rv1/tmux-unify): an empty-string
 * ANT_TMUX_BIN is treated as unset. The historical per-module
 * `process.env.ANT_TMUX_BIN ?? '/opt/homebrew/bin/tmux'` sites would
 * have spawned '' in that case; the truthy guard here falls through to
 * the well-known paths instead.
 */

import { existsSync } from 'node:fs';

/** Well-known tmux install locations, in preference order: Homebrew on
 *  Apple Silicon, then Homebrew/MacPorts-adjacent on Intel (/usr/local). */
const TMUX_CANDIDATES = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux'];

/** Resolve the tmux binary. Order: ANT_TMUX_BIN env override (truthy),
 *  first existing well-known path, then bare 'tmux' so PATH-only installs
 *  still work. Exported for unit tests (injectable env/exists seams) —
 *  production callers use the memoised TMUX_BIN constant. */
export function _resolveTmuxBin(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync
): string {
  if (env.ANT_TMUX_BIN) return env.ANT_TMUX_BIN;
  for (const candidate of TMUX_CANDIDATES) {
    if (exists(candidate)) return candidate;
  }
  return 'tmux';
}

/** Canonical tmux binary, resolved once at module load. Every tmux call
 *  site imports this instead of re-deriving its own fallback. */
export const TMUX_BIN = _resolveTmuxBin();
