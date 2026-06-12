/**
 * tmuxBin — canonical tmux binary resolution (rv1/tmux-unify).
 * Resolution-order unit tests live in ptyClient.test.ts (which exercises
 * the same _resolveTmuxBin via ptyClient's re-export, preserving the
 * 6cd33e9 test surface). This file pins the memoisation contract that
 * every call site shares one module-load-resolved constant.
 */

import { describe, it, expect } from 'vitest';
import { TMUX_BIN, _resolveTmuxBin } from './tmuxBin';

describe('tmuxBin — canonical memoised constant', () => {
  it('TMUX_BIN is the module-load memoisation of _resolveTmuxBin against the real env', () => {
    expect(TMUX_BIN).toBe(_resolveTmuxBin());
  });

  it('TMUX_BIN is never the empty string (empty ANT_TMUX_BIN treated as unset)', () => {
    expect(TMUX_BIN.length).toBeGreaterThan(0);
  });
});
