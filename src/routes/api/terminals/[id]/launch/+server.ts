/**
 * POST /api/terminals/[id]/launch — server-side launch of a local
 * terminal emulator already attached to this session's tmux pane.
 *
 * Body: { app: 'iterm' | 'ghostty' }
 *
 * The button labels in the UI ("iTerm2", "Ghostty") used to copy a
 * launch command to the clipboard — per JWPK 2026-05-21 ask, they
 * now actually launch the app via this endpoint so a single click does
 * what the label says.
 *
 * App selection is whitelisted to known emulators so the route can't
 * be coerced into running arbitrary commands; the tmux session name
 * comes from the validated terminal record, not the request body.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';

const execFileAsync = promisify(execFile);

type AppKind = 'iterm' | 'ghostty';
const KNOWN_APPS: ReadonlySet<AppKind> = new Set(['iterm', 'ghostty']);

function isAppKind(value: unknown): value is AppKind {
  return typeof value === 'string' && KNOWN_APPS.has(value as AppKind);
}

function tmuxSessionFromPane(targetPane: string | null): string | null {
  if (!targetPane) return null;
  const [session] = targetPane.split(':');
  return session || targetPane;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const terminalId = params.id ?? '';
  if (terminalId.length === 0) throw error(400, 'terminal id required');
  const record = getTerminalRecord(terminalId);
  if (!record) throw error(404, 'terminal not found');

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with an app field.');
  }
  const app = (rawBody as { app?: unknown }).app;
  if (!isAppKind(app)) {
    throw error(400, 'app must be one of: iterm, ghostty');
  }

  const tmuxSession = tmuxSessionFromPane(record.tmux_target_pane) || terminalId;
  const localTmux = `tmux attach-session -t ${shellQuoteSingle(tmuxSession)}`;

  try {
    if (app === 'iterm') {
      // Modern iTerm responds to both "iTerm" and "iTerm2" as the
      // application name; "iTerm2" matches what's been in the access
      // endpoint historically and keeps env consistency.
      const script = `tell application "iTerm2" to create window with default profile command "${localTmux.replace(/"/g, '\\"')}"`;
      await execFileAsync('/usr/bin/osascript', ['-e', script]);
    } else {
      // `open -na Ghostty.app --args -e <cmd>` spawns a NEW instance
      // (so multi-window works) and passes -e through to Ghostty so it
      // runs the attach command in the new pane.
      await execFileAsync('/usr/bin/open', ['-na', 'Ghostty.app', '--args', '-e', localTmux]);
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Launch failed.';
    throw error(500, `Could not launch ${app}: ${message}`);
  }

  return json({ ok: true, app, tmuxSession });
};

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
