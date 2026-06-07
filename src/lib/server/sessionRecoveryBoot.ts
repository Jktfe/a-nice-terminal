/**
 * sessionRecoveryBoot — optional hands-off recovery after a reboot.
 *
 * Default OFF so existing installs are unchanged. When `ANT_AUTORECOVER_SESSIONS`
 * is set, a one-shot (globalThis-guarded) pass recreates every not-alive ANT
 * terminal's tmux pane in its original cwd and rebinds identity. Relaunching the
 * agent (typing the launch command into the pane) is higher-stakes, so it's
 * gated behind a SECOND flag, `ANT_AUTORECOVER_AGENTS`.
 *
 * This is the "enterprise" path: the launchd-managed server boots after a
 * restart, this fires, and the fleet self-heals with zero manual steps. The
 * /terminals buttons + `ant sessions recover` remain the primary, inspectable
 * path.
 */

import { listTerminalRecords } from './terminalRecordsStore';
import { listTerminals } from './ptyClient';
import { recoverSessions } from './sessionRecovery';

const BOOT_KEY = '__antSessionRecoveryBooted';

function isEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function ensureSessionRecoveryBooted(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
  if (!isEnabled(process.env.ANT_AUTORECOVER_SESSIONS)) return;
  const launchAgent = isEnabled(process.env.ANT_AUTORECOVER_AGENTS);

  // Fire-and-forget — boot must never block on tmux subprocesses. Defer a tick
  // so the rest of the boot wiring (poller, watchers) settles first.
  setTimeout(() => {
    void (async () => {
      try {
        const aliveSet = new Set(await listTerminals());
        const dead = listTerminalRecords()
          .filter((r) => !aliveSet.has(r.session_id))
          .map((r) => r.session_id);
        if (dead.length === 0) return;
        const outcomes = await recoverSessions(dead, { launchAgent });
        const recovered = outcomes.filter((o) => o.action === 'spawned').length;
        console.log(`[session-recovery] auto-recovered ${recovered}/${dead.length} session(s)${launchAgent ? ' (agents relaunched)' : ' (panes only)'}`);
      } catch (cause) {
        console.warn('[session-recovery] auto-recover failed', cause);
      }
    })();
  }, 2000).unref?.();
}
