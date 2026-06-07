/**
 * GET /api/dev/session-handoff?k=<nonce>
 *
 * Dev-only, phone-friendly bridge so an agent on this Mac can render the
 * operator's AUTHENTICATED view (e.g. iPhone mobile-QA of the in-room chat)
 * WITHOUT the operator extracting an HttpOnly cookie by hand (impossible on
 * mobile Safari) and WITHOUT any agent ever submitting the operator's
 * password (the shared hard guardrail).
 *
 * Flow: the agent arms a one-shot nonce file, hands the operator a single
 * link. The operator — already logged in on their phone — taps it; the
 * server reads THEIR OWN incoming `ant_browser_session` cookie, validates
 * it, and writes that token to a 0600 file on local disk that the agent
 * reads. The token never transits the chat room; it is the operator's own
 * existing session (revocable by logout). The agent deletes the token file
 * after use.
 *
 * Safety:
 *  - INERT unless armed: no nonce file → 404. The agent controls arming via
 *    the local filesystem (not config/secrets).
 *  - Nonce-gated: `?k=` must equal the armed nonce, so a stray hit does
 *    nothing. Single-shot: the nonce file is deleted on first success.
 *  - Auth-required: only ever exposes the CALLER's own validated token. An
 *    unauthenticated or non-operator hit gets 401 and writes nothing.
 *  - Local-only: writes to ~/.ant, never exfiltrates off-machine.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { getCookieValuesFromRequest } from '$lib/server/authGate';
import { resolveBrowserSessionSecretIgnoringRoom } from '$lib/server/browserSessionStore';

const NONCE_FILE = join(homedir(), '.ant', '.session-handoff-nonce');
const TOKEN_FILE = join(homedir(), '.ant', '.session-handoff-token');

function page(title: string, body: string, ok: boolean): Response {
  const tint = ok ? '#1ac270' : '#d91f3f';
  const html = `<!doctype html><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title}</title>
<style>html,body{margin:0;height:100%;font-family:-apple-system,system-ui,sans-serif;background:#fff7ed;color:#181512;display:flex;align-items:center;justify-content:center}
.card{max-width:30rem;margin:1.5rem;padding:1.5rem;border-radius:1rem;background:#fff;box-shadow:0 18px 50px rgb(57 33 20/14%);border-top:4px solid ${tint}}
h1{font-size:1.2rem;margin:0 0 .5rem}p{margin:0;color:#61564d;line-height:1.5}</style>
<div class="card"><h1>${title}</h1><p>${body}</p></div>`;
  return new Response(html, { status: ok ? 200 : 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export const GET: RequestHandler = async ({ request, url }) => {
  // Inert unless the agent has armed a one-shot nonce.
  if (!existsSync(NONCE_FILE)) throw error(404, 'Not found');
  const armedNonce = readFileSync(NONCE_FILE, 'utf8').trim();
  if (armedNonce.length === 0 || url.searchParams.get('k') !== armedNonce) {
    throw error(404, 'Not found');
  }

  // Only ever expose the CALLER's own, currently-valid session token.
  const candidates = getCookieValuesFromRequest(request, 'ant_browser_session');
  const valid = candidates.find((secret) => resolveBrowserSessionSecretIgnoringRoom(secret) !== null);
  if (!valid) {
    return page(
      'Not signed in',
      'Open this link in the same browser/tab where you are logged in to ANT, then tap it again.',
      false
    );
  }

  writeFileSync(TOKEN_FILE, valid, { mode: 0o600 });
  // Single-shot: disarm so the link can't be reused.
  try { unlinkSync(NONCE_FILE); } catch { /* already gone */ }

  return page(
    'Handed off to @speedy ✓',
    'Your session was passed to the agent locally (it never went through the chat). You can close this tab — @speedy will render your room now.',
    true
  );
};
