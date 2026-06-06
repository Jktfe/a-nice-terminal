/**
 * allowlistGuard — gate keeper for who may invite/mention/launch against
 * a terminal_record per JWPK T2-IDENTITY-REGISTER spec (2026-05-14).
 *
 * Allow rule:
 *   - the creator (terminal.created_by)
 *   - callers in the allowlist (when non-empty)
 *
 * NOTE — CVE FIX B (2026-05-20): the `@you` operator-shortcut was removed
 * here as defense-in-depth. The previous shortcut auto-allowed any caller
 * who could *claim* `@you`, which became trivially exploitable while
 * routes accepted a body-supplied `callerHandle`. Route handlers now
 * resolve identity server-side (cookie / antchat Bearer / admin Bearer)
 * and apply their own operator-bypass where the operator legitimately
 * owns the resource (e.g. bare-tmux panes). Keeping operator-bypass at
 * the route layer means a stray `@you` flowing into this guard can never
 * silently widen access.
 *
 * Pure function — does NOT persist or audit denials. Callers (route
 * handlers, fanout, /agent-launch) decide what to do with a `false`
 * (typically 403).
 */

import type { TerminalRecord } from './terminalRecordsStore';
import { parseAllowlist } from './terminalRecordsStore';
import { OPERATOR_SENTINEL } from '$lib/operatorSentinel';
import { canonicaliseOperatorHandle } from './operatorHandle';

// Single source of truth for the operator sentinel lives in the client-safe
// $lib/operatorSentinel module so the render layer can share the exact literal
// without importing server code. Re-exported here under the established name so
// existing server callers (kill / agent-launch / vault gates) are unchanged.
export const OPERATOR_HANDLE = OPERATOR_SENTINEL;

export function canCallerActOnTerminal(
  callerHandle: string | null | undefined,
  terminal: TerminalRecord
): boolean {
  if (!callerHandle || callerHandle.length === 0) return false;
  const caller = canonicaliseOperatorHandle(callerHandle);
  if (terminal.created_by && caller === canonicaliseOperatorHandle(terminal.created_by)) return true;
  const list = parseAllowlist(terminal.allowlist);
  if (list && list.some((handle) => canonicaliseOperatorHandle(handle) === caller)) return true;
  return false;
}
