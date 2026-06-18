import { getIdentityDb } from './db';

const OPERATOR_EMAIL_CONFIG_KEY = 'operator_email';

/**
 * The operator's configured ACCOUNT email — the forge-proof anchor for deciding
 * "is this Bearer the operator?" on operator-gated endpoints.
 *
 * Why an email and not a handle: antchat handles are derived from the email
 * local-part (or a stored override) and then alias-canonicalised, so a handle
 * like `@JWPK` can be PRODUCED by a non-operator account (local-part `jwpk`, or
 * `@you`). The email is an account identity the operator actually owns (it is
 * password-protected at login), so it cannot be spoofed by handle projection.
 *
 * Precedence:
 *   1. ANT_OPERATOR_EMAIL / ANT_DEMO_EMAIL — low-level ops override.
 *   2. server_config.operator_email — trusted setup/account-confirm value.
 *
 * Returns null when neither is set — callers MUST fail closed (deny), never
 * open up, when there is no configured operator email.
 */
export function getOperatorEmail(): string | null {
  return operatorEmailFromEnv() ?? getPersistedOperatorEmail();
}

export function getPersistedOperatorEmail(): string | null {
  const row = getIdentityDb()
    .prepare(`SELECT value FROM server_config WHERE key = ?`)
    .get(OPERATOR_EMAIL_CONFIG_KEY) as { value: string } | undefined;
  return row ? normalizeOperatorEmailOrNull(row.value) : null;
}

export function setOperatorEmail(input: {
  email: string;
  updatedBy?: string | null;
  nowMs?: number;
}): string {
  const email = normalizeOperatorEmailOrThrow(input.email);
  const nowMs = input.nowMs ?? Date.now();
  getIdentityDb()
    .prepare(
      `INSERT INTO server_config (key, value, updated_at_ms, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at_ms = excluded.updated_at_ms,
         updated_by = excluded.updated_by`
    )
    .run(OPERATOR_EMAIL_CONFIG_KEY, email, nowMs, input.updatedBy ?? null);
  return email;
}

export function normalizeOperatorEmailOrThrow(raw: string): string {
  const email = normalizeOperatorEmailOrNull(raw);
  if (!email) throw new Error('operator email must be a valid account email');
  return email;
}

function operatorEmailFromEnv(): string | null {
  return normalizeOperatorEmailOrNull(process.env.ANT_OPERATOR_EMAIL || process.env.ANT_DEMO_EMAIL || '');
}

function normalizeOperatorEmailOrNull(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0) return null;
  if (/\s/.test(email) || !email.includes('@')) return null;
  return email;
}
