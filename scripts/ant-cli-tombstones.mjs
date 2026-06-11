/**
 * Verb tombstones for the identity cutover (kill-list blessed
 * msg_d55jrfpr95; tombstone-not-vanish ruling msg_pspfmyglg6).
 *
 * A retired verb does not disappear — it answers with WHY it died and WHAT
 * replaces it, exits non-zero, and (in the compiled cut binary) the trip is
 * reported best-effort so the ledger shows who still reaches for the old
 * path. Tombstones delete a release later, once trips hit zero.
 *
 * INERT ON MAIN: activation comes only from the build-time constant
 * (ANT_CLI_CUTOVER=1 at compile, runbook step 9). Ordinary builds pass
 * `active = false` and every verb behaves exactly as today.
 *
 * Final kill-list after review (the original CERTAIN five shrank — the
 * review caught that `ant sessions` is terminal lifecycle, not tokens):
 *   identity-keys   → witnessed bindings replaced key-based identity
 *   bind            → lease-era room-handle binding; use `ant register`
 *                     (witnessed claim) / owner rebind
 *   reclaim         → vacant handles claim instantly via `ant register`
 *   rooms post      → use `ant chat send` (the witnessed posting path)
 */

export const TOMBSTONED_VERBS = {
  // identity-keys is a subverb FAMILY under `ant identity` — its dispatch
  // point (ant-cli-identity.mjs) consults this entry via the family key.
  'identity-keys': {
    replacement: 'identity is daemon-witnessed now — `ant whoami` shows what the daemon sees'
  },
  'bind': {
    replacement: '`ant register --handle @x --name "Name"` claims a vacant desk; occupied desks need an owner rebind'
  },
  'reclaim': {
    replacement: '`ant register` — vacant handles claim instantly under refuse-or-claim'
  },
  'rooms post': {
    replacement: '`ant chat send <room> --msg "..."` — the witnessed posting path'
  }
};

/**
 * Returns an exit code (9) when the verb is retired in a cutover build,
 * printing the tombstone via writeErr. Returns null when the verb should
 * proceed (not retired, or not a cutover build).
 */
export function tombstoneIfCutover(active, verbPath, writeErr) {
  if (!active) return null;
  const entry = TOMBSTONED_VERBS[verbPath];
  if (!entry) return null;
  writeErr(`ant ${verbPath}: retired at the identity cutover.`);
  writeErr(`  Use instead: ${entry.replacement}`);
  writeErr('  (This tombstone is temporary and its invocations are recorded; the verb is removed entirely in a later release.)');
  return 9;
}
