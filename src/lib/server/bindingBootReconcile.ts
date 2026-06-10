/**
 * bindingBootReconcile — the boot-time half of the daemon witness (AC3 Step 1,
 * ant-handles-rooms-ownership-contract.md 2026-06-10).
 *
 * Covers the powercut case: daemon and panes die together, so no live
 * observer saw the panes go. On boot we diff `tmux list-panes -a` against the
 * live handle_bindings rows; a binding whose pane the tmux server does not
 * list is positively dead → tombstone + vacate. If the tmux server itself is
 * unreachable, the pass SKIPS — absence of evidence is not evidence, and
 * tombstoning on a server hiccup is exactly the mass-false-vacancy failure
 * the witness exists to prevent.
 *
 * Pane-less bindings are never touched here: nothing was witnessed about
 * them, so this pass has no evidence either way.
 */

import { spawnSync } from 'node:child_process';
import { listLiveBindings, tombstoneBinding } from './handleBindingsStore';

export type ListPanesResult = { status: number; stdout: string; stderr: string };

export type BootReconcileResult = {
  skipped: boolean;
  skipReason: string | null;
  observedPaneCount: number;
  tombstoned: string[];
};

function defaultListPanes(): ListPanesResult {
  const childEnv = { ...process.env } as Record<string, string | undefined>;
  delete childEnv.TMUX;
  delete childEnv.TMUX_PANE;
  const result = spawnSync('tmux', ['list-panes', '-a', '-F', '#{pane_id}'], {
    env: childEnv as NodeJS.ProcessEnv
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? Buffer.alloc(0)).toString('utf8'),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8')
  };
}

export function reconcileBindingsAtBoot(
  options: { listPanes?: () => ListPanesResult } = {}
): BootReconcileResult {
  const listPanes = options.listPanes ?? defaultListPanes;
  let listing: ListPanesResult;
  try {
    listing = listPanes();
  } catch (cause) {
    return {
      skipped: true,
      skipReason: `list-panes threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      observedPaneCount: 0,
      tombstoned: []
    };
  }
  if (listing.status !== 0) {
    return {
      skipped: true,
      skipReason: listing.stderr.trim() || `tmux exited ${listing.status}`,
      observedPaneCount: 0,
      tombstoned: []
    };
  }
  const observed = new Set(
    listing.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  );
  const tombstoned: string[] = [];
  for (const binding of listLiveBindings()) {
    if (!binding.pane) continue;
    if (observed.has(binding.pane)) continue;
    if (tombstoneBinding(binding.handle, 'boot-reconcile')) {
      tombstoned.push(binding.handle);
    }
  }
  if (tombstoned.length > 0) {
    // Forensic trail, same rule as the auto-rebind log: an operational
    // decision invisible to the operator is a bug.
    // eslint-disable-next-line no-console
    console.log(
      `[boot-reconcile] observed=${observed.size} panes, tombstoned=${tombstoned.join(',')}`
    );
  }
  return {
    skipped: false,
    skipReason: null,
    observedPaneCount: observed.size,
    tombstoned
  };
}
