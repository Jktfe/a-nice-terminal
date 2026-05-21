// hooks.server.ts — SvelteKit server-startup wiring (M3.2c follow-up).
// First request triggers a globalThis-guarded one-shot startPoller() call so
// the agentStatusPoller actually runs in production. classifyIfUnknown then
// fires on every poll-tick for NULL-kind terminals (M3.2c integration was
// shipped 2026-05-14 but never engaged — this closes the gap).
import type { Handle } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { startPoller } from '$lib/server/agentStatusPoller';
import { ensureRunEventsPersistenceBooted } from '$lib/server/terminalRunEventsBoot';
import { ensureOperationalRetentionSweepBooted } from '$lib/server/operationalRetention';
import { ensureCronJobTickerBooted } from '$lib/server/cronJobTicker';
import { projectAntRegistryFileBestEffort } from '$lib/server/antRegistryFile';
import { resolveBrowserSessionSecretIgnoringRoom } from '$lib/server/browserSessionStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  requireChatRoomReadAccess,
  resolveChatRoomReadAccess
} from '$lib/server/chatRoomReadGate';

const POLLER_BOOTED_KEY = '__antPollerBootedAt';

function bootPollerOnce(): void {
  const slot = globalThis as Record<string, unknown>;
  if (slot[POLLER_BOOTED_KEY]) return;
  // startPoller is itself idempotent (returns existing controller on
  // re-call), but the boot-flag avoids the unnecessary import-traversal
  // on every request after the first.
  startPoller();
  // TERMINALS-T2a: subscribe to v3 pty-daemon output once + persist as
  // run_events for ANT-view "retained forever" scrollback.
  ensureRunEventsPersistenceBooted();
  // #164: terminal_run_events/cli_hook_events are operational telemetry,
  // not permanent product data. Keep the visible recent window and sweep
  // old rows nightly so the SQLite file cannot grow without bound again.
  ensureOperationalRetentionSweepBooted();
  // #141: project the current terminal/agent registry to a markdown file
  // on boot so recovery state exists even before the next register event.
  projectAntRegistryFileBestEffort();
  // Cron-jobs primitive (JWPK msg_hjv6ac64zo 2026-05-19): server-side
  // ticker that fires `status='running'` cron_jobs rows whose
  // next_fire_at_ms is in the past. Boot-once via globalThis flag so
  // dev HMR / multiple imports don't double-subscribe.
  ensureCronJobTickerBooted();
  slot[POLLER_BOOTED_KEY] = Date.now();
}

// JWPK msg_yh5d58msjf demo-login gate. When ANT_DEMO_EMAIL is set on
// the launchd plist, anonymous visitors get redirected to /login until
// they sign in. Unsetting the env disables the gate entirely with zero
// code change.
//
// Paths that bypass the gate (so /login itself can load + the auth
// endpoint can be POSTed to + SvelteKit's own infra works):
//   - /login
//   - /api/auth/* (the demo-login endpoint + future auth surface)
//   - /api/health (operational liveness probe — gating it would break
//     external uptime monitors)
//   - SvelteKit-internal /_app/* JS/CSS chunks (must be reachable so
//     /login itself can render)
//   - favicon.ico and similar static assets
function isGateBypassPath(pathname: string): boolean {
  if (pathname === '/login' || pathname.startsWith('/login/')) return true;
  // ALL /api/* endpoints bypass the page-gate. The demo-login gate is for
  // unauthenticated browser PAGES. API endpoints already enforce identity
  // via pidChain + room-membership resolvers (server-resolved). Gating /api/*
  // here would break the agent CLI fleet which posts to chat/asks/plans
  // without browser sessions — agents got 303→/login instead of 403 after
  // initial ship 2026-05-18 (msg_kqmykpllfy → coordinator hot-patch).
  if (pathname.startsWith('/api/')) return true;
  if (pathname.startsWith('/_app/')) return true;
  if (pathname === '/favicon.ico') return true;
  return false;
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/**
 * Multi-cookie iteration — JWPK msg_6556jggvwk (2026-05-19): /plans/triggers
 * redirect loop. Browsers send multiple `ant_browser_session=...` cookies
 * when paths differ (Path=/ demo-login + Path=/api/chat-rooms/{id} per-room
 * mints). The single-readCookie path returns only the first match, so if
 * the room-scoped cookie sorts ahead of the demo-login cookie, the page-gate
 * tests it via `resolveBrowserSessionSecretIgnoringRoom` and gets nothing
 * because that helper validates against the FULL secret table — but only
 * one of the inputs gets a chance. Mirrors the multi-cookie fix that
 * 2dd31af + b185190 + 4924827 applied to /api/* paths.
 */
function readAllCookies(cookieHeader: string | null, name: string): string[] {
  if (!cookieHeader) return [];
  const matches: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) matches.push(trimmed.slice(eq + 1));
  }
  return matches;
}

