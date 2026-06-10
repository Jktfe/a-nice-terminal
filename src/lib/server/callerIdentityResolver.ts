/**
 * callerIdentityResolver — the Step 2 seam (ant-handles-rooms-ownership-
 * contract.md R1, sequencing sketch msg_3yye38ac8f, chair steer
 * msg_ifrhfylkop 2026-06-10).
 *
 * ONE module answers "who is this caller?". Endpoints hand it the facts the
 * transport presented (the pane) plus their CURRENT legacy resolution as a
 * thunk; the resolver owns mode logic. DORMANT until endpoints adopt it —
 * nothing imports this for authority yet.
 *
 * Modes (env ANT_IDENTITY_READ, default legacy — junk values fall back to
 * legacy so a typo can never accidentally flip authority):
 *  - legacy: today's answer, untouched. Zero behaviour change while
 *    endpoints migrate onto the seam one at a time.
 *  - shadow: answers legacy, ALSO computes the witnessed-binding answer and
 *    ledgers every DISAGREEMENT (kind resolver.disagreement). Run on live
 *    traffic at zero risk; the disagreement list is the cutover punch-list
 *    and its flatline-at-zero is the proof gate.
 *  - clean: answers ONLY from daemon-witnessed bindings. The legacy thunk is
 *    never invoked (caller-supplied identity is unreadable by construction —
 *    amended AC1). No witnessed binding → identity_unresolved.
 */

import { getLiveBindingByPane } from './handleBindingsStore';
import { appendLedger } from './identityLedgerStore';

export type IdentityReadMode = 'legacy' | 'shadow' | 'clean';

export type LegacyIdentity = { handle: string; terminalId?: string | null };

export type ResolvedIdentity = {
  handle: string;
  terminalId?: string | null;
  source: 'legacy' | 'witness';
};

export type IdentityResolution =
  | { ok: true; identity: ResolvedIdentity }
  | { ok: false; reason: 'identity_unresolved' };

export type ResolveCallerInput = {
  /** tmux pane the transport presented (delivery envelope / register), if any. */
  pane: string | null;
  /** The endpoint's current resolution path, deferred so clean mode never runs it. */
  legacy: () => LegacyIdentity | null;
};

export function readIdentityReadMode(): IdentityReadMode {
  const raw = process.env.ANT_IDENTITY_READ;
  return raw === 'shadow' || raw === 'clean' ? raw : 'legacy';
}

function witnessAnswer(pane: string | null): ResolvedIdentity | null {
  if (!pane) return null;
  const binding = getLiveBindingByPane(pane);
  if (!binding) return null;
  return { handle: binding.handle, terminalId: binding.terminal_id, source: 'witness' };
}

export function resolveCallerIdentity(input: ResolveCallerInput): IdentityResolution {
  const mode = readIdentityReadMode();

  if (mode === 'clean') {
    const witness = witnessAnswer(input.pane);
    if (!witness) return { ok: false, reason: 'identity_unresolved' };
    return { ok: true, identity: witness };
  }

  const legacy = input.legacy();

  if (mode === 'shadow') {
    const witness = witnessAnswer(input.pane);
    const legacyHandle = legacy?.handle ?? null;
    const witnessHandle = witness?.handle ?? null;
    if (legacyHandle !== witnessHandle) {
      // Best-effort: the proving mode must never break the answering path.
      try {
        appendLedger({
          kind: 'resolver.disagreement',
          handle: witnessHandle ?? legacyHandle,
          actor: 'resolver',
          detail: {
            pane: input.pane,
            legacy_handle: legacyHandle,
            witness_handle: witnessHandle,
            legacy_terminal_id: legacy?.terminalId ?? null,
            witness_terminal_id: witness?.terminalId ?? null
          }
        });
      } catch { /* ledger write failure must not affect resolution */ }
    }
  }

  if (!legacy) return { ok: false, reason: 'identity_unresolved' };
  return {
    ok: true,
    identity: { handle: legacy.handle, terminalId: legacy.terminalId ?? null, source: 'legacy' }
  };
}
