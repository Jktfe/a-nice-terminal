/**
 * paneFactCorroboration — the daemon VERIFIES a CLI-presented pane fact,
 * never trusts it (fableClaude ruling msg_fjbp2o97h9, contract step 3:
 * transport data, not an identity claim).
 *
 * Corroboration = the presented pane exists in tmux AND its pane_pid is a
 * member of the caller's pidChain — i.e. the caller's own process tree is
 * what the pane hosts. Outcomes:
 *  - corroborated: the pane may feed the witness lookup.
 *  - presented but NOT corroborated: treated as ABSENT, and ledgered as
 *    `pane.uncorroborated` — the spoof-shaped signature, recorded from
 *    day one (a caller offering a pane it does not occupy).
 *  - tmux unreachable: absent WITHOUT a ledger row — no evidence either way,
 *    same park-don't-conclude rule as the death witness.
 *  - nothing presented: absent, silent.
 */

import { spawnSync } from 'node:child_process';
import { appendLedger } from './identityLedgerStore';

export type PaneListResult = { status: number; stdout: string; stderr: string };

export type CorroborationOutcome = { pane: string | null; corroborated: boolean };

type PidChainEntryLike = { pid: number; pid_start?: string | null };

let injectedListPanePids: (() => PaneListResult) | null = null;

/** Test seam, mirroring pty-inject-bridge's setSpawnImplForTests. */
export function setListPanePidsForTests(impl: (() => PaneListResult) | null): void {
  injectedListPanePids = impl;
}

function defaultListPanePids(): PaneListResult {
  const childEnv = { ...process.env } as Record<string, string | undefined>;
  delete childEnv.TMUX;
  delete childEnv.TMUX_PANE;
  const result = spawnSync('tmux', ['list-panes', '-a', '-F', '#{pane_id} #{pane_pid}'], {
    env: childEnv as NodeJS.ProcessEnv
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? Buffer.alloc(0)).toString('utf8'),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8')
  };
}

export function corroboratePaneFact(
  presentedPane: string | null,
  pidChain: PidChainEntryLike[],
  options: { listPanes?: () => PaneListResult; listPanePids?: () => PaneListResult } = {}
): CorroborationOutcome {
  if (!presentedPane) return { pane: null, corroborated: false };
  const listPanePids =
    options.listPanePids ?? options.listPanes ?? injectedListPanePids ?? defaultListPanePids;
  let listing: PaneListResult;
  try {
    listing = listPanePids();
  } catch {
    return { pane: null, corroborated: false };
  }
  if (listing.status !== 0) {
    // tmux unreachable: no evidence either way — park, no spoof row.
    return { pane: null, corroborated: false };
  }
  const panePids = new Map<string, number>();
  for (const line of listing.stdout.split('\n')) {
    const [paneId, pidRaw] = line.trim().split(/\s+/);
    if (!paneId || !pidRaw) continue;
    const pid = Number(pidRaw);
    if (Number.isFinite(pid)) panePids.set(paneId, pid);
  }
  const panePid = panePids.get(presentedPane);
  const callerPids = pidChain.map((entry) => entry.pid);
  if (panePid !== undefined && callerPids.includes(panePid)) {
    return { pane: presentedPane, corroborated: true };
  }
  // Presented, observable, NOT occupied by the caller — the spoof signature.
  try {
    appendLedger({
      kind: 'pane.uncorroborated',
      actor: 'daemon',
      detail: {
        presented_pane: presentedPane,
        pane_pid: panePid ?? null,
        caller_pids: callerPids
      }
    });
  } catch { /* ledger failure never blocks resolution */ }
  return { pane: null, corroborated: false };
}
