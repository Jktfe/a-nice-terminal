// Auth primitives for the local web server.
//
// • Launch-token mint (UUID v4) — generated once per `antchat web run` OR
//   loaded from macOS Keychain when invoked with --launch-token-from-keychain
//   (the daemon path, so the URL bookmark survives restarts).
// • Keychain helpers — wrap `security add/find/delete-generic-password`.
// • CSRF double-submit — per-launch token, checked on mutating routes.
// • Cookie parse + Set-Cookie helpers.
// • Middleware-style check fns that `server.ts` composes per route.
//
// The auth model: launch-token UUID arrives via URL fragment (#token=...).
// An inline boot script in index.html copies it into the __antchat cookie
// and history.replaceStates the fragment away. All /api/* routes require
// the cookie; mutating routes additionally require a matching __csrf cookie
// + X-CSRF header (double-submit). All routes 403 if Origin is present and
// not http://127.0.0.1:<port> or http://localhost:<port>.
//
// Loopback HTTP only — Secure cookie flag would block the browser, so we
// rely on SameSite=Strict + Origin enforcement for cross-site protection.

import { spawn } from 'child_process';
import { timingSafeEqual, randomUUID } from 'crypto';

export const KEYCHAIN_SERVICE = 'com.jktfe.antchat.web';
export const KEYCHAIN_ACCOUNT = 'launch-token';

export const COOKIE_LAUNCH = '__antchat';
export const COOKIE_CSRF = '__csrf';
export const HEADER_CSRF = 'x-csrf';

// ─── Token mint ─────────────────────────────────────────────────────────────

export function mintLaunchToken(): string {
  return randomUUID();
}

export function mintCsrfToken(): string {
  return randomUUID();
}

/**
 * Length-aware constant-time compare. timingSafeEqual throws on length
 * mismatch, so we short-circuit on length first (which is itself non-secret —
 * UUIDs are always 36 bytes).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ─── macOS Keychain ─────────────────────────────────────────────────────────

interface SpawnResult { code: number; stdout: string; stderr: string }

function spawnSecurity(args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('security', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export const keychain = {
  /** Stores `value` under (service, account). -U updates if it already exists. */
  async set(service: string, account: string, value: string): Promise<void> {
    const { code, stderr } = await spawnSecurity([
      'add-generic-password',
      '-s', service,
      '-a', account,
      '-w', value,
      '-U',
    ]);
    if (code !== 0) {
      throw new Error(`security add-generic-password failed (code ${code}): ${stderr.trim()}`);
    }
  },

  /**
   * Returns the stored secret, or null if absent. The first read for a given
   * (service, account) on a freshly-installed daemon surfaces a Keychain prompt
   * to the user; subsequent reads from the same binary are silent.
   */
  async get(service: string, account: string): Promise<string | null> {
    const { code, stdout, stderr } = await spawnSecurity([
      'find-generic-password',
      '-s', service,
      '-a', account,
      '-w',
    ]);
    if (code === 44) return null; // SecKeychainItemNotFound
    if (code !== 0) {
      throw new Error(`security find-generic-password failed (code ${code}): ${stderr.trim()}`);
    }
    return stdout.replace(/\n$/, '');
  },

  /** Idempotent delete. */
  async del(service: string, account: string): Promise<void> {
    const { code, stderr } = await spawnSecurity([
      'delete-generic-password',
      '-s', service,
      '-a', account,
    ]);
    if (code !== 0 && code !== 44) {
      throw new Error(`security delete-generic-password failed (code ${code}): ${stderr.trim()}`);
    }
  },

  /** Read or mint+store the launch token. Used by the daemon entry path. */
  async readOrMintLaunchToken(): Promise<string> {
    const existing = await this.get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    if (existing) return existing;
    const minted = mintLaunchToken();
    await this.set(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, minted);
    return minted;
  },

  /** Forced rotation — use when the user runs `antchat web rotate-token`. */
  async rotateLaunchToken(): Promise<string> {
    const minted = mintLaunchToken();
    await this.set(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, minted);
    return minted;
  },
};

// ─── Cookies ────────────────────────────────────────────────────────────────

export function parseCookies(header: string | null | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim();
    const raw = pair.slice(idx + 1).trim();
    if (!name) continue;
    try { out[name] = decodeURIComponent(raw); }
    catch { out[name] = raw; }
  }
  return out;
}

export interface SetCookieOpts {
  path?: string;
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export function buildSetCookie(name: string, value: string, opts: SetCookieOpts = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.maxAgeSeconds != null) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  parts.push(`SameSite=${opts.sameSite ?? 'Strict'}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

// ─── Per-request checks ─────────────────────────────────────────────────────

export interface AuthCtx {
  launchToken: string;
  csrfToken: string;
  port: number;
}

export type AuthFailure =
  | 'missing-cookie'
  | 'token-mismatch'
  | 'missing-csrf'
  | 'csrf-mismatch'
  | 'origin-blocked';

export interface AuthCheckResult {
  ok: boolean;
  reason?: AuthFailure;
  detail?: string;
}

/**
 * Validates the launch-token cookie on every /api/* route. Static routes (/,
 * /static/*) skip this — the bootstrap script needs to run before the cookie
 * exists.
 */
export function checkLaunchAuth(req: Request, ctx: AuthCtx): AuthCheckResult {
  const cookies = parseCookies(req.headers.get('cookie'));
  const presented = cookies[COOKIE_LAUNCH];
  if (!presented) return { ok: false, reason: 'missing-cookie' };
  if (!constantTimeEqual(presented, ctx.launchToken)) return { ok: false, reason: 'token-mismatch' };
  return { ok: true };
}

/**
 * Double-submit CSRF check on mutating methods. GET/HEAD/OPTIONS are exempt
 * (read-only; SSE GET to /api/rooms/:id/stream is also read-only by design).
 */
export function checkCsrf(req: Request, ctx: AuthCtx): AuthCheckResult {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return { ok: true };
  const cookies = parseCookies(req.headers.get('cookie'));
  const cookieToken = cookies[COOKIE_CSRF];
  const headerToken = req.headers.get(HEADER_CSRF);
  if (!cookieToken || !headerToken) return { ok: false, reason: 'missing-csrf' };
  if (!constantTimeEqual(cookieToken, headerToken)) return { ok: false, reason: 'csrf-mismatch' };
  if (!constantTimeEqual(cookieToken, ctx.csrfToken)) return { ok: false, reason: 'csrf-mismatch' };
  return { ok: true };
}

/**
 * Origin must be loopback when present. EventSource sends Origin from the
 * browser; curl / native clients omit it and rely solely on the cookie.
 */
export function checkOrigin(req: Request, port: number): AuthCheckResult {
  const origin = req.headers.get('origin');
  if (!origin) return { ok: true };
  if (origin === `http://127.0.0.1:${port}`) return { ok: true };
  if (origin === `http://localhost:${port}`) return { ok: true };
  return { ok: false, reason: 'origin-blocked', detail: origin };
}

/** One-shot check used by /api/* handlers; returns the failing Response or null. */
export function applyApiGuards(req: Request, ctx: AuthCtx): Response | null {
  const origin = checkOrigin(req, ctx.port);
  if (!origin.ok) {
    return new Response(JSON.stringify({ error: 'forbidden', reason: origin.reason, detail: origin.detail }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  const auth = checkLaunchAuth(req, ctx);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: 'unauthorized', reason: auth.reason }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  const csrf = checkCsrf(req, ctx);
  if (!csrf.ok) {
    return new Response(JSON.stringify({ error: 'forbidden', reason: csrf.reason }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  return null;
}
