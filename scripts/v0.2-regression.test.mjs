/**
 * v0.2 substrate regression corpus — skeleton (2026-05-29).
 *
 * Skeleton file initiated for the v0.2 reshape regression suite. Cases land
 * here when their owning slice ships; the full v0.2 schema (audit_events,
 * unified org tenancy, signed-nonce auth) isn't live yet, so every case is
 * recorded as `it.todo` with anchors to the originating slice + canvas.
 *
 * Owner rotation: whichever slice ratifies a case ships the case + its
 * `it.todo` placeholder in the same commit (so the corpus stays alongside
 * the substrate it protects).
 *
 * Case index:
 *   1-8   reserved — Stage A 403-payload + Part 1-3 cases (separate swarms)
 *   9a/9b/9c — Part 4 identity_keys multi-device recovery (this slice)
 */

import { describe, it } from 'vitest';

describe('v0.2 regression corpus — Part 4 identity_keys multi-device recovery', () => {
  // Case 9a: device-loss happy path, identity stays usable through revocation.
  // Stage identity with 3 active device keys + 1 paper key. Revoke 1 device
  // key. Assert: 2 active device keys + paper key remain; room memberships
  // unchanged; grants unchanged; one audit_events row recorded.
  it.todo('case 9a — revoking 1 of 3 device keys leaves identity fully usable');

  // Case 9b: Tier 3 paper-mnemonic recovery — happy path. Stage identity
  // with 0 active device keys + 1 paper key on file. Run recover-from-paper-
  // key with the correct mnemonic. Assert: new device key minted; paper_
  // key_hash rotated to a fresh value; one audit_events row with attester_
  // kind='paper-key'.
  it.todo('case 9b — paper-key recovery mints a new device key + rotates the hash');

  // Case 9c: Tier 3 paper-mnemonic recovery — wrong mnemonic. Same setup
  // as 9b but supply a different mnemonic. Assert: 403; no key minted; the
  // failed attempt is logged to audit_events.
  it.todo('case 9c — wrong paper mnemonic rejected with 403 + failure audited');
});
