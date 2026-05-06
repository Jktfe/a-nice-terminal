// macOS notifier — surfaces @-mentions through osascript.
//
// Quietly degrades to no-op on non-macOS platforms or when osascript isn't on
// PATH. The watcher (WS4E) reuses this module via launchd so it must remain
// dependency-free and side-effect-safe at import time.

import { execFile } from 'child_process';

export interface NotifyOptions {
  title: string;
  message: string;
  // Optional subtitle line — macOS renders it between title and body.
  subtitle?: string;
  // Optional sound name (e.g. 'Submarine'). Falls back to default if missing.
  sound?: string;
}

let warned = false;

/** Check whether macOS notifications are available in this process. */
export function notifierAvailable(): boolean {
  return process.platform === 'darwin';
}

// AppleScript treats double quotes as string delimiters and backslashes as
// escapes, so anything we interpolate must be defanged before reaching
// `osascript -e`.
function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Trigger a macOS user notification.
 *
 * Resolves once osascript exits; never throws — notification failures must
 * not bring down the watcher loop. On non-macOS hosts (CI, Linux) the call
 * resolves immediately as a no-op.
 */
export async function notify(opts: NotifyOptions): Promise<void> {
  if (!notifierAvailable()) {
    if (!warned) {
      warned = true;
      console.error('antchat: notifications skipped — only macOS is supported.');
    }
    return;
  }

  const parts = [
    `display notification "${escapeAppleScript(opts.message)}"`,
    `with title "${escapeAppleScript(opts.title)}"`,
  ];
  if (opts.subtitle) parts.push(`subtitle "${escapeAppleScript(opts.subtitle)}"`);
  if (opts.sound) parts.push(`sound name "${escapeAppleScript(opts.sound)}"`);
  const script = parts.join(' ');

  await new Promise<void>((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 4000 }, (err) => {
      if (err && !warned) {
        warned = true;
        console.error(`antchat: osascript notification failed — ${err.message}`);
      }
      resolve();
    });
  });
}

/**
 * Detect whether `text` mentions the supplied handle (e.g. `@stevo`). Uses a
 * non-greedy boundary so the @-token is matched whole — `@stev` doesn't fire
 * on a `@stevo` mention.
 */
export function mentionsHandle(text: string, handle: string | null | undefined): boolean {
  if (!handle || !text) return false;
  const trimmed = handle.startsWith('@') ? handle : `@${handle}`;
  // Word-boundary on the handle's tail; the leading `@` is its own boundary.
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`);
  return pattern.test(text);
}
