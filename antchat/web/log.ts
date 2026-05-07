// Append-only access log for the local web server.
//
// Writes to ~/.ant/logs/web.log. Rotates the file in place when it exceeds
// 1 MB by renaming to web.log.1 (overwrites the previous .1). Single-file
// rotation is sufficient — this log is for debugging the local server, not
// long-term audit. We don't keep a chain of .2/.3 because the volume is
// orders of magnitude lower than a public web server.
//
// Tokens are redacted from query strings before write — never trust the
// caller to do it. Both ?token= and ?invite= are stripped (the invite token
// is also a credential during the exchange window).

import { appendFileSync, mkdirSync, statSync, renameSync, existsSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

const LOG_DIR = resolve(homedir(), '.ant', 'logs');
const LOG_FILE = resolve(LOG_DIR, 'web.log');
const ROTATE_BYTES = 1024 * 1024; // 1 MB

function ensureDir() {
  try { mkdirSync(LOG_DIR, { recursive: true }); }
  catch { /* best-effort; if this fails, logging silently no-ops */ }
}

function rotateIfLarge() {
  try {
    const st = statSync(LOG_FILE);
    if (st.size > ROTATE_BYTES) {
      renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch { /* file doesn't exist yet; no rotation needed */ }
}

/** Strips known credential params from a URL search string. Returns the
 * sanitised path?query so it's safe to log. */
export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl, 'http://placeholder/');
    if (u.searchParams.has('token')) u.searchParams.set('token', '<redacted>');
    if (u.searchParams.has('invite')) u.searchParams.set('invite', '<redacted>');
    return u.pathname + (u.search || '');
  } catch {
    // Invalid URL — fall back to a regex strip on common patterns.
    return rawUrl
      .replace(/([?&])token=[^&]*/g, '$1token=<redacted>')
      .replace(/([?&])invite=[^&]*/g, '$1invite=<redacted>');
  }
}

let initialised = false;
function init() {
  if (initialised) return;
  initialised = true;
  ensureDir();
}

/** Synchronous append. We accept the small write-stall cost in exchange for
 * not introducing a write queue or async lifecycle into the request path. */
export function logAccess(method: string, url: string, status: number, ms: number, requestId: string) {
  init();
  rotateIfLarge();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    method,
    path: redactUrl(url),
    status,
    ms: Math.round(ms),
    rid: requestId,
  }) + '\n';
  try { appendFileSync(LOG_FILE, line, 'utf8'); }
  catch { /* if the disk is wedged, silently drop the log line */ }
}

export function logEvent(kind: string, fields: Record<string, unknown>) {
  init();
  rotateIfLarge();
  const line = JSON.stringify({ ts: new Date().toISOString(), kind, ...fields }) + '\n';
  try { appendFileSync(LOG_FILE, line, 'utf8'); }
  catch { /* drop */ }
}

export const LOG_PATH = LOG_FILE;
export const LOG_DIR_PATH = LOG_DIR;
export { existsSync };
