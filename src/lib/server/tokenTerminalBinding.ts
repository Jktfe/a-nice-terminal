/**
 * tokenTerminalBinding — R2 of the clean-slate identity rebuild (2026-06-04).
 *
 * The post-gate's sessionToken path was pure BEARER: `resolveDurableSession`
 * resolves a token without checking that the caller is actually on the terminal
 * the token was minted for (its `runtimeHint` is "telemetry only, must not
 * affect whether resolution succeeds"). So a token lifted from the shared
 * ~/.ant/config.json could post as its owner from ANY process — forgery by a
 * means other than controlling the owner's terminal, which is exactly what the
 * enterprise invariant forbids.
 *
 * This binds the token to its terminal: the caller's pidChain must resolve to
 * the SAME terminal the session is anchored to (`ant_sessions.terminal_id`).
 *
 * Rollout is staged via `ANT_TOKEN_TERMINAL_BINDING` (off | flag | strict),
 * default `flag`, to avoid an inverted mass-lockout — if `ant chat send` doesn't
 * yet send a resolving pidChain, strict-rejecting on day one would mute the
 * whole fleet (the same lockout class we just fixed, reversed). So:
 *   - flag (default): a violation is LOGGED but ALLOWED — observe real traffic.
 *   - strict: a violation is REJECTED — the invariant is enforced (TRUE).
 *   - off: disabled.
 * Flip flag→strict only once logs confirm legitimate traffic binds cleanly.
 *
 * `evaluateTokenTerminalBinding` is a PURE function (mode-independent) so the
 * bind decision is trivially testable; the caller pairs it with the mode to
 * decide log-vs-reject.
 */

import { createHash } from 'node:crypto';

export type TokenBindingMode = 'off' | 'flag' | 'strict';

/**
 * A short, NON-REVERSIBLE fingerprint of a sessionToken, for correlating
 * log lines from the same session WITHOUT ever writing the secret to a log.
 * (The token IS the credential — never log it raw.) SHA-256 → first 8 hex.
 */
export function sessionFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

/** Read the rollout mode from env. Unknown/unset → the safe default `flag`. */
export function tokenTerminalBindingMode(): TokenBindingMode {
  const raw = (process.env.ANT_TOKEN_TERMINAL_BINDING ?? 'flag').trim().toLowerCase();
  return raw === 'off' || raw === 'strict' ? raw : 'flag';
}

/**
 * Classification of the bind outcome. The KIND — not just bound/unbound —
 * decides what's enforceable at R2:
 *   - 'bound'         : caller provably owns the terminal (or session un-anchored).
 *   - 'wrong-terminal': pidChain present AND resolves to a DIFFERENT terminal =
 *                       active cross-terminal theft. REJECTABLE at R2 (strict),
 *                       because a legitimate caller never hits it.
 *   - 'no-pidchain'   : token presented with no pidChain (e.g. raw replay/curl).
 *   - 'unresolvable'  : pidChain present but matched no live terminal.
 * The last two stay ALLOWED even in strict mode at R2 — rejecting them would
 * lock out token-only callers (the inverted-lockout risk). They tighten to
 * reject in R3, once the clean rebuild makes a resolving pidChain mandatory.
 */
export type TokenBindingKind = 'bound' | 'wrong-terminal' | 'no-pidchain' | 'unresolvable';

export type TokenBindingEvaluation = {
  /** True when the caller provably owns the session's terminal (or the session
   *  is un-anchored and so cannot be bound — legacy/edge, allowed). */
  bound: boolean;
  /** The outcome class — drives whether strict mode may reject (see above). */
  kind: TokenBindingKind;
  /** Human-readable reason when NOT bound; null when bound. */
  violation: string | null;
};

/**
 * Decide whether a presented sessionToken is bound to the caller's terminal.
 * Pure: takes the session's anchored terminal id, the terminal the caller's
 * pidChain resolved to (null if none/absent), and whether a pidChain was sent.
 *
 *  - session has no terminal_id  → cannot bind → allowed (R3 clean rebuild makes
 *    every session terminal-anchored, after which strict is universal).
 *  - caller's terminal == session's terminal → BOUND (the caller IS the terminal).
 *  - otherwise → a violation classified by KIND (see TokenBindingKind).
 */
export function evaluateTokenTerminalBinding(
  sessionTerminalId: string | null | undefined,
  callerTerminalId: string | null | undefined,
  hadPidChain: boolean
): TokenBindingEvaluation {
  if (!sessionTerminalId) return { bound: true, kind: 'bound', violation: null };
  if (callerTerminalId && callerTerminalId === sessionTerminalId) {
    return { bound: true, kind: 'bound', violation: null };
  }
  if (!hadPidChain) {
    return { bound: false, kind: 'no-pidchain', violation: 'no pidChain presented to prove terminal ownership' };
  }
  if (!callerTerminalId) {
    return { bound: false, kind: 'unresolvable', violation: 'pidChain did not resolve to any live terminal' };
  }
  return {
    bound: false,
    kind: 'wrong-terminal',
    violation: `pidChain resolves to terminal ${callerTerminalId}, not the session's ${sessionTerminalId}`
  };
}

/**
 * The action the gate should take, given the evaluation + rollout mode. Encodes
 * the R2 rule: only an active cross-terminal theft ('wrong-terminal') is
 * rejectable, and only under `strict`. Everything else is logged-or-passed.
 */
export function tokenBindingAction(
  evaluation: TokenBindingEvaluation,
  mode: TokenBindingMode = tokenTerminalBindingMode()
): 'allow' | 'log' | 'reject' {
  if (evaluation.bound) return 'allow';
  if (mode === 'off') return 'allow';
  if (mode === 'strict' && evaluation.kind === 'wrong-terminal') return 'reject';
  return 'log';
}
