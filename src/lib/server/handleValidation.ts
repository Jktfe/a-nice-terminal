/**
 * handleValidation — server-side validation for terminal-record handles.
 *
 * Fix #3 of the 2026-05-30 enterprise security pass (sec-iter1 / M13
 * reserved-list enforcement). Owns the data-driven reserved handle list +
 * the canonical character/length/leading-@ checks for any code path that
 * accepts a caller-supplied handle (today: `/api/identity/register`;
 * future: `ant identity set-handle`, `/api/agents` registrations).
 *
 * Reserved-handle list lives at `data/reserved-handles.json`. Loaded once
 * at module-load time and cached; case-insensitive match (so `@Admin`,
 * `@ADMIN`, `@admin` all collapse to a reserved hit).
 *
 * Validation rules:
 *   1. trim + non-empty after trim
 *   2. leading-`@` normalisation (input may or may not include it; the
 *      canonical form on disk always has it)
 *   3. length 2..64 (canonical form including the leading `@`)
 *   4. local-part character whitelist:
 *        a-z A-Z 0-9 _ . -    (alphanumeric, dot, dash, underscore)
 *      Period and dash cannot lead or trail the local part (RFC-5321
 *      style) to avoid `@.foo`, `@foo-` ambiguity in URL paths.
 *   5. NOT in the reserved list (case-insensitive)
 *
 * Returns a discriminated-union result so callers can branch on `ok` and
 * surface the structured `reason` in 4xx error bodies. The reason strings
 * are stable identifiers (matched in tests) and a human-readable message
 * the endpoint can echo back to the operator.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type HandleValidationOk = { ok: true; canonicalHandle: string };
export type HandleValidationFail = { ok: false; reason: HandleValidationReason; message: string };
export type HandleValidationResult = HandleValidationOk | HandleValidationFail;

export type HandleValidationReason =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'invalid_characters'
  | 'reserved';

const MIN_LENGTH_INCL_AT = 2;   // `@a`
const MAX_LENGTH_INCL_AT = 64;  // matches DNS-style label budget

// Local-part regex: at least one allowed char, leading/trailing must be
// alphanumeric or underscore (dot/dash cannot lead/trail). Inner chars
// may include dot/dash/underscore freely.
const LOCAL_PART_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9_.\-]*[A-Za-z0-9_])?$/;

let cachedReservedHandles: Set<string> | null = null;

/**
 * Resolve the on-disk reserved-handles file. Lives at repo-relative
 * `data/reserved-handles.json`. The repo root is resolved by walking up
 * from this file's directory (server-side bundlers may rewrite the
 * file path so we don't rely on import.meta.url alone).
 *
 * The function falls back to a hard-coded copy of the list if the file
 * is missing in production (defensive — broken deploy should still
 * enforce the reserved list).
 */
function resolveReservedHandlesPath(): string | null {
  // Walk up from cwd (the working dir is the repo root when started via
  // `bun dev` / `vite`). Tests call `resetReservedHandlesCache()` to
  // refresh the cache when fixtures move the file around.
  const candidates = [
    join(process.cwd(), 'data', 'reserved-handles.json'),
    // Also try alongside the compiled output (for bundled deploys).
    join(process.cwd(), '..', 'data', 'reserved-handles.json')
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Hard-coded fallback so the validator NEVER fails-open if the JSON file
 * is missing or unreadable. The file is the source of truth in
 * development; this list mirrors it.
 */
const FALLBACK_RESERVED_HANDLES = [
  '@you',
  '@me',
  '@everyone',
  '@here',
  '@anyone',
  '@broadcast',
  '@any',
  '@all',
  '@channel',
  '@system',
  '@ant',
  '@nobody',
  '@null',
  '@admin',
  '@antadmin',
  '@chair',
  '@antchair'
];

/**
 * Load (or return cached) reserved-handle set. All entries lowercased
 * for case-insensitive lookup.
 */
export function loadReservedHandles(): Set<string> {
  if (cachedReservedHandles) return cachedReservedHandles;
  const path = resolveReservedHandlesPath();
  let raw: string[];
  if (path) {
    try {
      const text = readFileSync(path, 'utf8');
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('reserved-handles.json must be a JSON array');
      raw = parsed.filter((h): h is string => typeof h === 'string');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[handleValidation] failed to read data/reserved-handles.json; using fallback:', err);
      raw = FALLBACK_RESERVED_HANDLES;
    }
  } else {
    raw = FALLBACK_RESERVED_HANDLES;
  }
  cachedReservedHandles = new Set(raw.map((h) => normaliseHandle(h).toLowerCase()));
  return cachedReservedHandles;
}

/**
 * Test-only helper: invalidates the cached reserved-handle set so tests
 * can swap the on-disk JSON between cases without bouncing the module.
 */
export function resetReservedHandlesCache(): void {
  cachedReservedHandles = null;
}

/**
 * Normalise a raw handle to its canonical leading-`@` form. Trims
 * surrounding whitespace. Returns the empty string when the input is
 * empty after trimming (the caller's `empty` validator catches this).
 */
export function normaliseHandle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

/**
 * Case-insensitive reserved-handle check. Pass the RAW handle — the
 * helper normalises + lowercases before consulting the set.
 */
export function isReservedHandle(handle: string): boolean {
  const normalised = normaliseHandle(handle);
  if (normalised.length === 0) return false;
  return loadReservedHandles().has(normalised.toLowerCase());
}

/**
 * Full validation pipeline for register-time handle assignment.
 *
 * Returns a discriminated union; callers do `if (!result.ok) throw
 * error(400, result.message)` and surface `result.reason` for tests +
 * structured-error consumers.
 */
export function validateHandleForRegistration(handle: unknown): HandleValidationResult {
  if (typeof handle !== 'string') {
    return { ok: false, reason: 'empty', message: 'handle must be a string.' };
  }
  const trimmed = handle.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty', message: 'handle must be a non-empty string.' };
  }
  const canonical = normaliseHandle(trimmed);
  if (canonical.length < MIN_LENGTH_INCL_AT) {
    return {
      ok: false,
      reason: 'too_short',
      message: `handle must be at least ${MIN_LENGTH_INCL_AT} characters (including the leading @).`
    };
  }
  if (canonical.length > MAX_LENGTH_INCL_AT) {
    return {
      ok: false,
      reason: 'too_long',
      message: `handle must be at most ${MAX_LENGTH_INCL_AT} characters (including the leading @).`
    };
  }
  const localPart = canonical.slice(1);
  if (!LOCAL_PART_RE.test(localPart)) {
    return {
      ok: false,
      reason: 'invalid_characters',
      message:
        "handle may contain only letters, digits, '_', '-', '.', and must not start or end with '.' or '-'."
    };
  }
  if (isReservedHandle(canonical)) {
    return {
      ok: false,
      reason: 'reserved',
      message: `handle '${canonical}' is reserved and cannot be assigned to a terminal.`
    };
  }
  return { ok: true, canonicalHandle: canonical };
}