function gateIsEnabled(): boolean {
  return !!process.env.ANT_DEMO_EMAIL && !!process.env.ANT_DEMO_PASSWORD;
}

function isAuthenticated(event: { request: Request }): boolean {
  const secrets = readAllCookies(event.request.headers.get('cookie'), 'ant_browser_session');
  if (secrets.length === 0) return false;
  // ANY of the multiple cookies resolving counts as authenticated. Fixes
  // JWPK msg_6556jggvwk /plans/triggers redirect loop where the first-
  // returned cookie was room-scoped + the demo-login cookie sorted second.
  for (const secret of secrets) {
    if (resolveBrowserSessionSecretIgnoringRoom(secret) !== null) return true;
  }
  return false;
}

async function gateChatRoomReadApi(event: Parameters<Handle>[0]['event']): Promise<void> {
  if (event.request.method !== 'GET') return;
  const pathname = event.url.pathname;

  if (pathname === '/api/chat-rooms/recovery') {
    const access = await resolveChatRoomReadAccess(event.request);
    if (!access) throw error(401, 'Authentication required.');
    if (!access.isAdminBearer) throw error(404, 'Room not found.');
    return;
  }

  const prefix = '/api/chat-rooms/';
  if (!pathname.startsWith(prefix)) return;
  if (pathname === '/api/chat-rooms/messages/pending') return;
  const roomId = pathname.slice(prefix.length).split('/')[0];
  if (!roomId || roomId === 'messages' || roomId === 'recovery') return;

  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found.');
  await requireChatRoomReadAccess(event.request, room);
}

export const handle: Handle = async ({ event, resolve }) => {
  bootPollerOnce();
  await gateChatRoomReadApi(event);

  // Demo-login gate runs before route handling so anonymous visitors
  // never see app pages while the gate is on. JWPK msg about repeated
  // "I get redirected and can't get back where I was" pain (2026-05-19):
  // preserve the originally-requested URL as `?next=` so /login can hop
  // the operator back after sign-in, instead of always dumping to /rooms.
  if (gateIsEnabled() && !isGateBypassPath(event.url.pathname) && !isAuthenticated(event)) {
    const nextPath = event.url.pathname + event.url.search;
    const loginUrl = nextPath && nextPath !== '/'
      ? `/login?next=${encodeURIComponent(nextPath)}`
      : '/login';
    throw redirect(303, loginUrl);
  }

  const response = await resolve(event);
  // GAP-55 dogfood-pause root cause (2026-05-14): rebuilds change chunk hashes
  // (e.g. 12.OldHash.js → 12.NewHash.js). Browsers caching old SSR HTML keep
  // referencing the stale modulepreload links → 404 → app silently breaks
  // (e.g. SSE subscription never initialises). Prevent that by telling the
  // browser to revalidate HTML on every navigation. Hashed JS/CSS chunks
  // remain immutable per Vite's default Cache-Control + content-hash naming.
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('text/html')) {
    response.headers.set('cache-control', 'no-cache, no-store, must-revalidate');
  }
  return response;
};

// Test seam — lets the test reset the boot flag between cases.
export function _testResetPollerBoot(): void {
  const slot = globalThis as Record<string, unknown>;
  delete slot[POLLER_BOOTED_KEY];
}
