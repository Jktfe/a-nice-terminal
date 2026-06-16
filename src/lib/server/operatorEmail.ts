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
 * Same env precedence as the accounts-login operator gate
 * (`api/auth/accounts-login`): `ANT_OPERATOR_EMAIL`, then `ANT_DEMO_EMAIL`.
 * Returns null when neither is set — callers MUST fail closed (deny), never
 * open up, when there is no configured operator email.
 */
export function getOperatorEmail(): string | null {
  const configured = process.env.ANT_OPERATOR_EMAIL || process.env.ANT_DEMO_EMAIL;
  if (typeof configured !== 'string') return null;
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : null;
}
