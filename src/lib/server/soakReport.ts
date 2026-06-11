/**
 * soakReport — the public flatline counter for cut night (soak sequencing
 * ruling msg_l7gimewpiy: 60-minute zero-disagreement window against
 * POPULATED bindings, counter published to the room every 10 minutes so the
 * flatline is watched in public, not asserted afterwards).
 *
 * Counts proving-mode ledger rows since a window start, grouped into the
 * named signatures the room already knows:
 *  - nothing-witnessed: legacy answered, no witnessed binding (the token
 *    crutch / unpopulated signature — must be ZERO once the roll-call has run)
 *  - witness-mismatch: legacy and witness answered DIFFERENT handles (the
 *    serious one — a real identity divergence)
 *  - register-divergence: a registration whose legacy outcome differed from
 *    refuse-or-claim (suffix or stale-inherit)
 *  - pane-uncorroborated: a caller presented a pane it does not occupy (spoof
 *    signature)
 */

import { getIdentityDb } from './db';

export type SoakSignature =
  | 'nothing-witnessed'
  | 'witness-mismatch'
  | 'register-divergence'
  | 'pane-uncorroborated';

export type SoakReport = {
  windowStartMs: number;
  generatedAtMs: number;
  total: number;
  clean: boolean;
  signatures: Record<SoakSignature, number>;
  rows: { atMs: number; kind: string; signature: SoakSignature; handle: string | null; detail: Record<string, unknown> | null }[];
};

type LedgerRow = {
  at_ms: number;
  kind: string;
  handle: string | null;
  detail: string | null;
};

function classify(kind: string, detail: Record<string, unknown> | null): SoakSignature {
  if (kind === 'pane.uncorroborated') return 'pane-uncorroborated';
  if (detail?.surface === 'register') return 'register-divergence';
  if (detail && 'witness_handle' in detail && detail.witness_handle === null) return 'nothing-witnessed';
  return 'witness-mismatch';
}

export function buildSoakReport(input: { sinceMs: number; nowMs?: number }): SoakReport {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT at_ms, kind, handle, detail FROM identity_ledger
        WHERE at_ms >= ? AND kind IN ('resolver.disagreement', 'pane.uncorroborated')
        ORDER BY at_ms ASC`
    )
    .all(input.sinceMs) as LedgerRow[];
  const signatures: Record<SoakSignature, number> = {
    'nothing-witnessed': 0,
    'witness-mismatch': 0,
    'register-divergence': 0,
    'pane-uncorroborated': 0
  };
  const reportRows = rows.map((row) => {
    const detail = row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null;
    const signature = classify(row.kind, detail);
    signatures[signature] += 1;
    return { atMs: row.at_ms, kind: row.kind, signature, handle: row.handle, detail };
  });
  return {
    windowStartMs: input.sinceMs,
    generatedAtMs: input.nowMs ?? Date.now(),
    total: reportRows.length,
    clean: reportRows.length === 0,
    signatures,
    rows: reportRows
  };
}
